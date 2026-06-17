import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // PostGIS-dependent tests are slow (real Postgres + migrations) so
    // we keep them serialized and give them a generous timeout.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        // Standalone scripts run via tsx, not imported by tests.
        'src/migrate.ts',
        'src/seed.ts',
        'src/reset.ts',
        'src/load-env.ts',
        // Type-only / barrel.
        'src/index.ts',
        'src/types.ts',
      ],
      // Thresholds left at 0 by design: the test suite skips entirely
      // when DATABASE_URL_TEST isn't set (no local Postgres, or CI
      // without a test branch). Threshold-zero means skipped runs
      // don't fail.
      //
      // When tests DO run, current floor is 99.3% lines / 70.6%
      // branches / 23.8% functions. The low function% is misleading —
      // it counts Drizzle's pgTable schema definitions, which generate
      // callable helpers that no query exercises. Meaningful query
      // functions are at 100%.
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
})
