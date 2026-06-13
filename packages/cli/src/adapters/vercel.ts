// Vercel implementation of DeployProvider.
// API reference: https://vercel.com/docs/rest-api

import { ProviderApiError } from '../domain/errors'
import type {
  DeployDomain,
  DeployEnvScope,
  DeployEnvVar,
  DeployProject,
  DeployProvider,
} from '../domain/deploy'

const BASE_URL = 'https://api.vercel.com'

export interface VercelDeployProviderOptions {
  apiToken: string
  teamId?: string
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Override base URL for tests. */
  baseUrl?: string
}

export class VercelDeployProvider implements DeployProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: VercelDeployProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? BASE_URL
  }

  async createProject(input: {
    name: string
    repo: string
    rootDirectory: string
  }): Promise<DeployProject> {
    const result = await this.request<VercelProjectShape>('POST', `/v11/projects`, {
      name: input.name,
      framework: 'nextjs',
      gitRepository: { type: 'github', repo: input.repo },
      rootDirectory: input.rootDirectory,
    })
    return mapProject(result)
  }

  async listProjects(): Promise<DeployProject[]> {
    const result = await this.request<{ projects: VercelProjectShape[] }>('GET', `/v10/projects`)
    return result.projects.map(mapProject)
  }

  async getProjectByName(input: { name: string }): Promise<DeployProject | null> {
    try {
      const result = await this.request<VercelProjectShape>(
        'GET',
        `/v10/projects/${encodeURIComponent(input.name)}`,
      )
      return mapProject(result)
    } catch (e) {
      if (e instanceof ProviderApiError && e.status === 404) return null
      throw e
    }
  }

  async setEnv(input: {
    projectId: string
    key: string
    value: string
    scopes: DeployEnvScope[]
  }): Promise<DeployEnvVar> {
    // Vercel's "upsert=true" param creates if missing, updates if present.
    const result = await this.request<VercelEnvShape>(
      'POST',
      `/v10/projects/${input.projectId}/env?upsert=true`,
      {
        key: input.key,
        value: input.value,
        target: input.scopes,
        type: 'encrypted',
      },
    )
    return mapEnv(result)
  }

  async listEnv(input: { projectId: string }): Promise<DeployEnvVar[]> {
    const result = await this.request<{ envs: VercelEnvShape[] }>(
      'GET',
      `/v9/projects/${input.projectId}/env`,
    )
    return result.envs.map(mapEnv)
  }

  async addDomain(input: {
    projectId: string
    hostname: string
    branch?: string
  }): Promise<DeployDomain> {
    const result = await this.request<VercelDomainShape>(
      'POST',
      `/v10/projects/${input.projectId}/domains`,
      {
        name: input.hostname,
        ...(input.branch ? { gitBranch: input.branch } : {}),
      },
    )
    return mapDomain(result)
  }

  async removeDomain(input: { projectId: string; hostname: string }): Promise<void> {
    await this.request(
      'DELETE',
      `/v9/projects/${input.projectId}/domains/${encodeURIComponent(input.hostname)}`,
    )
  }

  async deleteProject(input: { projectId: string }): Promise<void> {
    await this.request('DELETE', `/v9/projects/${encodeURIComponent(input.projectId)}`)
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl)
    if (this.options.teamId) url.searchParams.set('teamId', this.options.teamId)
    const response = await this.fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.options.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new ProviderApiError('vercel', response.status, text)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

interface VercelProjectShape {
  id: string
  name: string
  rootDirectory?: string | null
}

interface VercelEnvShape {
  id: string
  key: string
  target: DeployEnvScope[]
}

interface VercelDomainShape {
  name: string
  gitBranch?: string | null
}

function mapProject(raw: VercelProjectShape): DeployProject {
  return {
    id: raw.id,
    name: raw.name,
    rootDirectory: raw.rootDirectory ?? null,
  }
}

function mapEnv(raw: VercelEnvShape): DeployEnvVar {
  return { id: raw.id, key: raw.key, scopes: raw.target }
}

function mapDomain(raw: VercelDomainShape): DeployDomain {
  return { name: raw.name, branch: raw.gitBranch ?? null }
}
