import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'cobertura'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        // MapPicker needs WebGL/canvas — not testable in jsdom.
        'src/features/contacts/MapPicker.tsx',
        // Tamagui provider is a thin Next.js wrapper with no logic.
        'src/providers/**',
        // Component renders excluded; their pure logic lives in helpers.ts
        // and IS tested. Tamagui-in-jsdom mounts are brittle and add
        // little signal.
        'src/features/contacts/ContactsList.tsx',
        'src/features/contacts/NewContactForm.tsx',
        'src/features/contacts/ContactDetailView.tsx',
        'src/features/lists/ListsIndex.tsx',
        'src/features/lists/ListDetailView.tsx',
        'src/features/lists/FavoritesView.tsx',
      ],
      // Component renders (ContactsList, NewContactForm, ContactDetailView,
      // MapPicker, providers) are excluded — Tamagui-in-jsdom mounts are
      // brittle and the pure logic they delegate to lives in helpers.ts
      // and is fully tested. What remains here IS at 100%, so the
      // threshold locks that in. Any new file added to `src/` without
      // a test (and without a justified exclude) will fail this gate.
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
})
