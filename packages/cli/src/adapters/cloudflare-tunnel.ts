// Cloudflare Tunnel (cfd_tunnel) implementation of TunnelProvider.
// API reference: https://developers.cloudflare.com/api/operations/cloudflare-tunnel-list-cloudflare-tunnels

import { NotFoundError, ProviderApiError } from '../domain/errors'
import type { Tunnel, TunnelProvider, TunnelRoute } from '../domain/tunnel'

const BASE_URL = 'https://api.cloudflare.com/client/v4'

export interface CloudflareTunnelProviderOptions {
  apiToken: string
  accountId: string
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Override base URL for tests. */
  baseUrl?: string
}

export class CloudflareTunnelProvider implements TunnelProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: CloudflareTunnelProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? BASE_URL
  }

  async createTunnel(input: { name: string }): Promise<Tunnel> {
    const result = await this.request<CfTunnelShape>(
      'POST',
      `/accounts/${this.options.accountId}/cfd_tunnel`,
      { name: input.name, config_src: 'cloudflare' },
    )
    return { id: result.id, name: result.name }
  }

  async listTunnels(): Promise<Tunnel[]> {
    const list = await this.request<CfTunnelShape[]>(
      'GET',
      `/accounts/${this.options.accountId}/cfd_tunnel?is_deleted=false`,
    )
    return list.map((t) => ({ id: t.id, name: t.name }))
  }

  async getTunnelByName(input: { name: string }): Promise<Tunnel | null> {
    const list = await this.listTunnels()
    return list.find((t) => t.name === input.name) ?? null
  }

  async getTunnelToken(input: { tunnelId: string }): Promise<string> {
    const token = await this.request<string>(
      'GET',
      `/accounts/${this.options.accountId}/cfd_tunnel/${input.tunnelId}/token`,
    )
    return token
  }

  async addRoute(input: {
    tunnelId: string
    hostname: string
    service: string
  }): Promise<TunnelRoute> {
    // Tunnel ingress is set as a full list on each PUT — fetch, append, write back.
    const config = await this.getTunnelConfig(input.tunnelId)
    const ingress = withoutCatchAll(config.ingress)
    const filtered = ingress.filter((rule) => rule.hostname !== input.hostname)
    filtered.push({ hostname: input.hostname, service: input.service })
    filtered.push({ service: 'http_status:404' }) // catch-all
    await this.putTunnelConfig(input.tunnelId, { ...config, ingress: filtered })
    return {
      id: input.hostname, // CF ingress entries are keyed by hostname, no separate id
      hostname: input.hostname,
      service: input.service,
    }
  }

  async listRoutes(input: { tunnelId: string }): Promise<TunnelRoute[]> {
    const config = await this.getTunnelConfig(input.tunnelId)
    return withoutCatchAll(config.ingress).map((rule) => ({
      id: rule.hostname ?? '',
      hostname: rule.hostname ?? '',
      service: rule.service,
    }))
  }

  async removeRoute(input: { tunnelId: string; routeId: string }): Promise<void> {
    const config = await this.getTunnelConfig(input.tunnelId)
    const ingress = withoutCatchAll(config.ingress)
    const filtered = ingress.filter((rule) => rule.hostname !== input.routeId)
    if (filtered.length === ingress.length) {
      throw new NotFoundError('tunnel route', input.routeId)
    }
    filtered.push({ service: 'http_status:404' })
    await this.putTunnelConfig(input.tunnelId, { ...config, ingress: filtered })
  }

  async deleteTunnel(input: { tunnelId: string }): Promise<void> {
    // `cascade=true` cleans up connections + the tunnel-managed DNS records
    // Cloudflare creates for each route. Without it, delete fails if any
    // connector ever connected.
    await this.request(
      'DELETE',
      `/accounts/${this.options.accountId}/cfd_tunnel/${input.tunnelId}?cascade=true`,
    )
  }

  private async getTunnelConfig(tunnelId: string): Promise<CfTunnelConfig> {
    const wrapper = await this.request<{ config: CfTunnelConfig }>(
      'GET',
      `/accounts/${this.options.accountId}/cfd_tunnel/${tunnelId}/configurations`,
    )
    return wrapper.config ?? { ingress: [] }
  }

  private async putTunnelConfig(tunnelId: string, config: CfTunnelConfig): Promise<void> {
    await this.request(
      'PUT',
      `/accounts/${this.options.accountId}/cfd_tunnel/${tunnelId}/configurations`,
      { config },
    )
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const fullUrl = `${this.baseUrl}${path}`
    let response: Response
    try {
      response = await this.fetch(fullUrl, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      throw new ProviderApiError('cloudflare', 0, `fetch ${method} ${fullUrl} failed: ${detail}`)
    }
    const text = await response.text()
    if (!response.ok) throw new ProviderApiError('cloudflare', response.status, text)
    if (!text) return undefined as T
    const parsed = JSON.parse(text) as CfEnvelope<T>
    if (!parsed.success) {
      throw new ProviderApiError('cloudflare', response.status, JSON.stringify(parsed.errors))
    }
    return parsed.result
  }
}

interface CfEnvelope<T> {
  success: boolean
  errors: unknown[]
  result: T
}

interface CfTunnelShape {
  id: string
  name: string
}

interface CfIngressRule {
  hostname?: string
  service: string
  path?: string
}

interface CfTunnelConfig {
  ingress: CfIngressRule[]
}

function withoutCatchAll(ingress: CfIngressRule[]): CfIngressRule[] {
  // The trailing rule (`{ service: 'http_status:404' }`) is mandatory; we
  // strip it for read operations and re-add on writes.
  return ingress.filter((rule) => !!rule.hostname)
}
