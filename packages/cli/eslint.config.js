import config from '@rando/eslint-config'

export default [
  ...config,
  // bin/ is a Node script — give it Node globals.
  {
    files: ['bin/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
]
