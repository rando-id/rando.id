import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['node_modules', '.next', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // App Router routes live in `app/`, helpers in `src/`. Include both.
      include: ['app/**/*.ts', 'src/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.d.ts',
        // Next.js scaffolding the user didn't write.
        'app/**/layout.tsx',
        'app/**/error.tsx',
      ],
      // ~89% baseline. Threshold set a few points below to allow small
      // refactors without immediate CI failure; regressions are still
      // caught.
      thresholds: { lines: 85, functions: 80, branches: 80, statements: 85 },
    },
  },
  resolve: {
    // Next.js's `@/...` alias points at apps/api/src — mirror it here so
    // route handlers can import `@/lib/...` in tests too.
    alias: {
      '@': resolve(here, 'src'),
    },
  },
})
