# GitHub Environments — what's ours, what's Vercel's, what to do with each

If you open Settings → Environments, you'll see something like this:

```
Preview
Preview – rando-admin
Preview – rando-api
Preview – rando-web
production
Production – rando-admin
Production – rando-api
Production – rando-web
staging
```

**Don't panic, don't rename anything, don't delete anything.** Half of
them are ours, half are Vercel's, they don't conflict, and each side
needs the ones it has.

## Which are which

| Env                             | Created by                         | Read by today                                                     | Purpose today                                                                                                                                                             |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staging`                       | `rando vc environments` (us)       | **Nothing**                                                       | **Scaffold.** Provisioned in advance so reviewers / branch-protection rules can be added without a CLI change. No workflow currently declares `environment: staging`.     |
| `production`                    | `rando vc environments` (us)       | `deploy-production.yml` (declares `environment: production`, L70) | **Reviewer gate only.** The deploy workflow waits at this env for human approval before running. Secrets are still loaded from 1Password via `op-env`, NOT from this env. |
| `Preview`                       | Vercel's GitHub integration (auto) | Vercel itself                                                     | Repo-wide preview env-var sync. Each Vercel deploy on a non-`main` branch reads vars from here.                                                                           |
| `Preview – rando-<app>` (×3)    | Same                               | Vercel                                                            | Per-project preview env-vars. Overrides the repo-wide `Preview` env for that specific project.                                                                            |
| `Production – rando-<app>` (×3) | Same                               | Vercel                                                            | Per-project production env-vars. Read on `main`-branch deploys for that project.                                                                                          |

### Today vs future

**Today**: GH Environments are gates (production = reviewer wait;
staging = unused placeholder). All actual secrets live in **1Password
Environments** (read by `op-env` at the top of each deploy workflow)
and **Vercel-managed envs** (read by Vercel at deploy time per
project). There's no automatic sync between the two.

**Future** (once `#245 vc secret-sync` lands): GH Environments become
the runtime source-of-truth for CI secrets, fed by 1P via the sync.
`op-env` composite retires; the staging GH env starts getting read.

## Naming, briefly

Vercel derives env names from the Vercel project's display name (the project named `rando-web` → environment `Production – rando-web`). The space-en-dash-space is Vercel's UI convention, not ours.

**Don't rename the Vercel-side ones.** Renaming a Vercel project breaks deploy hooks + project URLs; the environments are downstream of that.

Our `staging` + `production` are deliberately lower-case + ungarnished so the names are stable when we eventually swap deploy vendors (the `deploy` block in `rando.config.json` carries a `kind: 'vercel'` discriminator — see `tech-clients-monorepo`).

## Where does a given secret go?

**Today** — secrets do NOT live in our GH Environments. The mapping is:

| Secret consumer                                                                                            | Put it on                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A Vercel build / runtime** needs it at deploy time (`DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_*`) | The Vercel-side env: `Production – rando-<app>` (per app) or `Preview – rando-<app>`                                                                                                                                |
| **A GitHub workflow** needs it (`VERCEL_TOKEN` for `rando deploy promote`, `CLOUDFLARE_API_TOKEN`, etc.)   | The **1Password** environment matching the workflow's `op-env` step. Bootstrap secret `OP_SERVICE_ACCOUNT_TOKEN` IS in GitHub repo secrets (not env secrets) — it's the one secret needed to unlock all the others. |
| **Both**                                                                                                   | Put it in 1Password (manually or via `rando secrets push`); set it on the Vercel side via the Vercel dashboard or `vercel env add`. The two stores are independent until `#245` lands.                              |

Mental model **today**: **app secrets → Vercel envs; CI secrets → 1Password.** The GitHub `staging` / `production` envs are gates only, not secret stores.

Mental model **after #245**: CI secrets move into GH envs (synced from 1P); Vercel side unchanged. The mental model becomes "app secrets → Vercel envs; CI secrets → our GH envs."

## What you should NOT do

- **Don't delete `Preview – rando-<app>` or `Production – rando-<app>`.** Vercel will re-create them on the next deploy and any env vars you'd been storing elsewhere have to be re-set.
- **Don't rename either side.** Our names are referenced in workflow YAML; Vercel's names are derived from project names that are referenced in deploy hooks.
- **Don't add required reviewers to the Vercel-managed envs.** They'd be enforced on every Vercel deploy, blocking the auto-deploy flow. Reviewers belong on **our** `production` env only — that's the one our workflow waits on.
- **Don't put the same secret on both sides assuming they sync.** They don't. `rando vc secret-sync` (queued, #245) will make this safe; until then, treat the two sides as separate stores.

## What you CAN do

- Add required reviewers to **our** `production` env (currently empty — D4 of `process-deploy-strategy` documents this). Same for branch-protection rules on the GitHub Environment. `deploy-production.yml` will start waiting on the new reviewers automatically.
- Add reviewers to **our** `staging` env if you ever want staging deploys to be gated too — but no workflow currently consumes that gate, so the reviewer wait wouldn't fire. (A future `deploy-staging.yml` change that adds `environment: staging` would activate it.)
- Push a one-off secret via `pnpm rando vc secret <NAME> --env production --token "$PAT"` (reads value from stdin so plaintext doesn't hit shell history). Until #245 lands, this is most useful for the Vercel-managed envs (`--env "Production – rando-api"`) since our own envs aren't currently read by any workflow.
- Add new app-scoped secrets to the Vercel-side env via the Vercel dashboard, the `vercel env add` CLI, or `rando vc secret --env "Production – rando-api"` (the en-dash and spaces work as the env name).

## When this changes

- **#245 lands**: `rando vc secret-sync` will read 1Password and push the right secrets to the right envs based on a mapping in `rando.config.json`. No more manual env-var entry on either side.
- **Vendor swap**: if we ever move off Vercel (`deploy.kind` in `rando.config.json` changes), the Vercel-side envs become stale; `rando vc environments` would need a cleanup step to remove them.
