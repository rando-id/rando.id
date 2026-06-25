// Ambient declarations for side-effect imports that Next.js / webpack
// handle at build time but tsc doesn't know about. TypeScript 6
// requires explicit declarations for side-effect imports of files
// without `.d.ts` (TS2882); CSS is the main hit.

declare module '*.css'
