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
      // Current floor: ~87% lines / ~95% functions / ~73% branches.
      // The low branch number is mostly try/catch + JSON-parse error
      // paths in route handlers — diminishing returns to test
      // exhaustively. Thresholds set a few points below floor so
      // catch-block coverage isn't a moving target. `current-user.ts`
      // is intentionally untested at the unit level; it's exercised by
      // every route via the boundary mock.
      thresholds: { lines: 85, functions: 90, branches: 70, statements: 85 },
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
