// Lazy adapter factory. Each adapter validates its own env vars on
// instantiation. The CLI never preloads all of them so commands stay
// usable when only some services are configured.
//
// The tracker() adapter is special — it reads rando.config.json to
// decide which implementation to instantiate, then validates only that
// one's env vars. This is the seam between Jira and GitHub Issues.

import { resolve } from 'node:path'
import { z } from 'zod'
import type { ApiCollectionProvider } from './domain/api-testing'
import type { DbProvider } from './domain/db'
import type { DeployProvider } from './domain/deploy'
import type { DnsProvider } from './domain/dns'
import type { GhProvider } from './domain/gh'
import type { IssueTrackerProvider } from './domain/tracker'
import type { PostmanProvider } from './domain/postman'
import type { SecretsProvider } from './domain/secrets'
import type { TunnelProvider } from './domain/tunnel'
import type { VercelCliProvisioner } from './domain/vercel-cli'
import { MissingConfigError } from './domain/errors'
import { NeonDbProvider } from './adapters/neon'
import { CloudflareTunnelProvider } from './adapters/cloudflare-tunnel'
import { CloudflareDnsProvider } from './adapters/cloudflare-dns'
import { GhCliProvider } from './adapters/gh-cli'
import { GitHubIssuesProvider } from './adapters/github-issues'
import { JiraCloudProvider } from './adapters/jira-cloud'
import { OpCliProvider } from './adapters/op-cli'
import { PostmanRestProvider } from './adapters/postman'
import { VercelCliAdapter } from './adapters/vercel-cli'
import { VercelDeployProvider } from './adapters/vercel'
import { loadSetupConfig } from './setup-config'

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

const GitHubEnv = z.object({
  GITHUB_TOKEN: z.string().min(1),
})

const PostmanEnv = z.object({
  POSTMAN_API_KEY: z.string().min(1),
})

