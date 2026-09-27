import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // No source maps in the published package: a map carries `sourcesContent`,
  // which is the commented TypeScript itself. Same class of leak the daemon and
  // the desktop app already closed. The bundle is not minified, so a stack
  // trace still names real functions.
  sourcemap: false,
  clean: true,
  treeshake: true,
  target: 'node18',
  outDir: 'dist',
});
