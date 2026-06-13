// Vercel implementation of DeployProvider.
// API reference: https://vercel.com/docs/rest-api

import { ProviderApiError } from '../domain/errors'
import type {
  Deployment,
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

  async triggerDeployment(input: { projectId: string; branch: string }): Promise<Deployment> {
    // Vercel's create-deployment endpoint needs the linked GitHub repoId,
    // which lives on the project's `link` object. Look it up first.
    const project = await this.request<VercelProjectShape>(
      'GET',
      `/v10/projects/${encodeURIComponent(input.projectId)}`,
    )
    const repoId = project.link?.repoId
    if (!repoId) {
      throw new ProviderApiError(
        'vercel',
        400,
        `project "${project.name}" has no linked GitHub repo`,
        'Cannot trigger a branch deploy on a project that is not linked to a Git provider. ' +
          'Link the repo via `rando deploy app create ... --repo <owner/name>` or the Vercel dashboard.',
      )
    }
    const raw = await this.request<VercelDeploymentShape>('POST', '/v13/deployments', {
      name: project.name,
      target: 'preview',
      gitSource: { type: 'github', ref: input.branch, repoId },
    })
    return mapDeployment(raw, input.branch)
  }

  async getDeployment(input: { deploymentId: string }): Promise<Deployment> {
    const raw = await this.request<VercelDeploymentShape>(
      'GET',
      `/v13/deployments/${encodeURIComponent(input.deploymentId)}`,
    )
    return mapDeployment(raw, raw.meta?.githubCommitRef ?? null)
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
  /** Present when the project is linked to a Git provider (we only handle github). */
  link?: { type?: string; repoId?: number; repo?: string; org?: string } | null
}

interface VercelDeploymentShape {
  id: string
  url: string
  readyState: 'INITIALIZING' | 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED'
  meta?: { githubCommitRef?: string }
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

function mapDeployment(raw: VercelDeploymentShape, branch: string | null): Deployment {
  // Vercel returns `url` without scheme; we keep it consistent and prepend
  // https in the command layer when displaying.
  return {
    id: raw.id,
    url: raw.url,
    branch,
    state: normalizeState(raw.readyState),
  }
}

function normalizeState(s: VercelDeploymentShape['readyState']): Deployment['state'] {
  switch (s) {
    case 'INITIALIZING':
    case 'QUEUED':
      return 'queued'
    case 'BUILDING':
      return 'building'
    case 'READY':
      return 'ready'
    case 'ERROR':
      return 'error'
    case 'CANCELED':
      return 'canceled'
  }
}
