// Secrets check — surfaces "is `op` signed in?" so `rando init` /
// `rando secrets sync` won't silently fall back to interactive prompts
// without the user understanding why. Soft-warn (not fail) — 1Password
// is optional; the rest of the CLI works without it.

import type { Adapters } from '../../config'
import { loadSetupConfig, SetupConfigError } from '../../setup-config'
import type { Check, CheckResult } from '../types'

export function secretsChecks(adapters: Adapters, configPath = 'rando.config.json'): Check[] {
  return [
    {
      section: 'Secrets',
      name: '1Password',
      async run(): Promise<CheckResult> {
        let secretsConfig:
          | { localVault: string; field: string; envCount: number; account?: string }
          | undefined
        try {
          const cfg = loadSetupConfig(configPath)
          if (cfg.secrets) {
            const envCount =
              1 + (cfg.secrets.vaults.staging ? 1 : 0) + (cfg.secrets.vaults.prod ? 1 : 0)
            secretsConfig = {
              localVault: cfg.secrets.vaults.local,
              field: cfg.secrets.field,
              envCount,
              account: cfg.secrets.account,
            }
          }
        } catch (e) {
          if (e instanceof SetupConfigError) {
            return {
              status: 'warn',
              subject: 'rando.config.json not loadable',
              hint: e.message,
            }
          }
          throw e
        }
        if (!secretsConfig) {
          return {
            status: 'warn',
            subject: 'not configured',
            hint: 'Add a `secrets` block to rando.config.json (kind, account, field, vaults.local) to enable vault-driven setup',
          }
        }
        const provider = adapters.secrets()
        // Pre-flight: does the configured account UUID match an account
        // the local CLI actually knows about? Catches the easy mistake
        // of pasting user_uuid into secrets.account (both are UUIDs
        // that sit right next to each other in the whoami JSON) — the
        // symptom otherwise is "not signed in" with no biometric
        // prompt, which is hard to diagnose.
        if (secretsConfig.account) {
          try {
            const accounts = await provider.listAccounts()
            const matched = accounts.find((a) => a.accountUuid === secretsConfig!.account)
            if (!matched) {
              const userUuidMatch = accounts.find((a) => a.userUuid === secretsConfig!.account)
              if (userUuidMatch) {
                return {
                  status: 'fail',
                  subject: 'rando.config.json secrets.account is a user_uuid, not an account_uuid',
                  hint: `change it to "${userUuidMatch.accountUuid}" (the matching account_uuid for ${userUuidMatch.email})`,
                }
              }
              return {
                status: 'fail',
                subject: 'rando.config.json secrets.account does not match any signed-in account',
                hint:
                  accounts.length === 0
                    ? 'run `op signin` first, then re-run doctor'
                    : `available account_uuids: ${accounts.map((a) => `${a.accountUuid} (${a.email})`).join(', ')}`,
              }
            }
          } catch {
            // listAccounts failed — fall through to whoami below for
            // a more verbose error from op itself.
          }
        }
        try {
          const me = await provider.whoami()
          return {
            status: 'ok',
            subject: `signed in as ${me.account} → ${secretsConfig.envCount} vault(s) configured`,
          }
        } catch (e) {
          return {
            status: 'warn',
            subject: 'op CLI not signed in',
            hint:
              e instanceof Error
                ? `${e.message} — run \`op signin\` and re-run doctor`
                : 'run `op signin` and re-run doctor',
          }
        }
      },
    },
  ]
}
