// Dev tunnel domain interface. Implemented by vendor-specific adapters
// (Cloudflare Tunnel, ngrok, etc.). A "tunnel" is the persistent connector;
// "routes" are the public-hostname → local-service mappings on it.

export interface Tunnel {
  id: string
  name: string
}

export interface TunnelRoute {
  id: string
  /** Public hostname (e.g. "dev-api.rando-id.dev"). */
  hostname: string
  /** Service target the tunnel forwards to (e.g. "http://host.docker.internal:4000"). */
  service: string
}

export interface TunnelProvider {
  /** Create a new tunnel. */
  createTunnel(input: { name: string }): Promise<Tunnel>

  /** List tunnels visible to this account. */
  listTunnels(): Promise<Tunnel[]>

  /** Fetch the connector token for a tunnel (used by cloudflared / equivalent). */
  getTunnelToken(input: { tunnelId: string }): Promise<string>

  /** Resolve a tunnel by its human-readable name. */
  getTunnelByName(input: { name: string }): Promise<Tunnel | null>

  /** Add a public-hostname → service route. */
  addRoute(input: { tunnelId: string; hostname: string; service: string }): Promise<TunnelRoute>

  /** List routes on a tunnel. */
  listRoutes(input: { tunnelId: string }): Promise<TunnelRoute[]>

  /** Remove a route by id. */
  removeRoute(input: { tunnelId: string; routeId: string }): Promise<void>

  /** Delete a tunnel entirely. */
  deleteTunnel(input: { tunnelId: string }): Promise<void>
}
