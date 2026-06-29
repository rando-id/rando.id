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

| Env                             | Created by                         | Read by                                   | Purpose                                                                                         |
| ------------------------------- | ---------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `staging`                       | `rando vc environments` (us)       | `.github/workflows/deploy-staging.yml`    | Workflow choke point — push-to-staging triggers our workflow which reads secrets from here.     |
| `production`                    | `rando vc environments` (us)       | `.github/workflows/deploy-production.yml` | Same shape as `staging`, plus required-reviewer gate (D4 from `process-deploy-strategy`).       |
| `Preview`                       | Vercel's GitHub integration (auto) | Vercel itself                             | Repo-wide preview env-var sync. Each Vercel deploy on a non-`main` branch reads vars from here. |
| `Preview – rando-<app>` (×3)    | Same                               | Vercel                                    | Per-project preview env-vars. Overrides the repo-wide `Preview` env for that specific project.  |
| `Production – rando-<app>` (×3) | Same                               | Vercel                                    | Per-project production env-vars. Read on `main`-branch deploys for that project.                |

## Naming, briefly

Vercel derives env names from the Vercel project's display name (the project named `rando-web` → environment `Production – rando-web`). The space-en-dash-space is Vercel's UI convention, not ours.

**Don't rename the Vercel-side ones.** Renaming a Vercel project breaks deploy hooks + project URLs; the environments are downstream of that.

Our `staging` + `production` are deliberately lower-case + ungarnished so the names are stable when we eventually swap deploy vendors (the env block in `rando.config.json` carries a `kind: 'vercel'` discriminator — see `tech-clients-monorepo`).

## Where does a given secret go?

| Secret consumer                                                                                                            | Put it on                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **A Vercel build / runtime** needs it at deploy time (`DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_*`)                 | The Vercel-side env: `Production – rando-<app>` (per app) or `Preview – rando-<app>`                         |
| **A GitHub workflow** needs it (a deploy token, `VERCEL_TOKEN` used by `rando deploy promote`, `OP_SERVICE_ACCOUNT_TOKEN`) | Our env: `production` or `staging`                                                                           |
| **Both**                                                                                                                   | Both. Easier: put it in 1Password, let `rando vc secret-sync` push to the right targets (queued — see #245). |

Mental model: **app secrets → Vercel envs; CI secrets → our envs.**

If you put a Vercel-bound secret on `production` (ours), Vercel won't see it and the build will fail with "undefined env var" at runtime. If you put a CI secret on `Production – rando-api` (Vercel's), our workflows won't see it and `gh actions` errors with `secret X not set in environment production`.

## What you should NOT do

- **Don't delete `Preview – rando-<app>` or `Production – rando-<app>`.** Vercel will re-create them on the next deploy and any env vars you'd been storing elsewhere have to be re-set.
- **Don't rename either side.** Our names are referenced in workflow YAML; Vercel's names are derived from project names that are referenced in deploy hooks.
- **Don't add required reviewers to the Vercel-managed envs.** They'd be enforced on every Vercel deploy, blocking the auto-deploy flow. Reviewers belong on **our** `production` env only — that's the one our workflow waits on.
- **Don't put the same secret on both sides assuming they sync.** They don't. `rando vc secret-sync` (queued, #245) will make this safe; until then, treat the two sides as separate stores.

## What you CAN do

- Add required reviewers to **our** `production` env (currently empty — D4 of `process-deploy-strategy` documents this). Same for branch-protection rules on the GitHub Environment.
- Push a single secret via `pnpm rando vc secret <NAME> --env production --token "$PAT"` (reads value from stdin so plaintext doesn't hit shell history).
- Add new app-scoped secrets to the Vercel-side env via the Vercel dashboard OR via `rando vc secret --env "Production – rando-api"` (the en-dash and spaces work as the env name).

## When this changes

- **#245 lands**: `rando vc secret-sync` will read 1Password and push the right secrets to the right envs based on a mapping in `rando.config.json`. No more manual env-var entry on either side.
- **Vendor swap**: if we ever move off Vercel (`deploy.kind` in `rando.config.json` changes), the Vercel-side envs become stale; `rando vc environments` would need a cleanup step to remove them.
