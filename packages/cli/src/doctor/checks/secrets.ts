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
        let secretsConfig: { localVault: string; field: string; envCount: number } | undefined
        try {
          const cfg = loadSetupConfig(configPath)
          if (cfg.secrets) {
            const envCount =
              1 + (cfg.secrets.vaults.staging ? 1 : 0) + (cfg.secrets.vaults.prod ? 1 : 0)
            secretsConfig = {
              localVault: cfg.secrets.vaults.local,
              field: cfg.secrets.field,
              envCount,
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
        try {
          const provider = adapters.secrets()
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