export interface Adapters {
  db(): DbProvider
  tunnel(): TunnelProvider
  dns(): DnsProvider
  deploy(): DeployProvider
  /**
   * Issue tracker — Jira or GitHub Issues depending on
   * `tracker.kind` in rando.config.json.
   */
  tracker(opts?: { configPath?: string }): IssueTrackerProvider
  /**
   * Vendor-neutral api-testing adapter — dispatches on
   * `testing.api.kind` in rando.config.json. Use this from commands
   * that should work for any future api-testing tool (Bruno, Insomnia)
   * once we add the adapter.
   */
  apiTesting(opts?: { configPath?: string }): ApiCollectionProvider
  /**
   * Postman REST API — for Postman-specific commands
   * (`rando api postman *`) and `rando init`'s workspace picker. Errors
   * when `testing.api.kind` isn't `postman`.
   */
  postman(opts?: { configPath?: string }): PostmanProvider
  /**
   * Secret vault — 1Password CLI by default. Throws when the user
   * isn't signed in; callers should treat any failure as "skip 1P,
   * fall back to interactive prompts".
   */
  secrets(): SecretsProvider
  /**
   * GitHub CLI — for admin ops outside the IssueTrackerProvider
   * surface (setting repo Actions secrets, etc.). Auth is handled
   * by `gh` itself (keychain / GH_TOKEN env var).
   */
  gh(): GhProvider
  /**
   * Vercel CLI — for marketplace-storage ops the REST API doesn't
   * expose (Vercel-managed Neon provisioning, currently). Auth is
   * handled by `vercel` itself (login session / VERCEL_TOKEN env).
   */
  vercelCli(): VercelCliProvisioner
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
    tracker: (opts) => {
      const cfg = loadSetupConfig(resolve(process.cwd(), opts?.configPath ?? 'rando.config.json'))
      const tracker = cfg.tracker
      if (!tracker) {
        throw new MissingConfigError('tracker', 'issue-tracker')
      }
      if (tracker.kind === 'jira') {
        const jira = tracker.jira
        if (!jira) {
          throw new Error(
            'tracker.kind="jira" requires a tracker.jira block in rando.config.json (projectKey + transitions).',
          )
        }
        const parsed = JiraEnv.safeParse(env)
        if (!parsed.success) throw missingVar(parsed.error, 'jira')
        return new JiraCloudProvider({
          baseUrl: parsed.data.JIRA_BASE_URL,
          email: parsed.data.JIRA_EMAIL,
          apiToken: parsed.data.JIRA_API_TOKEN,
          projectKey: jira.projectKey,
          transitions: jira.transitions,
        })
      }
      if (tracker.kind === 'github') {
        const parsed = GitHubEnv.safeParse(env)
        if (!parsed.success) throw missingVar(parsed.error, 'github')
        return new GitHubIssuesProvider({
          token: parsed.data.GITHUB_TOKEN,
          repo: cfg.repo,
          labels: tracker.github.labels,
        })
      }
      throw new Error(`tracker.kind="${tracker.kind satisfies never}" is not a supported tracker`)
    },
    apiTesting: (opts) => {
      // Reads testing.api.kind to pick the implementation. Today only
      // `postman` is wired — adding bruno/insomnia means extending the
      // zod enum + adding a branch here. Returns the high-level
      // ApiCollectionProvider; consumers that need vendor-specific
      // methods should use postman() instead.
      const kind = readApiTestingKind(opts?.configPath) ?? 'postman'
      if (kind === 'postman') {
        const parsed = PostmanEnv.safeParse(env)
        if (!parsed.success) throw missingVar(parsed.error, 'postman')
        return new PostmanRestProvider({ apiKey: parsed.data.POSTMAN_API_KEY })
      }
      throw new Error(
        `testing.api.kind="${kind satisfies never}" is not a supported api-testing kind`,
      )
    },
    postman: (opts) => {
      // Hard-gate on kind so vendor-specific commands fail clearly when
      // the user has switched the project to a non-Postman tool.
      const kind = readApiTestingKind(opts?.configPath) ?? 'postman'
      if (kind !== 'postman') {
        throw new Error(
          `testing.api.kind="${kind}" — the rando.config.json says this project doesn't use Postman. Switch testing.api.kind to "postman" or use the active provider's commands.`,
        )
      }
      const parsed = PostmanEnv.safeParse(env)
      if (!parsed.success) throw missingVar(parsed.error, 'postman')
      return new PostmanRestProvider({ apiKey: parsed.data.POSTMAN_API_KEY })
    },
    secrets: () => {
      // Read the account UUID from rando.config.json so every `op`
      // call targets the same account (the user may have multiple
      // signed in — Personal + Family + Business + work). Config
      // load is best-effort: if rando.config.json is missing or the
      // secrets block isn't set, the adapter falls back to the
      // default account.
      let account: string | undefined
      try {
        const cfg = loadSetupConfig(resolve(process.cwd(), 'rando.config.json'))
        account = cfg.secrets?.account
      } catch {
        // Config not loadable — fine, the adapter handles this.
      }
      return new OpCliProvider({ account })
    },
    gh: () => new GhCliProvider(),
    vercelCli: () => {
      // Pass the token + team scope if they're set so commands target
      // the team that owns the project. VERCEL_TEAM_ID accepts either
      // the team slug ("rando-id") or the UUID; both work as --scope.
      const token = env.VERCEL_TOKEN ?? undefined
      const scope = env.VERCEL_TEAM_ID ?? undefined
      return new VercelCliAdapter({ token, scope })
    },
  }
}

function missingVar(error: z.ZodError, adapter: string): MissingConfigError {
  const first = error.issues[0]
  const variable = first?.path[0]?.toString() ?? '<unknown>'
  return new MissingConfigError(variable, adapter)
}

/**
 * Best-effort read of `testing.api.kind` from rando.config.json. Returns
 * undefined when the file is unreadable or the block isn't set — callers
 * default to `'postman'` for backward compat.
 */
function readApiTestingKind(configPath?: string): 'postman' | undefined {
  try {
    const cfg = loadSetupConfig(resolve(process.cwd(), configPath ?? 'rando.config.json'))
    return cfg.testing?.api?.kind
  } catch {
    return undefined
  }
}
