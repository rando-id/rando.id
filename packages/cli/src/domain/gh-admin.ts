// GitHub admin operations via REST API — separate from `GhProvider` because
// these calls need explicit token control for the ephemeral admin PAT
// lifecycle (see .notes/tool-gh-api-coverage.spec.md §"Ephemeral admin PAT").
// `GhProvider` uses `gh` CLI auth (keychain / GH_TOKEN); this adapter takes
// the token directly so the operator can scope a fresh PAT per run.
//
// Token cleanup is operator-driven (manual UI deletion) — GitHub has no
// REST endpoint for self-revoking a fine-grained PAT. The
// `DELETE /personal-access-tokens/{id}` endpoint is for ORG admins
// revoking other members' PATs, not self-revoke.

export interface GhRuleset {
  id: number
  name: string
  enforcement: 'active' | 'evaluate' | 'disabled'
  target?: string
}

export interface GhEnvironment {
  name: string
  /**
   * GitHub's environment-reviewer API requires the numeric `id` for both
   * User and Team reviewers — `login` is silently ignored. Resolve logins
   * to ids ahead of time (e.g. via `GET /users/{login}`) before calling
   * `upsertEnvironment`.
   */
  required_reviewers?: Array<{ type: 'User' | 'Team'; id: number }>
  wait_timer?: number
  prevent_self_review?: boolean
}

export interface GhRepoSettings {
  allow_squash_merge?: boolean
  allow_merge_commit?: boolean
  allow_rebase_merge?: boolean
  allow_auto_merge?: boolean
  delete_branch_on_merge?: boolean
  default_branch?: string
  has_issues?: boolean
  has_discussions?: boolean
}

export interface GhPublicKey {
  key_id: string
  /** Base64-encoded 32-byte curve25519 public key. */
  key: string
}

export interface GhAdminProvider {
  /** Sanity-check the token. Throws ProviderApiError on auth failure. */
  whoami(): Promise<{ login: string }>

  /** List active rulesets on the repo. */
  listRulesets(repo: string): Promise<GhRuleset[]>
  /** Create a new ruleset. Returns the created ruleset (with `id`). */
  createRuleset(repo: string, payload: Record<string, unknown>): Promise<GhRuleset>
  /** Update an existing ruleset by id. */
  updateRuleset(repo: string, id: number, payload: Record<string, unknown>): Promise<GhRuleset>

  /** Create or update an environment. Idempotent — `PUT` semantics. */
  upsertEnvironment(repo: string, env: GhEnvironment): Promise<void>

  /** Patch repo-level settings (squash/auto-merge/etc.). */
  updateRepoSettings(repo: string, settings: GhRepoSettings): Promise<void>

  /** Get the libsodium public key used to encrypt repo Actions secrets. */
  getRepoSecretPublicKey(repo: string): Promise<GhPublicKey>
  /** Get the libsodium public key for an environment's secrets. */
  getEnvironmentSecretPublicKey(repo: string, environment: string): Promise<GhPublicKey>

  /** Set a repo Actions secret (libsodium-encrypted value). */
  setRepoSecret(repo: string, name: string, encryptedValue: string, keyId: string): Promise<void>
  /** Set an environment secret. */
  setEnvironmentSecret(
    repo: string,
    environment: string,
    name: string,
    encryptedValue: string,
    keyId: string,
  ): Promise<void>

  // --- security toggles --------------------------------------------------
  // Five repo + org settings that were historically clicked through in the
  // GitHub UI but each has a documented REST endpoint. Idempotent — every
  // call either flips state or is a no-op against an already-flipped flag.

  /** Enable Dependabot vulnerability alerts (prereq for security updates). */
  enableVulnerabilityAlerts(repo: string): Promise<void>
  /** Enable Dependabot automated security update PRs. */
  enableAutomatedSecurityFixes(repo: string): Promise<void>
  /** Enable GitHub-native secret scanning + commit-time push protection. */
  enableSecretScanning(repo: string): Promise<void>
  /** Enable the private vulnerability reporting form (/security/advisories/new). */
  enablePrivateVulnerabilityReporting(repo: string): Promise<void>
  /**
   * Require 2FA across the org. Org-admin scope only. Destructive — boots
   * org members without 2FA on. Caller should confirm.
   */
  enableOrgTwoFactorRequirement(org: string): Promise<void>
}
