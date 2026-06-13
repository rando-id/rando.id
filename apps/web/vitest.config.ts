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
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        // MapPicker needs WebGL/canvas — not testable in jsdom.
        'src/features/contacts/MapPicker.tsx',
        // Tamagui provider is a thin Next.js wrapper with no logic.
        'src/providers/**',
      ],
      // ~30% lines but 84%/89% functions/branches. Low lines is because
      // ContactsList + NewContactForm component renders aren't unit-tested
      // (Tamagui in jsdom is brittle). The pure logic those components
      // delegate to is at 100%. Threshold reflects that reality.
      thresholds: { lines: 28, functions: 80, branches: 85, statements: 28 },
    },
  },
})
