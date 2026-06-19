# Editable skills, sturdier chat turns, and faster eval CI

- Date: `2026-06-18`
- Channel: `nightly`
- Version: `0.1.0-nightly.694.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.694.1

Today's nightly brings a long-requested skill editing flow for user-authored skills, tightens reliability around billing pre-flight and observability probes, trims eval CI setup time, and lands a careful fix for multiline prompts in chat.

## 8:12 AM — Editable user skills, retry-safe billing, and tightened eval probes

A morning-to-afternoon push shipped in-place editing for user-authored skills, made the credit pre-flight resilient to transient billing failures, hardened multi-agent observability probes, and slimmed down the functional smoke setup in CI.

- User-authored skills can now be edited in place via a new PUT /api/harness/skills/mine/{name} endpoint and a repurposed editor modal in the Agents SkillsTab that pre-fills from getSkill, locks the name, and round-trips allowed_tools/model/context. The edit path is harness-first: if the harness re-register fails, the server returns 502 and leaves SKILL.md untouched so disk and the live registry never diverge behind a silent 200. (`2e93d47`)
- Credit pre-flight (require_credits) now retries transient billing failures — transport errors and 5xx, e.g. a billing-server cold start — with short backoffs instead of failing a chat turn with a 502 on the first blip. Definitive answers like insufficient credits or auth errors still return immediately, and only positive results are cached so a transient failure can't linger. (`6e18142`)
- Multi-agent status probes now require persisted child-thread evidence (sessionId, childRunId, sessionSubagentThreadMatchesChild, sessionSubagentCompleted) for the project-bound subagent roundtrip, replacing the looser context-utilization signal so a passing probe actually proves the session exposed the child thread. (`827f924`)
- The aura-evals workflow now runs Playwright-bearing jobs inside the official Playwright container with browser install skipped, adds explicit per-job timeouts and in-progress cancellation for the same PR/ref, and the shared CI runner prints per-command elapsed time and retry duration for easier triage. (`978e0a1`)

## 10:51 PM — Enter-to-send no longer eats fast multiline pastes in chat

Late-night fix to the chat input bar adds a short grace window after Enter so a quickly-arriving newline burst is treated as multiline input rather than an accidental submit.

- InputBarShell now defers Enter submission by a 100ms grace period: if more text arrives before the timer fires, the keystroke is reinterpreted as a newline and the buffered value is stitched back together (e.g. "Line one" + "Line two" becomes "Line one\nLine two") instead of submitting a half-written prompt. Clicking Send during the grace window still submits exactly once. (`31ba337`)

## Highlights

- Edit your own skills from the Agents panel
- Chat turns survive transient billing blips
- Rapid multiline prompts no longer get truncated
- Eval CI runs leaner and with shared timing visibility

