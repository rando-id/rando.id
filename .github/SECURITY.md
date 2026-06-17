# Security Policy

## Supported Versions

Rando is pre-1.0. Only the latest `main` is supported — security fixes
land there, deploy to `rando.id`, and propagate to staging on the next
merge.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < 1.0   | :x:                |

Once 1.0 ships, this table will track active minor lines.

## Reporting a vulnerability

**Do not open a public GitHub issue for security-sensitive reports.**

If you've found a vulnerability in Rando.id, please email
**security@rando.id** with:

- A description of the issue and the impact you believe it has
- Steps to reproduce (proof-of-concept code, screenshots, or a video are welcome)
- The affected commit / branch / deployed environment, if known
- Whether you've disclosed the issue elsewhere

We aim to acknowledge reports within **3 business days** and to provide
a more detailed response — including an expected fix timeline — within
**10 business days**. We'll keep you updated as the fix progresses.

## Scope

Issues we're interested in hearing about:

- Auth bypass, privilege escalation, IDOR
- Server-side injection (SQL, OS command, header)
- Sensitive data exposure (logs, error responses, public endpoints leaking PII)
- Webhook signature verification bypass
- Cross-site issues that affect Rando users (stored XSS, CSRF on state-changing endpoints)
- Supply-chain concerns specific to this repo's build pipeline

Out of scope (please don't report):

- Reports from automated scanners without a working PoC
- Best-practice concerns without a demonstrable impact (e.g. "you should rotate this faster")
- Issues in third-party dependencies that are already publicly tracked upstream — link us to the upstream CVE/issue instead
- Denial of service via resource exhaustion alone (we run on commodity hosting; rate limits and platform protections handle this layer)

## Disclosure

We follow coordinated disclosure. Once a fix is shipped and deployed to
production, we'll credit reporters in the release notes (unless you'd
rather stay anonymous). We don't currently run a paid bounty program.
