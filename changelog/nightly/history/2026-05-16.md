# Plan mode, prompt caching, and a deep pass on chat session reliability

- Date: `2026-05-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.536.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.536.1

Today's nightly is dominated by chat-surface work: a unified plan mode that hard-blocks code edits, end-to-end prompt-cache accounting from the harness to the context popover, and a long sequence of fixes that make new-session pins, queued prompts, and warm session reopens behave the way users expect. The Windows updater stops flashing a terminal, and a missing CI secret that had been silently breaking signup credits on stable desktop builds is restored.

## 9:25 AM — Stable desktop signup credits restored

A missing CI secret was silently breaking welcome, daily, and pro top-up credits on stable desktop builds.

- Added the missing Z_BILLING_API_KEY to the stable release workflow so grant_signup_credits no longer no-ops on desktop login — welcome credits, daily credits, and pro top-up now flow on stable builds. (`71cb9e6`)

## 11:10 AM — New-session button now works in image, 3D, and video modes

The chat input's '+' affordance was silently appending to the latest session whenever a non-code mode was active.

- Image, 3D, and video generation requests now thread the new_session and session_id flags from the frontend stream helpers all the way through resolve_persist_ctx, so pressing '+' in any mode genuinely starts a fresh conversation instead of being overridden by a stale ?session= in the URL. (`26bdc6c`)

## 11:10 AM — Windows updater stops flashing a console window

The handoff script no longer spawns a console subprocess after the installer exits.

- Removed the ping-based settle delay from the Windows updater handoff .bat so child consoles can no longer briefly flash during update install; CREATE_NO_WINDOW and the breakaway-from-job retry remain as defense-in-depth, and a regression test pins that the handoff script contains no console subprocesses. (`e03038e`)

## 11:10 AM — Readable, copyable error chrome on chat messages

End-of-turn error details are no longer hidden behind an ellipsised single line.

- Chat error rows now stack over two lines: the full wrapping error message with a one-click copy button on line 1, and the Support ID chip, Report bug action, and variant-specific actions like Buy credits on line 2 — so contract-blocked diagnostics are finally readable in place. (`813992a`)

## 11:10 AM — Plan mode unified behind a strict spec-planning policy

Plan mode now uses a shared policy that hard-disables code-writing tools across every chat surface.

- Plan mode (action=generate_specs / public mode=plan) now routes through a single handlers::plan_mode module across the auth'd instance and agent routes, the public chat handler, and the /specs/generate* endpoints, applying the same spec-planning system prompt and read-only tool surface everywhere. (`b37e8b6`)
- Cold-start sessions stamp the policy onto SessionConfig with tool_permissions off for write/edit/delete/run/git/dev-loop tools, while warm sessions get a per-turn preamble and plan-mode tool_hints — so flipping a code-mode session into plan mode is safe, and flipping back produces a clean unwrapped turn. (`b37e8b6`)

## 11:10 AM — Prompt-cache accounting, busy-state polish, and a fleet of chat session fixes

A long afternoon thread shipped end-to-end prompt-cache visibility, fixed several chat session races, added live agent activity indicators, and resolved the warm-reopen 'Agent paused' false positive.

- Prompt-cache tokens are now tracked end-to-end: ContextBreakdown carries cache_read_tokens and cache_creation_tokens (with a demo-path backfill), session and dev-loop usage rollups accumulate cache_creation_input_tokens and cache_read_input_tokens toward context-window utilization, and the context-usage popover renders a new 'Cached this turn' row with hit percentage when data is present. (`5842041`, `913ba83`, `388d248`, `2430397`)
- Each chat surface now derives a stable prompt_cache_key (agent, instance, tool, devloop) plumbed into SessionModelOverrides, and the direct-HTTP Anthropic calls for Haiku session titles, summaries, and the changelog generator attach cache_control: ephemeral plus the prompt-caching beta header so cache reads actually take effect on repeat calls. (`d740c0c`, `13a6bde`)
- Fixed the false 'Agent paused' / 'Local timeout reached' pill on warm-reopened sessions: the frontend stuck-stream watchdog now rebases lastEventAt on the streaming edge, the server emits a 15s progress:heartbeat SSE frame during quiet stretches, and SessionBridge::open_and_send_user_message is wrapped in a 60s server timeout with a 30s harness-side ceiling so hung opens surface a clean retry message instead of hanging forever. (`5289c45`)
- Queued prompts no longer vanish when a turn ends, and a new per-item Send-now affordance (ArrowUp icon) lets users force a queued prompt past the in-flight turn. Three stacked races in stopStreaming — stale in-flight latches, finally-block clobbering, and buffered SSE frames after abort — were fixed so cancel + dispatch + render all land cleanly. (`8a3cdac`, `5289c45`, `51f64ed`, `69fba92`, `7f7665b`)
- Pressing '+' and then clicking an existing session row before typing now correctly extends that session instead of minting a new one — the new-session pin is cleared when sessionId becomes a real value, and the standalone ref is reset on agent swap to prevent the pin leaking across agents in the chat-app shell. (`5c88139`)
- Agents-app sidebar rows now light up an avatar ring and pulse the status dot whenever any binding of an agent template is working — automation loops, standalone-agent chats, or project-bound chats — via a new useIsAgentBusy hook. The ring's rotation was moved off the SVG onto the wrapping span for cross-browser reliability and slimmed to a subtler 1.4 stroke. (`6d8b08a`, `a7f2c28`, `bcc915d`, `e933377`)
- Chat input polish: switching models keeps the textarea focused, the context-usage popover now opens on click with keyboard support instead of hover (so stray pointer moves toward the composer stop covering it), and text selection inside the accent user bubble is finally visible by inverting the bubble's accent/contrast pair. (`895545a`, `607f3a5`, `414c532`)
- Block headers now render as div role=button with Enter/Space handling so trailing slots (like SpecBlock's CopyButton) no longer produce nested-button hydration warnings, and the noisy [attach] debug logs were removed from the chat-input attachment paths while keeping real FileReader warnings. (`df34b22`, `e676f03`)
- Desktop now correctly shows the login screen for logged-out users instead of the web-only public chat shell, by checking hasDesktopBridge alongside isNativeApp before falling through to LoggedOutShell. (`1333c9e`)

## Highlights

- Plan mode now hard-blocks code edits across every chat surface
- Prompt-cache tokens are tracked end-to-end and shown in the context popover
- Multiple chat session race conditions and queue bugs resolved
- Windows updater no longer flashes a console window
- Stable desktop signup credits restored via missing CI secret

