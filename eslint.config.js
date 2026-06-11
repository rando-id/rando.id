// Root ESLint config — used when ESLint is invoked from the workspace root
// (most importantly: lint-staged via the pre-commit hook). Each app also has
// its own eslint.config.js that takes precedence when running `pnpm lint` from
// inside that app's directory.

// Imported via relative path because `@rando/eslint-config` isn't declared at
// the workspace root (it's a per-app devDep). Relative imports sidestep pnpm
// hoist behavior entirely.
import next from './tooling/eslint-config/next.js'
import reactNative from './tooling/eslint-config/react-native.js'

// Scope a shared config's rule/plugin blocks to a subtree, leaving global
// ignore blocks (no rules/plugins/languageOptions/files) unscoped so they
// still apply workspace-wide.
const scope = (configs, files) =>
  configs.map((c) => {
    const isGlobalIgnore = c.ignores && !c.rules && !c.plugins && !c.languageOptions && !c.files
    return isGlobalIgnore ? c : { ...c, files }
  })

export default [
  ...scope(reactNative, ['apps/native/**/*.{ts,tsx,js,jsx,mjs,cjs}']),
  ...scope(next, [
    'apps/{api,web,admin}/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    'packages/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    'tooling/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  ]),
]
