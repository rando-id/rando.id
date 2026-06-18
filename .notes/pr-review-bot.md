# AI PR review bot

## Landscape

| Option                                                                | License     | Cost                                                                         | Notes                                                                                                                         |
| --------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **[PR-Agent](https://github.com/qodo-ai/pr-agent)** (Qodo, ex-Codium) | Apache 2.0  | BYOK — ~$0.50–$2/PR on Opus, less on Sonnet                                  | OSS bot, no lock-in there. But the per-PR LLM cost is real.                                                                   |
| **CodeRabbit free tier**                                              | Proprietary | Free for **OSI-approved OSS** repos                                          | Our `LICENSE` is PolyForm Noncommercial 1.0.0 (source-available, NOT OSI-approved). Free tier almost certainly doesn't apply. |
| **GitHub Copilot Code Review**                                        | Proprietary | ~$10/mo Copilot subscription                                                 | Native, decent quality. Recurring cost.                                                                                       |
| **Devin.ai review**                                                   | Proprietary | Paid per session/action (already used — #60/#61/#62 were Devin-authored PRs) | Most agentic, can also fix issues. Most expensive per review.                                                                 |
| **Self-hosted local LLM + PR-Agent**                                  | OSS         | Compute/electricity only (genuinely free)                                    | Significant setup. See "Local-LLM option" below.                                                                              |
| **Custom GitHub Action with our own key**                             | DIY         | Same BYOK cost                                                               | More control, more YAML to maintain.                                                                                          |
| **Just use Claude Code interactively**                                | n/a         | $0 — no automation                                                           | Zero cost, zero lock-in. Status quo.                                                                                          |

## The user's hard constraint

User explicitly does **not** want to pay for this right now and does
**not** want to be locked into anything.

That rules out: PR-Agent (BYOK = pay-per-review), Copilot (recurring
sub), Devin's review mode (per-action cost), custom action (same BYOK).

That leaves: CodeRabbit (license-dependent, likely no), local LLM
(free but complex), or "skip the bot."

## Local-LLM option

Truly free path: run Ollama with a coding model (Qwen2.5-Coder-32B,
DeepSeek-Coder-V2, etc.) on a machine you control, expose it via
ngrok or Tailscale, point PR-Agent at it via `OLLAMA_BASE_URL` /
OpenAI-compatible endpoint.

**Cost:** $0 dollars + the electricity + the maintenance of keeping
Ollama running.

**Tradeoffs:**

- Setup: non-trivial (machine selection, model selection, network exposure, token rotation if you use ngrok)
- Quality: local 32B models are real but noticeably below Opus/Sonnet for code review nuance
- Reliability: if your machine sleeps, the bot 503s. Need to run on a desktop you keep on, or rent a small GPU box (which becomes a paid recurring cost again)
- Speed: a 32B model on consumer hardware reviews a small PR in 30s–2min; bigger PRs are slow

For a pre-launch solo-dev project, this is **probably over-engineering**.

## Decision

**Skip the AI review bot for now.** Use Claude Code interactively when
there's a PR to look at — ask "review PR #N" and I'll do the same
review pass a bot would, against the same conventions in CLAUDE.md,
running the local CI loop.

For a one-person-pre-launch project, an unprompted review bot doesn't
add much: you're the only PR author AND the only reviewer. The bot
would mostly review your own work, which Claude Code already does on
demand.

## Revisit triggers

Wire something automatic when **any** of these become true:

- **Outside contributors start filing PRs** — even one regular contributor changes the math; unprompted review catches things at PR-open time without the contributor waiting for you.
- **You add team members** — same reason.
- **Anthropic ships a free Claude Code tier for review automation** — would invert the cost equation.
- **Rando's `LICENSE` shifts** to something OSI-approved (unlikely pre-launch, but if it ever does → CodeRabbit free tier opens up).
- **You decide the per-PR cost is worth it** — PR-Agent on Sonnet at ~$0.10–$0.30/PR may become acceptable as the codebase grows.

When any of those fires, this doc gets reopened. For now: file is the
decision, not a TODO.
