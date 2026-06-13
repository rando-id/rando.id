// App-deploy domain interface. Implemented by vendor-specific adapters
// (Vercel, Netlify, Railway, etc.). Each project corresponds to one app in
// the repo; env vars are scoped to environments; domains can be assigned to
// a specific branch.

export type DeployEnvScope = 'production' | 'preview' | 'development'

export interface DeployProject {
  id: string
  name: string
  rootDirectory: string | null
}

export interface DeployEnvVar {
  id: string
  key: string
  scopes: DeployEnvScope[]
}

export interface DeployDomain {
  name: string
  branch: string | null
}

/** A single deployment for a project (one per build/commit). */
export interface Deployment {
  id: string
  /** Vendor-assigned URL — e.g. `<project>-git-<branch>-<scope>.vercel.app`. */
  url: string
  /** Git branch / ref this deployment was built from, if known. */
  branch: string | null
  /** Lifecycle state — provider strings normalized to a small set. */
  state: 'queued' | 'building' | 'ready' | 'error' | 'canceled'
}

export interface DeployProvider {
  /** Create a new project, linking it to a GitHub repo and root directory. */
  createProject(input: {
    name: string
    repo: string // "owner/name"
    rootDirectory: string // repo-relative path, e.g. "apps/api"
  }): Promise<DeployProject>

  /** List projects on this account/team. */
  listProjects(): Promise<DeployProject[]>

  /** Resolve a project by its human-readable name. */
  getProjectByName(input: { name: string }): Promise<DeployProject | null>

  /** Set (create or overwrite) an env var on a project, scoped to environments. */
  setEnv(input: {
    projectId: string
    key: string
    value: string
    scopes: DeployEnvScope[]
  }): Promise<DeployEnvVar>

  /** List env vars on a project (values are never returned by adapters). */
  listEnv(input: { projectId: string }): Promise<DeployEnvVar[]>

  /** Add a custom domain to a project, optionally pinned to a specific branch. */
  addDomain(input: { projectId: string; hostname: string; branch?: string }): Promise<DeployDomain>

  /** Remove a custom domain from a project. */
  removeDomain(input: { projectId: string; hostname: string }): Promise<void>

  /** Delete an entire deploy project (deployments + env vars + domains). */
  deleteProject(input: { projectId: string }): Promise<void>

  /**
   * Trigger a new deployment for a project from a git branch. Returns
   * immediately with the deployment record — caller polls `getDeployment`
   * until `state === 'ready'` or `'error'`.
   */
  triggerDeployment(input: { projectId: string; branch: string }): Promise<Deployment>

  /** Fetch the current state of a deployment. */
  getDeployment(input: { deploymentId: string }): Promise<Deployment>
}
