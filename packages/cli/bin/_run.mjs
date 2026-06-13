// Real entrypoint, invoked by bin/rando.mjs after the wrapper has set up tsx
// and loaded .env via absolute paths. Kept tiny so the wrapper can stay
// non-TS (plain Node) while the real CLI runs through tsx.
import { run } from '../src/cli.ts'
await run(process.argv.slice(2))
