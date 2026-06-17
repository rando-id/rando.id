// Secret-vault integration — abstracted so 1Password isn't the only
// possible backend long-term. For now the only adapter is op-cli, which
// shells out to the local `op` CLI rather than the 1Password SDK.
//
// Why CLI not SDK: the SDK needs a OP_SERVICE_ACCOUNT_TOKEN bootstrap
// secret in env, couples application code to a vendor, and breaks
// Next's build-time NEXT_PUBLIC_* env-baking. The CLI flow keeps the
// existing `.env` cache pattern intact — 1Password is the source of
// truth, the `.env` file is the working copy.

/**
 * Identifies who/what is authenticated against the vault. Surfaces in
 * `rando doctor` and as a "you'll fetch from this account" preamble
 * before `rando init` does its read loop.
 */
export interface SecretsIdentity {
  /** Email or username of the signed-in account. */
  account: string
  /** Account URL (e.g. https://my.1password.com). */
  url: string
}

/**
 * One entry per account the local CLI knows about. Used to validate
 * that the account UUID pinned in rando.config.json actually matches
 * an account this machine can authenticate against — catches the easy
 * mistake of pasting user_uuid (also a UUID-shaped string sitting
 * right next to account_uuid in the whoami JSON) into the config.
 */
export interface SecretsAccount {
  accountUuid: string
  userUuid: string
  url: string
  email: string
}

export interface SecretsProvider {
  /**
   * Return identity if currently signed in; throw otherwise. Used to
   * skip the 1P flow gracefully when the user hasn't run `op signin`.
   */
  whoami(): Promise<SecretsIdentity>

  /**
   * List every account the local CLI is configured to talk to. Does
   * NOT require an active signed-in session — `op account list` reads
   * the CLI's local config. Used by doctor to sanity-check the
   * configured account UUID against what's actually set up.
   */
  listAccounts(): Promise<SecretsAccount[]>

  /**
   * Resolve a secret reference. For 1Password this is the `op://<vault>/<item>/<field>`
   * URI. Returns the literal value of the field.
   *
   * Throws if the reference doesn't resolve (item missing, field
   * missing, not signed in, etc.). Callers fall back to interactive
   * prompts on throw.
   */
  read(reference: string): Promise<string>

  /**
   * Create or update an item in the vault, storing `value` under
   * `field`. Used by `rando secrets save` so a manually-entered token
   * doesn't get lost — it ends up back in 1Password where the next
   * machine can fetch it.
   *
   * Implementations may upsert: if an item with this name already
   * exists, update its field; otherwise create.
   */
  write(input: { vault: string; item: string; field: string; value: string }): Promise<void>

  /**
   * Bulk-read every secret from a 1Password Environment. Returns a
   * key→value map. Used by `rando infrastructure setup` to push
   * staging/prod secrets onto Vercel projects without having to
   * enumerate each var individually.
   *
   * Requires the underlying CLI (`op` >= 2.35) to support the
   * `environment read` subcommand. Service accounts that have access
   * to the environment can call this; user accounts with biometric
   * unlock also work.
   */
  readEnvironment(environmentId: string): Promise<Record<string, string>>
}
