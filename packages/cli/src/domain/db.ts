// Database domain interface. Implemented by vendor-specific adapters (Neon,
// Supabase, etc.). All operations are scoped by a single project that the
// caller has access to.

export interface DbProject {
  id: string
  name: string
}

export interface DbBranch {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export interface DbConnectionString {
  branch: string
  pooled: boolean
  url: string
}

export interface DbProvider {
  /** Create a new database project. */
  createProject(input: { name: string; region?: string }): Promise<DbProject>

  /** List all projects this account can see. */
  listProjects(): Promise<DbProject[]>

  /** Create a new branch under a project. */
  createBranch(input: { projectId: string; name: string; fromBranchId?: string }): Promise<DbBranch>

  /** List branches in a project. */
  listBranches(input: { projectId: string }): Promise<DbBranch[]>

  /** Get a connection string (pooled if requested) for a branch. */
  getConnectionString(input: {
    projectId: string
    branchId: string
    pooled: boolean
  }): Promise<DbConnectionString>

  /** Enable an extension (e.g. "postgis") on a branch's default database. */
  enableExtension(input: { projectId: string; branchId: string; extension: string }): Promise<void>

  /** Delete a branch. Irreversible. */
  deleteBranch(input: { projectId: string; branchId: string }): Promise<void>

  /** Delete an entire project (all branches + data). Irreversible. */
  deleteProject(input: { projectId: string }): Promise<void>
}
