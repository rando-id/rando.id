// Neon (https://neon.tech) implementation of DbProvider.
// API reference: https://api-docs.neon.tech/reference/getting-started-with-neon-api

import { ProviderApiError } from '../domain/errors'
import type { DbBranch, DbConnectionString, DbProject, DbProvider } from '../domain/db'

const BASE_URL = 'https://console.neon.tech/api/v2'

export interface NeonDbProviderOptions {
  apiKey: string
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Override base URL for tests. */
  baseUrl?: string
}

export class NeonDbProvider implements DbProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: NeonDbProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? BASE_URL
  }

  async createProject(input: { name: string; region?: string }): Promise<DbProject> {
    const body = await this.request<{ project: NeonProjectShape }>('POST', '/projects', {
      project: {
        name: input.name,
        region_id: input.region ?? 'aws-us-east-2',
        pg_version: 16,
      },
    })
    return mapProject(body.project)
  }

  async listProjects(): Promise<DbProject[]> {
    const body = await this.request<{ projects: NeonProjectShape[] }>('GET', '/projects')
    return body.projects.map(mapProject)
  }

  async createBranch(input: {
    projectId: string
    name: string
    fromBranchId?: string
  }): Promise<DbBranch> {
    const body = await this.request<{ branch: NeonBranchShape }>(
      'POST',
      `/projects/${input.projectId}/branches`,
      {
        branch: {
          name: input.name,
          ...(input.fromBranchId ? { parent_id: input.fromBranchId } : {}),
        },
      },
    )
    return mapBranch(body.branch)
  }

  async listBranches(input: { projectId: string }): Promise<DbBranch[]> {
    const body = await this.request<{ branches: NeonBranchShape[] }>(
      'GET',
      `/projects/${input.projectId}/branches`,
    )
    return body.branches.map(mapBranch)
  }

  async getConnectionString(input: {
    projectId: string
    branchId: string
    pooled: boolean
  }): Promise<DbConnectionString> {
    // Neon exposes connection URIs via /connection_uri. We need the default
    // database name + role name to ask for one.
    const databases = await this.request<{ databases: NeonDbShape[] }>(
      'GET',
      `/projects/${input.projectId}/branches/${input.branchId}/databases`,
    )
    const database = databases.databases[0]
    if (!database) {
      throw new ProviderApiError(
        'neon',
        404,
        'no databases on branch',
        `branch ${input.branchId} has no databases — initialize the branch first`,
      )
    }
    const params = new URLSearchParams({
      database_name: database.name,
      role_name: database.owner_name,
      pooled: input.pooled ? 'true' : 'false',
    })
    const body = await this.request<{ uri: string }>(
      'GET',
      `/projects/${input.projectId}/connection_uri?branch_id=${encodeURIComponent(input.branchId)}&${params.toString()}`,
    )
    return { branch: input.branchId, pooled: input.pooled, url: body.uri }
  }

  async deleteBranch(input: { projectId: string; branchId: string }): Promise<void> {
    await this.request('DELETE', `/projects/${input.projectId}/branches/${input.branchId}`)
  }

  async deleteProject(input: { projectId: string }): Promise<void> {
    await this.request('DELETE', `/projects/${input.projectId}`)
  }

  async resetBranch(input: {
    projectId: string
    branchId: string
    sourceBranchId: string
  }): Promise<void> {
    // Neon's "Restore branch" endpoint resets the target branch to match the
    // state of another branch. The previous state is preserved by Neon
    // under an automatic backup snapshot so the operation is reversible
    // within Neon, even though we treat it as one-way from the CLI.
    await this.request('POST', `/projects/${input.projectId}/branches/${input.branchId}/restore`, {
      source_branch_id: input.sourceBranchId,
    })
  }

  async enableExtension(input: {
    projectId: string
    branchId: string
    extension: string
  }): Promise<void> {
    // Neon doesn't have a dedicated "create extension" endpoint — extensions
    // are created by running SQL on the branch via the SQL Endpoint
    // (https://console.neon.tech/api/v2/projects/{id}/branches/{branchId}/databases/{name}/run_sql).
    const databases = await this.request<{ databases: NeonDbShape[] }>(
      'GET',
      `/projects/${input.projectId}/branches/${input.branchId}/databases`,
    )
    const database = databases.databases[0]
    if (!database) {
      throw new ProviderApiError(
        'neon',
        404,
        'no databases on branch',
        `branch ${input.branchId} has no databases — initialize the branch first`,
      )
    }
    await this.request(
      'POST',
      `/projects/${input.projectId}/branches/${input.branchId}/databases/${encodeURIComponent(database.name)}/run_sql`,
      { query: `CREATE EXTENSION IF NOT EXISTS "${input.extension}"` },
    )
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new ProviderApiError('neon', response.status, text)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

// --- raw response shapes (intentionally narrow; only fields we use) -------

interface NeonProjectShape {
  id: string
  name: string
}

interface NeonBranchShape {
  id: string
  name: string
  parent_id?: string
  created_at: string
}

interface NeonDbShape {
  id: number
  name: string
  owner_name: string
}

function mapProject(raw: NeonProjectShape): DbProject {
  return { id: raw.id, name: raw.name }
}

function mapBranch(raw: NeonBranchShape): DbBranch {
  return {
    id: raw.id,
    name: raw.name,
    parentId: raw.parent_id ?? null,
    createdAt: raw.created_at,
  }
}
