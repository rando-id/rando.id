// Lazy adapter factory. Each adapter validates its own env vars on
// instantiation. The CLI never preloads all of them so commands stay
// usable when only some services are configured.

import { z } from 'zod'
import type { DbProvider } from './domain/db'
import type { DeployProvider } from './domain/deploy'
import type { DnsProvider } from './domain/dns'
import type { JiraProvider } from './domain/jira'
import type { TunnelProvider } from './domain/tunnel'
import { MissingConfigError } from './domain/errors'
import { NeonDbProvider } from './adapters/neon'
import { CloudflareTunnelProvider } from './adapters/cloudflare-tunnel'
import { CloudflareDnsProvider } from './adapters/cloudflare-dns'
import { JiraCloudProvider } from './adapters/jira-cloud'
import { VercelDeployProvider } from './adapters/vercel'

const NeonEnv = z.object({
  NEON_API_KEY: z.string().min(1),
})

const CloudflareEnv = z.object({
  CLOUDFLARE_API_TOKEN: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
})

const VercelEnv = z.object({
  VERCEL_TOKEN: z.string().min(1),
  VERCEL_TEAM_ID: z.string().optional(),
})

const JiraEnv = z.object({
  JIRA_BASE_URL: z.string().url(),
  JIRA_EMAIL: z.string().email(),
  JIRA_API_TOKEN: z.string().min(1),
})

export interface Adapters {
  db(): DbProvider
  tunnel(): TunnelProvider
  dns(): DnsProvider
  deploy(): DeployProvider
  jira(): JiraProvider
}

/**
 * Adapter factory. Each getter validates only the env vars its underlying
 * adapter requires; throws MissingConfigError if a required var is unset.
 */
export function createAdapters(env: NodeJS.ProcessEnv = process.env): Adapters {
  return {
    db: () => {
      const parsed = NeonEnv.safeParse(env)
      if (!parsed.success) throw missingVar(parsed.error, 'neon')
      return new NeonDbProvider({ apiKey: parsed.data.NEON_API_KEY })
    },
    tunnel: () => {
      const parsed = CloudflareEnv.safeParse(env)
      if (!parsed.success) throw missingVar(parsed.error, 'cloudflare-tunnel')
      return new CloudflareTunnelProvider({
        apiToken: parsed.data.CLOUDFLARE_API_TOKEN,
        accountId: parsed.data.CLOUDFLARE_ACCOUNT_ID,
      })
    },
    dns: () => {
      const parsed = CloudflareEnv.safeParse(env)
      if (!parsed.success) throw missingVar(parsed.error, 'cloudflare-dns')
      return new CloudflareDnsProvider({
        apiToken: parsed.data.CLOUDFLARE_API_TOKEN,
      })
    },
    deploy: () => {
      const parsed = VercelEnv.safeParse(env)
      if (!parsed.success) throw missingVar(parsed.error, 'vercel')
      return new VercelDeployProvider({
        apiToken: parsed.data.VERCEL_TOKEN,
        teamId: parsed.data.VERCEL_TEAM_ID,
      })
    },
    jira: () => {
      const parsed = JiraEnv.safeParse(env)
      if (!parsed.success) throw missingVar(parsed.error, 'jira')
      return new JiraCloudProvider({
        baseUrl: parsed.data.JIRA_BASE_URL,
        email: parsed.data.JIRA_EMAIL,
        apiToken: parsed.data.JIRA_API_TOKEN,
      })
    },
  }
}

function missingVar(error: z.ZodError, adapter: string): MissingConfigError {
  const first = error.issues[0]
  const variable = first?.path[0]?.toString() ?? '<unknown>'
  return new MissingConfigError(variable, adapter)
}
