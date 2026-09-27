import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    /* The coverage floor, since 2026-09-09. It may rise and should; it must
     * never fall silently.
     *
     * `enabled: true` is the point, not a detail: without it the threshold
     * only applies when someone passes `--coverage`, and `npm test` runs plain
     * `vitest run`. A threshold without `enabled` never checks anything.
     *
     * `include: ['src/**']` likewise: without it the denominator holds only
     * what some test happened to LOAD, and a new untested file would not
     * lower the number. That is exactly what it should do.
     *
     * The numbers are measured, not wished for: two points below the values of
     * 2026-09-09 (89.65 / 69.80 / 93.64 / 92.00). Two points, because a floor
     * at the current value turns red on every refactor that removes a line;
     * a real drop still shows. */
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      thresholds: { statements: 87, branches: 67, functions: 91, lines: 90 },
    },
  },
});
