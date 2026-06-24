---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 191
---

# Vercel Protection Bypass for integration tests

Vercel Deployment Protection redirects all unauthenticated
traffic on preview URLs to `vercel.com/sso-api`. That's the
right default for preview deploys (WIP code shouldn't be
publicly browseable), but it breaks `integration-tests.yml`'s
`/v1/health` poll + the Postman collection runs — both get
302s on every request and the smart-target falls back to
staging.

Discovered while debugging PR #187's CI: 30 consecutive 302s
in the 5-minute poll, then a staging-fallback that also failed
because staging is dead ([[#190]]). Surfaced because PR #189's
smart-target replaced the previously-silent soft-skip with a
real run.

## Decision

Keep Deployment Protection ON; wire Vercel's **Protection
Bypass for Automation** into the integration-tests workflow.
Every request from CI carries an `x-vercel-protection-bypass`
header signed by a project-scoped secret; Vercel accepts
those without redirecting.

Concretely:

1. **Vercel dashboard** (manual, one-time per project):
   Settings → Deployment Protection → enable "Protection
   Bypass for Automation". Vercel generates a secret;
   anyone with the secret can bypass protection on that
   project's deployments. We treat it like any other API
   credential — store in 1Password, never commit.
2. **1Password staging Environment** (manual, one-time):
   add an item titled `VERCEL_AUTOMATION_BYPASS_SECRET`,
   field `credential` (matches the existing convention from
   the [[user_role]] / [[security-github-pat]] notes).
3. **`.github/workflows/integration-tests.yml`**:
   - Move the `op-env` step **before** `Resolve target URL`
     so `$VERCEL_AUTOMATION_BYPASS_SECRET` is in
     `$GITHUB_ENV` before the curl poll runs.
   - Pass `-H "x-vercel-protection-bypass: $SECRET"` on the
     curl poll.
   - Pass the secret to Postman via `--env-var`.
4. **`postman/rando-api.postman_collection.json`**: add a
   collection-level pre-request script that reads the
   `vercelBypass` Postman env var and adds the header on
   every request.
5. **Root `package.json`'s `test:api` script**: forward
   `$VERCEL_AUTOMATION_BYPASS_SECRET` via `--env-var`.

## Why bypass-header (not "disable protection")

Deployment Protection serves a real purpose: a public WIP
preview can leak credentials, surface unauthorized features,
or get indexed by search engines. Disabling it would expose
every PR's preview to the public web for the lifetime of the
PR. The bypass mechanism lets CI through without compromising
that posture.

## Why a collection-level pre-request script (not per-request)

The Postman collection currently has 25+ requests. Adding the
header to each individually means 25+ identical edits and
every new endpoint added later has to remember to set the
header. A collection-level `prerequest` event runs before
every request in the collection (and any subcollection), so
the bypass is set once and stays correct as the collection
grows.

## Options considered

- **Disable Deployment Protection entirely.** Simplest, but
  leaks WIP previews to the public. Skip.
- **Query-string bypass instead of header.**
  `?x-vercel-protection-bypass=<secret>` works for GET but
  not for POST/PUT/DELETE (Vercel's docs are clear on this).
  The Postman collection has non-GET endpoints. Skip.
- **Generate per-PR access tokens via the Vercel API.** More
  granular (each PR gets its own short-lived token) but
  requires a Vercel API integration we don't have today.
  Skip; revisit if the long-lived bypass secret becomes a
  concern.
- **Skip integration tests on preview entirely, only run
  against staging.** Loses the per-PR validation #189 was
  built for. Skip.

## What we accept

- **One more secret in 1Password.** `VERCEL_AUTOMATION_BYPASS_SECRET`
  joins the existing staging Environment. Rotation requires
  generating a new value in Vercel and updating 1Password —
  same procedure as any other credential rotation.
- **The bypass secret has broad scope.** Anyone with it can
  bypass Deployment Protection on every preview of the
  `rando-api` project. Mitigations: store in 1P (not committed,
  not in GitHub secrets directly), scope the 1P service
  account to the staging Environment only, never log the
  value (workflow uses `$SECRET` which GitHub Actions
  redacts in logs).
- **Order change in integration-tests.yml.** `op-env`
  currently runs after the resolve-target step. Moving it
  earlier means the staging environment loads on every run
  (even ones that ultimately target staging-via-fallback
  with no bypass needed). One extra `op environment read`
  per run; negligible cost.
- **Local dev unaffected.** Locally, `pnpm test:api` hits
  `http://localhost:4000` which has no Deployment Protection.
  `$VERCEL_AUTOMATION_BYPASS_SECRET` is unset locally, the
  pre-request script reads an empty string, and Vercel's
  header check is a no-op against localhost. No local
  developer needs to configure anything.

## What would make us reconsider

- **The bypass secret leaks.** Rotate it (Vercel dashboard
  generates a new one, invalidates the old). Update 1Password.
  No code change.
- **A per-deployment token system becomes viable.** Vercel
  has been moving toward more granular per-deployment auth
  (the SSO endpoint we saw the 302s redirecting to is part
  of that). If they ship a CI-friendly per-deployment token
  API, switch to that for better blast-radius control.
- **We outgrow Vercel.** Bypass is Vercel-specific; if
  preview deploys move to another platform, the mechanism
  is different.

## Touch points

1. `.github/workflows/integration-tests.yml` — move op-env
   before resolve-target; add the bypass header to the curl
   poll; pass the secret to Postman via `--env-var`. Also
   validate `workflow_dispatch` input URL against a trusted
   host allowlist (`*.rando-id.dev`, `*.rando.id`,
   `localhost`); strip `VERCEL_AUTOMATION_BYPASS_SECRET`
   from `GITHUB_ENV` when the dispatch target is outside the
   allowlist so the bypass can't leak to third-party hosts.
2. `postman/rando-api.postman_collection.json` — add a
   collection-level `prerequest` event with a script that
   sets the `x-vercel-protection-bypass` header from the
   `vercelBypass` Postman env var. Empty string → no-op.
3. Root `package.json` `test:api` script — forward
   `$VERCEL_AUTOMATION_BYPASS_SECRET` to Postman via
   `--env-var`.
4. `scripts/spec-lint.mjs` — read
   `process.env.VERCEL_AUTOMATION_BYPASS_SECRET` and pass
   it as `x-vercel-protection-bypass` on the spec fetch.
   Without this, fetching `/v1/openapi.json` from a preview
   URL gets 302'd to vercel.com/sso-api and the response
   body is HTML, not the spec.
5. `.github/MAINTAINING.md` — short callout under
   "Continuous integration" naming the secret + the
   one-time setup steps (Vercel dashboard + 1Password).

## Security considerations

- **`workflow_dispatch` trust allowlist.** Without validation
  the dispatch input would let a maintainer (or a compromised
  account with `workflow.write`) point the run at an arbitrary
  URL — and the curl poll + Postman header + spec-lint fetch
  would all send the bypass secret to that host. The
  `resolve-target` step matches the dispatch URL's hostname
  against `*.rando-id.dev`, `*.rando.id`, and `localhost`.
  Non-trusted targets get the secret scrubbed from
  `GITHUB_ENV` before any downstream step runs, AND a
  workflow `::warning::` so the run is marked.

  **Host extraction uses node's WHATWG URL parser, not a regex.**
  A naive regex like `s|^https?://([^/:]+).*|\1|` can be defeated
  by userinfo URLs: `https://trusted.rando-id.dev:443@evil.example`
  extracts `trusted.rando-id.dev` (the userinfo, not the actual
  host), passes the allowlist, and downstream curl/Postman/spec-lint
  connect to `evil.example` with the bypass header. node's URL
  parser puts the real host in `u.hostname` regardless of
  userinfo. The parser step ALSO explicitly rejects any URL
  with userinfo (`u.username || u.password`) and any non-http(s)
  scheme, failing the workflow before downstream steps see the
  secret — defense in depth against future bypass tricks (e.g.
  IDN homograph, IPv6 literals) that the allowlist alone might
  miss.

  **Tab/CR/LF in input is rejected, not stripped.** The WHATWG
  URL parser silently strips ASCII tab and newline characters
  from input before parsing (per spec step 3 of the URL parsing
  algorithm). That means `https://a.rando-id.dev\n.evil.example`
  parses to hostname `a.rando-id.dev.evil.example` — the
  newline disappears and the segments merge. Our suffix
  allowlist would still correctly reject that specific example
  (it ends in `evil.example`, not `rando-id.dev`), but we never
  want the parser's strip-and-parse behavior masking what the
  dispatcher actually typed. The parser step rejects any input
  containing `[\t\n\r]` before constructing the URL. This also
  closes the door on output-file injection into `GITHUB_OUTPUT`
  via a newline-embedded URL.

  **Plaintext `http://` only for loopback (CWE-319).** A
  maintainer could dispatch `http://staging-api.rando-id.dev`
  — that hostname matches the allowlist, so the bypass secret
  would be retained, and the `/v1/health` poll + Postman runs
  - spec-lint fetch would all send `x-vercel-protection-bypass`
    in plaintext over the network. The parser step rejects
    `http:` URLs unless the hostname is `localhost` or `127.0.0.1`
    (where loopback HTTP is the actual local debug case). Remote
    hosts MUST use HTTPS.

- **Fork PRs don't have access to the secret.** GitHub
  Actions withholds secrets from `pull_request` runs
  originating in forks (`OP_SERVICE_ACCOUNT_TOKEN` is
  unset, so `op-env` produces no values), so a malicious
  PR can't exfiltrate the bypass even before our trust
  check fires. The allowlist is defense-in-depth, not the
  primary control.
- **Bypass secret never echoed.** Workflow steps reference
  the value via `$VAR` expansion or env-var injection, never
  `echo`-ing it. GitHub Actions also masks any value
  matching a secret in logs.

- **No user-controlled input is template-interpolated into
  shell or JS.** GitHub Actions resolves `${{ ... }}` at
  template-rendering time, BEFORE the shell sees the script.
  An input like `'; malicious; #` would break out of any
  quoted string and execute arbitrary commands inside the
  runner — with access to `$VERCEL_AUTOMATION_BYPASS_SECRET`
  (loaded by `op-env` earlier in the job). To prevent this
  (CWE-77), every untrusted value used by `resolve-target`
  and the failure-comment github-script is plumbed through
  step-level `env:` blocks and read as `$VAR` (or
  `process.env.VAR` in JS): `inputs.baseUrl`, `github.actor`,
  `github.head_ref`, `github.event.pull_request.labels.*.name`,
  and the resolved `steps.target.outputs.url`. Even values
  that look enum-class (`github.event_name`, our composite-
  action outputs) get the same treatment for consistency —
  the cost is zero and the audit story is much simpler when
  every shell-interpolated `${{ ... }}` in a workflow is
  guaranteed to come from `env:`.

- **Network response is sanitized before being written to
  disk.** `scripts/spec-lint.mjs` fetches `/v1/openapi.json`
  and writes the body to a temp file because the upstream
  `postman api lint` CLI only accepts file paths, not URLs.
  CodeQL flags any `fetch().text() → writeFileSync` flow as
  "Network data written to file" — even though the destination
  path is safe (`mkdtempSync` random dir + hardcoded filename,
  no user-controlled path component). The concern is closed
  with four defense layers, applied in order:
  1. `redirect: 'error'` refuses to follow 3xx, so a Vercel
     SSO interstitial doesn't silently land on disk;
  2. `Content-Type` must claim `application/json` (or `*+json`),
     so HTML/text/binary responses are rejected before any
     downstream processing;
  3. the body must `JSON.parse` cleanly into an object;
  4. **the bytes written to disk are `JSON.stringify`'d from
     the parsed object** — NOT the raw response text. This
     round-trip is the actual sanitizer: it produces a new
     string with no data-flow lineage to the network source
     (CodeQL's taint tracking sees a clean break, since
     `JSON.stringify(JSON.parse(x))` is structurally
     guaranteed to yield safe canonical JSON regardless of
     what `x` was).

  Without step 4 the earlier layers are only validation —
  `JSON.parse(spec)` confirms the input is well-formed but
  doesn't transform the variable that gets written, so CodeQL's
  data-flow analysis still sees the unbroken
  `fetch().text() → writeFileSync` path. Re-serializing through
  the parsed object is both the real security guarantee and
  what satisfies the linter (alert
  https://github.com/rando-id/rando.id/security/code-scanning/8).

Related: [[ci-integration-tests-smart-target]] (#188 —
the smart-target that surfaced this), [[#190]] (the
staging-dead issue debugging led to alongside this).
