#!/usr/bin/env node
/**
 * The content of an npm package as a list of file hashes, and the check that
 * two packages carry the same bytes.
 *
 * The package is built and tested upstream first. The build that reaches npm
 * is made again here, from the same commit, so that npm can attest where it
 * came from. This script is what ties the two together: the release tag
 * carries the manifest of the approved build, and nothing is published unless
 * this build matches it file for file. After the publish, the same check runs
 * against what the registry actually serves.
 *
 * Hashes are taken over the unpacked files, not over the tarball, because gzip
 * output may differ between tool versions while the files do not.
 *
 *   node ci/package-manifest.mjs <tarball.tgz>                     print the manifest
 *   node ci/package-manifest.mjs <name@version> --wait 300          the same, from the registry
 *   node ci/package-manifest.mjs <source> --expect <manifest.json>  compare, exit 1 on any difference
 *   node ci/package-manifest.mjs --self-test
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

function filesUnder(root) {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Manifest of an unpacked package directory (the `package/` folder). */
export function manifestOfDir(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = {};
  for (const path of filesUnder(dir).sort()) {
    const rel = relative(dir, path).split(sep).join('/');
    files[rel] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return { name: pkg.name, version: pkg.version, files };
}

export function manifestOfTarball(tarball) {
  const work = mkdtempSync(join(tmpdir(), 'sb-manifest-'));
  try {
    execFileSync('tar', ['-xzf', resolve(tarball), '-C', work]);
    return manifestOfDir(join(work, 'package'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Every way `actual` differs from `expected`, one line each. Empty = equal. */
export function differences(expected, actual) {
  const out = [];
  for (const key of ['name', 'version']) {
    if (expected[key] !== actual[key]) out.push(`${key}: expected ${expected[key]}, got ${actual[key]}`);
  }
  const paths = new Set([...Object.keys(expected.files), ...Object.keys(actual.files)]);
  for (const path of [...paths].sort()) {
    const want = expected.files[path];
    const got = actual.files[path];
    if (want === undefined) out.push(`${path}: not in the approved build`);
    else if (got === undefined) out.push(`${path}: missing`);
    else if (want !== got) out.push(`${path}: content differs`);
  }
  return out;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A registry spec, fetched with `npm pack`. A version that was published a
 *  moment ago may take a while to be served, so this retries until `waitS`. */
async function manifestOfSpec(spec, waitS) {
  const deadline = Date.now() + waitS * 1000;
  for (;;) {
    const work = mkdtempSync(join(tmpdir(), 'sb-manifest-pack-'));
    try {
      execFileSync('npm', ['pack', spec, '--pack-destination', work, '--silent'], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
      if (tarball) return manifestOfTarball(join(work, tarball));
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`${spec} could not be fetched: ${String(error.stderr ?? error)}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    if (Date.now() >= deadline) throw new Error(`${spec} produced no tarball`);
    console.error(`${spec} is not served yet, retrying in 15 s`);
    await sleep(15_000);
  }
}

function selfTest() {
  const a = { name: 'x', version: '1.0.0', files: { 'package.json': '1', 'dist/index.js': '2' } };
  const cases = [
    ['identical', a, a, 0],
    ['content', a, { ...a, files: { ...a.files, 'dist/index.js': '3' } }, 1],
    ['extra file', a, { ...a, files: { ...a.files, 'dist/extra.js': '4' } }, 1],
    ['missing file', a, { ...a, files: { 'package.json': '1' } }, 1],
    ['version', a, { ...a, version: '1.0.1' }, 1],
  ];
  let bad = 0;
  for (const [label, expected, actual, count] of cases) {
    const found = differences(expected, actual).length;
    if (found !== count) {
      console.error(`self-test: ${label} reported ${found} differences, expected ${count}`);
      bad++;
    }
  }
  // A real round trip through tar, so the extraction path is covered too.
  const work = mkdtempSync(join(tmpdir(), 'sb-manifest-self-'));
  try {
    mkdirSync(join(work, 'package', 'dist'), { recursive: true });
    writeFileSync(join(work, 'package', 'package.json'), '{"name":"x","version":"1.0.0"}');
    writeFileSync(join(work, 'package', 'dist', 'index.js'), 'export {};\n');
    execFileSync('tar', ['-czf', join(work, 'x.tgz'), '-C', work, 'package']);
    const m = manifestOfTarball(join(work, 'x.tgz'));
    if (Object.keys(m.files).join(',') !== 'dist/index.js,package.json' || m.version !== '1.0.0') {
      console.error(`self-test: tarball manifest came out as ${JSON.stringify(m)}`);
      bad++;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (bad > 0) process.exit(1);
  console.log(`self-test ok (${cases.length} comparisons, 1 tarball)`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') return selfTest();
  const source = args[0];
  const option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  if (!source) {
    console.error('usage: package-manifest.mjs <tarball.tgz | name@version> [--expect file] [--wait seconds]');
    process.exit(64);
  }
  const manifest =
    source.endsWith('.tgz') && existsSync(source)
      ? manifestOfTarball(source)
      : await manifestOfSpec(source, Number(option('--wait') ?? 0));

  const expectFile = option('--expect');
  if (expectFile === undefined) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(readFileSync(expectFile, 'utf8'));
  const diff = differences(expected, manifest);
  if (diff.length > 0) {
    console.error(`${source} does not match the approved build:`);
    for (const line of diff) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`${source}: ${Object.keys(manifest.files).length} files, identical to the approved build`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
