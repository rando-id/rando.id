// GitHub CLI integration — narrowly scoped to admin operations that
// don't fit the IssueTrackerProvider port (which is about issues +
// lifecycle, not repo settings). For now: setting repo Actions secrets
// so `rando secrets push <VAR>` can land OP_SERVICE_ACCOUNT_TOKEN
// without the user juggling Settings → Secrets in the UI.
//
// Implementation shells out to `gh` because `gh secret set` handles
// the Libsodium encryption + public-key fetch that the raw REST API
// requires. Doing it ourselves would be 30 lines of crypto for no
// gain.

export interface GhProvider {
  /**
   * Verify `gh` is installed and the user is authenticated against
   * github.com. Throws on either failure so callers can surface a
   * clear "run `gh auth login`" hint instead of a cryptic process-
   * exit code.
   */
  whoami(): Promise<{ login: string }>

  /**
   * Set a GitHub Actions repo secret. Idempotent — `gh` creates the
   * secret if absent, updates if present. `repo` is "owner/name".
   * Returns the action taken so the CLI can print "created" vs
   * "updated" — `gh` itself only prints "Set Actions secret X".
   */
  setRepoSecret(input: { repo: string; name: string; value: string }): Promise<void>
}
