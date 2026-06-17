// Vercel CLI integration — for marketplace-storage operations that
// the Vercel REST API doesn't expose. Specifically: provisioning
// Vercel-managed Neon databases via `vercel install neon`, since
// the Neon REST API rejects creates on Vercel-managed orgs
// ("action restricted; reason: organization is managed by Vercel").

export interface VercelCliProvisioner {
  /**
   * Install a Neon database via Vercel's marketplace integration.
   * Shells out to `vercel install neon --name <name> --plan <plan> [-e <env>...]`.
   *
   * Idempotent: `vercel install neon` is a no-op when an integration
   * with that name already exists (exits 0). Callers can re-run safely.
   *
   * After the install completes, the project becomes visible to the
   * Neon API for downstream operations (branches, queries, etc.).
   */
  installNeon(input: {
    name: string
    plan: string
    envs: ReadonlyArray<'production' | 'preview' | 'development'>
  }): Promise<void>
}
