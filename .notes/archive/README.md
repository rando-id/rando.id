# Archived specs

Specs in this directory describe decisions that have been fully
implemented or otherwise closed out. They're kept for historical
context — the active spec list lives one level up in `.notes/`.

## When to archive

Move a spec to `.notes/archive/` when:

- Its tracking issue closes (`gh issue close`) AND the change has
  shipped, OR
- The decision was superseded by a later spec (link the successor in
  this spec's frontmatter), OR
- The spec is no longer relevant (e.g. vendor change made the question
  moot)

## How to archive

```bash
git mv .notes/<topic>.spec.md .notes/archive/<topic>.spec.md
```

Then update frontmatter:

```yaml
---
status: archived
issue: NNN # the tracking issue (still useful)
closed: 2026-MM-DD # the date it closed
supersededBy: <slug>.spec.md # optional, if replaced
---
```

The body stays unchanged — what's there is the historical record.

## Why archive instead of delete

- Outgoing links from active specs (`[[name]]` style) keep resolving
- New maintainers can read the "why did we end up here" trail
- `git log` alone doesn't capture the _options considered_ — only
  what was committed
