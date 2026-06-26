// Schema + type for `rando.config.json`. The single source of truth for what
// vendors back each adapter slot in the Rando CLI:
//
//   tracker.kind  →  github | jira
//   db.kind       →  neon
//   deploy.kind   →  vercel
//   dns.kind      →  cloudflare
//   tunnel.kind   →  cloudflare
//   vc.kind       →  github
//   testing.api.kind → postman
//   secrets.kind  →  1password
//
// Adding a new vendor (e.g. GitLab in place of GitHub for `vc`) means adding
// to the matching `kind` enum and wiring the new adapter in
// `packages/cli/src/config.ts`. No file-by-file grep required.
//
// Pure schema — no file I/O. Lives in @rando/config so apps can import the
// type without dragging in the CLI's runtime dependencies. The CLI's
// `loadSetupConfig` (file I/O) imports from here.

import { z } from 'zod'

export const SetupConfigSchema = z.object({
  /** JSON Schema reference for IDE autocomplete. Ignored at parse time. */
  $schema: z.string().optional(),

  /** Used as the Neon project name and the prefix for Vercel project names. */
  project: z.string().min(1),

  /** GitHub repo in "owner/name" form — Vercel needs this to link projects. */
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/name"'),

  /**
   * Tunnel vendor + name. The tunnel is created (or verified) by `rando
   * infrastructure setup` and routes local dev traffic to your machine.
   */
  tunnel: z
    .object({
      kind: z.enum(['cloudflare']).default('cloudflare'),
      /** Tunnel name (created if absent). */
      name: z.string().min(1).default('rando-dev'),
    })
    .default({ kind: 'cloudflare', name: 'rando-dev' }),

  /**
   * GitHub logins that `rando vc codeowners` writes into the `*` rule of
   * `.github/CODEOWNERS`. Optional — when absent, the generator falls back
   * to `<repo-owner>` from `repo`, which is the org name for org repos
   * (mentions the whole org rather than specific humans). Set this to a
   * list of real human logins for the typical solo / small-team case.
   */
  codeowners: z.array(z.string().min(1)).optional(),

  /**
   * DNS vendor. Today the orchestrator assumes the tunnel + DNS providers
   * are the same vendor; this block exists so a future split (e.g. tunnel
   * via Cloudflare, DNS via Route 53) doesn't require a schema rewrite.
   */
  dns: z
    .object({
      kind: z.enum(['cloudflare']).default('cloudflare'),
    })
    .default({ kind: 'cloudflare' }),

  /** Deploy / hosting vendor. */
  deploy: z
    .object({
      kind: z.enum(['vercel']).default('vercel'),
    })
    .default({ kind: 'vercel' }),

  /**
   * Version-control hosting vendor. Used by `rando vc setup` to know which
   * REST API surface to drive (rulesets, environments, secrets, repo
   * settings). Today only `github` is wired; a future GitLab/Bitbucket
   * adapter slots in here.
   */
  vc: z
    .object({
      kind: z.enum(['github']).default('github'),
    })
    .default({ kind: 'github' }),

  /** Apex domains for each domain group. */
  domains: z.object({
    /** Non-prod traffic (local + staging share this zone). */
    nonProd: z.string().min(1),
    /** Production. */
    production: z.string().min(1),
  }),

  /** Apps in the monorepo that get Vercel projects + tunnel routes. */
  apps: z
    .array(
      z.object({
        /** Short app name used in subdomains (e.g. "api", "web", "admin"). */
        name: z.string().min(1),
        /** Repo-relative root directory (e.g. "apps/api"). */
        rootDirectory: z.string().min(1),
        /** Local dev-server port that the tunnel routes to. */
        port: z.number().int().positive(),
        /**
         * If true, this app lives at the apex of the production domain
         * (e.g. web → rando.id, not web.rando.id). Only one app should set
         * this. Staging always uses the `staging-<name>` subdomain pattern.
         */
        prodApex: z.boolean().default(false),
      }),
    )
    .min(1),

  /**
   * Issue-tracker integration. Optional — when absent, `rando issues`
   * commands and the commit hook still work but they can't auto-
   * transition tickets through the Rando lifecycle (PR open → In
   * Progress, branch deploy → In Review, merge → Done).
   *
   * `tracker.kind` picks the adapter; the matching sub-block carries
   * the adapter-specific config. Run `rando issues doctor` after
   * filling this in to verify the wiring.
   */
  tracker: z
    .object({
      kind: z.enum(['github', 'jira']).default('github'),
      /**
       * Branches where the picker always prompts, ignoring any cached
       * key. Feature-branch caching makes sense (one ticket per
       * branch's lifetime); trunk branches don't — every commit on
       * `main` is typically a different concern. The picker treats
       * these as "always reset" so a stale cache from weeks ago
       * doesn't silently get re-applied.
       */
      protectedBranches: z.array(z.string().min(1)).default(['main', 'master']),
      /** Required when kind is "github". Defaults give sensible label names. */
      github: z
        .object({
          /**
           * Lifecycle slot → label name. The adapter adds the slot's
           * label and removes the others (and any other label starting
           * with `status:`) when applyLifecycle fires.
           */
          labels: z
            .object({
              inProgress: z.string().min(1).default('status:in-progress'),
              inReview: z.string().min(1).default('status:in-review'),
            })
            .default({
              inProgress: 'status:in-progress',
              inReview: 'status:in-review',
            }),
        })
        .default({
          labels: {
            inProgress: 'status:in-progress',
            inReview: 'status:in-review',
          },
        }),
      /** Required when kind is "jira". */
      jira: z
        .object({
          projectKey: z.string().min(1),
          /**
           * Map from semantic lifecycle state → Jira transition name OR
           * id. Either works; the doctor command shows both.
           */
          transitions: z
            .object({
              inProgress: z.string().min(1).optional(),
              inReview: z.string().min(1).optional(),
              done: z.string().min(1).optional(),
            })
            .partial()
            .default({}),
        })
        .optional(),
    })
    .optional(),

  /**
   * Database provisioning + behavior. Only meaningful for the
   * `rando infrastructure setup` orchestrator; everyday CLI commands
   * (`rando db ...`) talk to Neon directly and ignore this block.
   *
   * `managedBy: 'vercel'` switches the project-creation step from
   * direct Neon-API calls to `vercel install neon`, because
   * Vercel-managed Neon orgs reject direct creates with
   * "action restricted; reason: organization is managed by Vercel".
   */
  db: z
    .object({
      kind: z.enum(['neon']).default('neon'),
      managedBy: z.enum(['standalone', 'vercel']).default('standalone'),
      /**
       * Vercel marketplace plan for `vercel install neon`. Vercel
       * versioned these (`free` → `free_v3` etc.) — keep this in sync
       * with the upstream marketplace.
       */
      plan: z.string().min(1).default('free_v3'),
    })
    .optional(),

  /**
   * Test-tooling integrations. `testing.api` configures the tool that
   * mirrors / exercises the API surface — currently only Postman is
   * wired up, but the `kind` discriminator leaves room for swaps
   * (Insomnia, Bruno, Newman-only CI) without a schema break. Optional;
   * `rando api postman sync` + `rando init`'s Postman step both read
   * this. `workspaceId` can also be passed via `--workspace` on the CLI.
   */
  testing: z
    .object({
      api: z
        .object({
          kind: z.enum(['postman']).default('postman'),
          workspaceId: z.string().min(1).optional(),
          /** Collection name shown in Postman. Defaults to "Rando API". */
          collectionName: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),

  /**
   * 1Password Secret-manager integration. When set, `rando init`,
   * `rando secrets sync`, and `rando secrets set` route every secret
   * through the configured 1Password **Environment** before/instead
   * of touching `.env`.
   *
   * Convention: each variable inside an Environment is named exactly
   * as the env var name (NEON_API_KEY, VERCEL_TOKEN, etc.) with the
   * value stored directly. Environments are flat KEY=VALUE stores —
   * no items, no titles, no field structures. `op environment read
   * <env-id>` dumps every variable as KEY=VALUE lines. Adding a new
   * env var means adding a new variable with that name to whichever
   * Environment(s) need it, via the 1Password desktop app or
   * `rando secrets set <name>`.
   *
   * Note: these are 1Password **Environments**, not Vaults — distinct
   * 1Password features. Vault `op://<vault>/<item>/<field>` references
   * do NOT work against Environment IDs (the op CLI rejects with
   * "This operation cannot be performed on 1Password Environments").
   * The only access path is `op environment read <env-id>`.
   */
  secrets: z
    .object({
      kind: z.enum(['1password']).default('1password'),
      /**
       * 1Password account UUID — passed as --account on every `op`
       * call so commands always target the right account, even when
       * the user has multiple accounts configured. Find it via
       * `op account list --format=json`.
       */
      account: z.string().min(1).optional(),
      /**
       * Legacy: the field name on vault-based items, for any code
       * paths that still build `op://<vault>/<item>/<field>`
       * references against a Vault (not an Environment — those
       * don't have fields).
       */
      field: z.string().min(1).default('credential'),
      /**
       * 1Password Environment IDs per deploy environment. `local` is
       * required since it's the default for everyday dev work;
       * `staging` + `prod` are optional until you need them. Find IDs
       * via the 1Password desktop app's Developer panel.
       */
      environments: z.object({
        local: z.string().min(1),
        staging: z.string().min(1).optional(),
        prod: z.string().min(1).optional(),
      }),
    })
    .optional(),
})

/** Valid env names for the `secrets.environments` block. */
export type SecretsEnv = 'local' | 'staging' | 'prod'
export const ALL_SECRETS_ENVS: SecretsEnv[] = ['local', 'staging', 'prod']

export type SetupConfig = z.infer<typeof SetupConfigSchema>
