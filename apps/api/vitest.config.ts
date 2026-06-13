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
      // ~90% lines / 92% functions baseline. Threshold a few points
      // below current floor — small refactors have buffer, real
      // regressions fail CI.
      thresholds: { lines: 88, functions: 88, branches: 80, statements: 88 },
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
