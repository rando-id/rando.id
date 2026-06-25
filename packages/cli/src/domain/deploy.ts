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

/**
 * Project-level settings that control whether the vendor's git
 * integration auto-deploys on push. Rando turns these OFF so every
 * deploy routes through `rando deploy …` for unified gating. See
 * .notes/process-deploy-strategy.spec.md (D1).
 */
export interface DeployProjectSettings {
  /**
   * Disable vendor-native preview deploys (every push to every PR
   * branch). For Vercel this maps to `previewDeploymentsDisabled`.
   * Documented in Vercel's REST API.
   */
  previewDeploymentsDisabled?: boolean
  /**
   * Master switch for git-triggered deploys (preview AND production
   * push). For Vercel this maps to
   * `gitProviderOptions.createDeployments`. UNDOCUMENTED — set as
   * belt-and-suspenders alongside `previewDeploymentsDisabled` to
   * also catch production-branch pushes; if Vercel renames the
   * field the documented one still covers previews.
   */
  gitProviderCreateDeployments?: 'enabled' | 'disabled'
}

export interface DeployProvider {
  /** Create a new project, linking it to a GitHub repo and root directory. */
  createProject(input: {
    name: string
    repo: string // "owner/name"
    rootDirectory: string // repo-relative path, e.g. "apps/api"
  }): Promise<DeployProject>

  /**
   * Update vendor-native git-deploy settings on an existing project.
   * Idempotent on the vendor side — re-PATCHing the same body is a
   * no-op there. Returns the project as the vendor sees it after
   * the update.
   */
  updateProjectSettings(input: {
    projectId: string
    settings: DeployProjectSettings
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
   *
   * `target` pins the deployment to a vendor environment:
   *   - omitted → branch-scoped preview (the `rando deploy branch` path).
   *   - `'staging'` → the staging vendor environment.
   *   - `'production'` → the production vendor environment.
   */
  triggerDeployment(input: {
    projectId: string
    branch: string
    target?: 'staging' | 'production'
  }): Promise<Deployment>

  /** Fetch the current state of a deployment. */
  getDeployment(input: { deploymentId: string }): Promise<Deployment>
}
