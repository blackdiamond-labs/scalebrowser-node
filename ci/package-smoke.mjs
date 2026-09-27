#!/usr/bin/env node
/**
 * Prove the PACKAGE works, not the source tree.
 *
 * `npm test` runs against `src/`. A package can be green there and broken on a
 * customer's machine for reasons no unit test can see: a file missing from
 * `files`, an `exports` entry pointing at a path that was never built, a
 * `require` path that only resolves because the repo happens to be next to it.
 * So this installs the tarball into an empty directory and loads it from
 * there: both entry points, because dual ESM/CJS is exactly where that breaks.
 *
 *   node ci/package-smoke.mjs                 packs this package first
 *   node ci/package-smoke.mjs <tarball.tgz>   checks the tarball that will ship
 *
 * Exits non-zero with the reason on any failure.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Names a consumer must find, spot-checked across every module. */
const REQUIRED_EXPORTS = [
  'ScalebrowserClient',
  'CdpSession',
  'ApiError',
  'ErrorCode',
  'subscribeEvents',
  'VERSION',
];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function main() {
  const given = process.argv[2];
  const work = mkdtempSync(join(tmpdir(), 'sb-sdk-smoke-'));
  try {
    let tarball;
    if (given) {
      tarball = basename(given);
      copyFileSync(resolve(given), join(work, tarball));
      console.log(`· checking ${tarball}`);
    } else {
      console.log('· packing');
      // `--pack-destination` so the tarball never lands in the working tree.
      run('npm', ['pack', '--pack-destination', work, '--silent'], PKG_DIR);
      tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
      if (!tarball) throw new Error('npm pack produced no tarball');
      console.log(`· packed ${tarball}`);
    }

    console.log('· installing into an empty project');
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));
    run('npm', ['install', '--silent', '--no-audit', '--no-fund', join(work, tarball)], work);

    // ESM and CJS are resolved by DIFFERENT `exports` entries, so one working
    // says nothing about the other.
    const esm = `
      import * as sdk from '@scalebrowser/sdk';
      const missing = ${JSON.stringify(REQUIRED_EXPORTS)}.filter((n) => sdk[n] === undefined);
      if (missing.length) { console.error('missing ESM exports: ' + missing.join(', ')); process.exit(1); }
      const client = new sdk.ScalebrowserClient({ baseUrl: 'http://127.0.0.1:1', token: 'x' });
      if (typeof client.listRuns !== 'function') { console.error('listRuns missing'); process.exit(1); }
      // The token must not be readable off the object.
      if (JSON.stringify(client).includes('x')) { console.error('token is enumerable'); process.exit(1); }
      console.log('  esm ok, version ' + sdk.VERSION);
    `;
    const cjs = `
      const sdk = require('@scalebrowser/sdk');
      const missing = ${JSON.stringify(REQUIRED_EXPORTS)}.filter((n) => sdk[n] === undefined);
      if (missing.length) { console.error('missing CJS exports: ' + missing.join(', ')); process.exit(1); }
      console.log('  cjs ok, version ' + sdk.VERSION);
    `;
    writeFileSync(join(work, 'check.mjs'), esm);
    writeFileSync(join(work, 'check.cjs'), cjs);
    process.stdout.write(run('node', ['check.mjs'], work));
    process.stdout.write(run('node', ['check.cjs'], work));

    // A published artifact carries no source. Read the list out of the TARBALL
    // that was just installed, not from a second `npm pack --dry-run`: that one
    // re-runs `prepare`, whose build output lands on stdout and is not JSON.
    const entries = run('tar', ['-tzf', join(work, tarball)], work)
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace(/^package\//, ''));
    const maps = entries.filter((p) => p.endsWith('.map'));
    if (maps.length) {
      console.error(`source maps in the package: ${maps.join(', ')}`);
      process.exit(1);
    }
    const license = entries.some((p) => p === 'LICENSE');
    if (!license) {
      console.error('LICENSE is not in the package');
      process.exit(1);
    }
    console.log(`· ${entries.length} files, no source maps, LICENSE present`);
    console.log('node package smoke: OK');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
