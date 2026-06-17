import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        // Barrel-only re-exports.
        'src/index.ts',
      ],
      // 100% across the board — lock it. Anything new without a test
      // will fail this threshold, which is exactly what we want.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
})
