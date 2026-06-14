import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        // Re-exported types only — no logic to cover.
        'src/domain/**',
        // Setup-config types are pure schema; logic is its parseSetupConfig
        // which is covered.
      ],
      // ~79% baseline after the tracker refactor. The drag comes from
      // I/O-heavy modules (supervisor.ts, dev.ts, doctor.ts,
      // completion.ts, output.ts) that aren't unit-tested. Threshold
      // set a few points below baseline to let small refactors pass
      // without immediate failure.
      thresholds: { lines: 76, functions: 78, branches: 76, statements: 76 },
    },
  },
})
