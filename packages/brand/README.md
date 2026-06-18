# @rando/brand

Brand assets for Rando — logos, banners, marks. Versioned (`v0/` today)
so the brand can iterate without breaking consumers.

## What's here

```
assets/
└── v0/
    ├── logo/
    │   ├── logo.svg
    │   ├── logo.png              (with background)
    │   └── logo-transparent.png  (no background)
    └── banner/
        ├── banner-light.png
        └── banner-dark.png
```

## Adding a new asset

1. Drop the file into `assets/v<n>/<group>/`. Bump `v` only when
   rebranding; same-version variants go alongside existing files.
2. Add a typed entry to `src/assets.ts` under the matching path.
3. Update `src/__tests__/assets.test.ts` to cover it.
4. Run `pnpm typecheck && pnpm test:coverage` from the repo root.

## Consuming in apps

Two patterns, both already wired:

### 1. Direct sub-path import (preferred)

Each app's bundler resolves the file through its own asset pipeline:

```tsx
import logo from '@rando/brand/assets/v0/logo/logo.svg'

;<Image src={logo} alt="Rando" />
```

PNG works out of the box on Next.js (`apps/web`, `apps/admin`) and
Expo (`apps/native`).

### 2. Path registry

When you need the raw relative-path string (runtime URL composition,
manifest files, etc.):

```ts
import { assets } from '@rando/brand'

assets.v0.logo.svg // → 'v0/logo/logo.svg'
```

## SVG on native (one-time config)

Next.js handles SVG imports as static URL assets via its default
Webpack config — `apps/web` and `apps/admin` are good as-is.

For `apps/native` (Expo / Metro), SVG imports need
[`react-native-svg-transformer`](https://github.com/kristerkari/react-native-svg-transformer):

```bash
pnpm --filter @rando/native add -D react-native-svg-transformer
```

```js
// apps/native/metro.config.js
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer')
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg')
config.resolver.sourceExts.push('svg')

module.exports = config
```

The PNG variants work on native without any config — reach for those
if you don't want to wire SVG support up front.

## Versioning

Each rebrand bumps the top-level directory: `v0` → `v1` → … . Old
versions stay in place so consumers can roll back if a rebrand hits
a snag mid-rollout. The registry exposes whatever's currently in `src/assets.ts`.
