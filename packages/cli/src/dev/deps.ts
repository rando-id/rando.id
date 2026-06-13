// App dependency resolution. Captures the hard-coded knowledge that
// web/admin/native all need the api running locally; api stands alone.
// If the dependency graph grows, this is the one file to touch.

export const KNOWN_APPS = ['api', 'web', 'admin', 'native'] as const
export type KnownApp = (typeof KNOWN_APPS)[number]

/** Apps that any given app needs to also have running. */
const DEPENDENCIES: Record<KnownApp, KnownApp[]> = {
  api: [],
  web: ['api'],
  admin: ['api'],
  native: ['api'],
}

/**
 * Expand a list of explicitly-requested apps to include their transitive
 * dependencies. Result is deduplicated and ordered so dependencies come
 * before dependents (api before web/admin/native).
 */
export function expandApps(requested: KnownApp[]): KnownApp[] {
  const result: KnownApp[] = []
  const seen = new Set<KnownApp>()
  const visit = (app: KnownApp): void => {
    if (seen.has(app)) return
    seen.add(app)
    for (const dep of DEPENDENCIES[app]) visit(dep)
    result.push(app)
  }
  for (const a of requested) visit(a)
  return result
}

/**
 * Validate + normalize user-provided app names. Throws if any name is not
 * in KNOWN_APPS. Empty input defaults to all known apps (full-stack dev).
 */
export function parseAppNames(raw: string[]): KnownApp[] {
  if (raw.length === 0) return [...KNOWN_APPS]
  const out: KnownApp[] = []
  for (const name of raw) {
    if (!(KNOWN_APPS as readonly string[]).includes(name)) {
      throw new Error(`Unknown app "${name}". Must be one of: ${KNOWN_APPS.join(', ')}.`)
    }
    out.push(name as KnownApp)
  }
  return out
}
