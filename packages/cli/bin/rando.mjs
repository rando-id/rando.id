#!/usr/bin/env -S node --env-file-if-exists=.env --import=tsx/esm
import { run } from '../src/cli.ts'
await run(process.argv.slice(2))
