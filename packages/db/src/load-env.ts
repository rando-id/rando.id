import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const workspaceRoot = resolve(packageRoot, '..', '..')

const candidates = [
  resolve(packageRoot, '.env'),
  resolve(workspaceRoot, 'apps', 'api', '.env'),
  resolve(workspaceRoot, '.env'),
]

for (const path of candidates) {
  if (existsSync(path)) {
    process.loadEnvFile(path)
    console.log(`Loaded env from ${path}`)
  }
}
