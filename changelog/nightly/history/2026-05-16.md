# Plan mode, prompt caching, and a tighter chat input

- Date: `2026-05-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.534.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.534.1

Today's nightly rebuilds chat around three big threads: a unified plan mode that locks the model into read-only spec planning, end-to-end prompt-cache accounting from the harness all the way into the context popover, and a sweep of chat-input fixes that finally make "+", model switching, and warm session reopens behave the way users expect. Desktop and release infrastructure also get pointed fixes — no more terminal flash during Windows updates, and stable desktop builds get their billing API key back.

## 9:25 AM — Stable desktop builds regain their billing API key

A missing CI secret had been silently disabling welcome and daily credits on every stable desktop login.

- Restored Z_BILLING_API_KEY in the stable release workflow so desktop builds no longer ship with an empty billing key — grant_signup_credits now actually runs, returning welcome credits, daily credits, and pro top-ups on stable desktop logins. (`71cb9e6`)

## 11:10 AM — "+ new chat" finally works in image, 3D, and video modes

The new-session flag now flows through every generation mode, not just regular chat.

- Image, 3D, and video sends now honor the chat-input "+" affordance: the new-session flag and pinned session id are plumbed through generateImageStream / generate3dStream / generateVideoStream and into the matching server handlers, so picking a non-code mode and pressing "+" actually starts a fresh conversation instead of silently appending to the latest session. (`26bdc6c`)

## 11:10 AM — Windows updates stop flashing a terminal window

The updater's handoff script is now free of console subprocesses, killing the brief terminal flash on every Windows update.

- Removed the `ping -n 2 127.0.0.1` settle delay from the Windows updater handoff .bat — that subprocess was the source of the terminal flash users kept seeing, because CREATE_NO_WINDOW inheritance isn't reliable once the parent aura.exe has exited. A new `handoff_script_has_no_console_subprocesses` regression test pins the no-console-children invariant. (`e03038e`)

## 11:10 AM — Readable, copyable chat error messages

End-of-turn errors no longer hide their useful details behind an ellipsis and a tooltip.

- Reworked the chat error chrome into two stacked lines: the full wrapping error message with a one-click copy button on top, and the Support ID chip plus Report bug and variant-specific actions (like Buy credits) on the row below. Contract-blocked diagnostics are now readable inline instead of being truncated behind a title tooltip. (`813992a`)

## 11:10 AM — Plan mode unified behind a shared spec-planning policy

Plan mode now routes through a single handler that enforces the read-only tool surface across every chat entry point.

- `action=generate_specs` / public `mode=plan` now flow through a new shared `handlers::plan_mode` so the spec-planning system prompt and the hard-disabled write/edit/delete/run/git/dev-loop tools stay identical across the auth'd instance and agent routes, the public chat handler, and the dedicated `/specs/generate*` endpoints. (`b37e8b6`)
- Cold-start sessions stamp the plan-mode policy onto `SessionConfig` directly; warm sessions get a per-turn preamble wrapper and plan-mode tool hints, so a session opened in code mode is still steered into plan-mode behavior on a plan turn — and flipping back to code mode produces a clean, unwrapped turn that doesn't carry plan framing forward. (`b37e8b6`)

## 11:10 AM — Prompt caching, warm-reopen reliability, and chat input polish

End-to-end prompt-cache accounting lands in the context popover, the harness gets heartbeats and timeouts that kill the false "Agent paused" pill, and a cluster of chat input fixes makes "+", model switching, and text selection behave correctly.

- Wired prompt caching end-to-end: the protocol gains additive `cache_read_tokens` / `cache_creation_tokens` on ContextBreakdown, sessions and dev-loop usage rollups now accumulate cache-creation and cache-read input tokens (counting them toward context-window utilization), and a stable per-surface `prompt_cache_key` (agent / instance / tool / devloop) is derived and forwarded so OpenAI-family caching actually engages with 24h retention on long-lived surfaces. (`5842041`, `913ba83`, `d740c0c`, `388d248`)
- Anthropic direct-HTTP calls (Haiku session title/summary and the changelog generator) now attach `cache_control: ephemeral` plus the `anthropic-beta: prompt-caching-2024-07-31` header so retries and subsequent calls actually benefit from a cache read. (`13a6bde`)
- The context-usage popover gains a "Cached this turn" sub-row showing tokens read, tokens written, and hit percentage when non-zero — legacy harness builds that don't emit the new fields default to 0 and hide the row entirely. (`2430397`)
- Fixed the false "Local timeout reached" / "Agent paused" pill on warm-reopened chats with a five-layer fix: the frontend stream store now rebases `lastEventAt` on the false→true streaming edge, the server emits 15s `progress:heartbeat` SSE frames that the client silently consumes, the harness chat-open path is wrapped in a 60s server timeout with a clean bad_gateway message, and the local harness client subscribes before SessionInit with a 30s SessionReady ceiling so an early WebSocket close no longer hangs forever. (`5289c45`)
- Chat input bar gets a focus and interaction sweep: switching models in the ModelPicker no longer blurs the textarea (mousedown preventDefault on the trigger and menu wrapper), the new-session pin is cleared as soon as the user picks an existing session row or swaps agents (so the "+" press doesn't leak across selections), and the context-usage indicator now opens on click instead of hover with full keyboard support. (`895545a`, `5c88139`, `607f3a5`)
- Smaller chat polish: text selection inside the accent user bubble is now visible by inverting the bubble's own accent/contrast pair, collapsible Block headers render as `div role="button"` so trailing slots like SpecBlock's CopyButton no longer produce nested-button hydration warnings, and the noisy `[attach]` debug logs on every attachment render / drop / paste have been removed (keeping only the real error warnings). (`414c532`, `df34b22`, `e676f03`)

## Highlights

- Plan mode now hard-blocks code-writing tools across every chat surface
- Prompt-cache hits surface in the context popover with a new "Cached this turn" row
- Warm-reopened chats no longer trip the false "Agent paused" pill
- Windows updater stops flashing a terminal window during install
- Stable desktop builds get their billing API key back, restoring signup credits

