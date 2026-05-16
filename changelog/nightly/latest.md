# Plan mode, prompt caching, and a chat queue you can trust

- Date: `2026-05-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.535.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.535.1

A heavy day for chat: a shared plan-mode policy now blocks code edits across every entry point, prompt caching is wired end-to-end from Anthropic calls into the context popover, and a stack of race fixes finally makes the message queue, Send-now, and the new-session "+" affordance behave the way users expect. Desktop updates on Windows stop flashing a console, and a missing stable-build secret that was silently breaking signup credits is fixed.

## 9:25 AM — Stable desktop builds get their billing key back

A missing secret in the stable release workflow was silently disabling signup and daily credits for every desktop login.

- Restored the Z_BILLING_API_KEY secret to the stable desktop release workflow so grant_signup_credits no longer no-ops — welcome credits, daily credits, and pro top-ups flow again on stable desktop logins. (`71cb9e6`)

## 11:10 AM — New-session "+" now works in image, 3D, and video modes

The chat input's new-session affordance was only honored on regular chat; image, 3D, and video sends silently appended to the existing session.

- Threaded the new_session / session_id flags through generateImageStream, generate3dStream, and generateVideoStream and the matching server-side persist context, so pressing "+" in a non-code mode actually starts a fresh conversation instead of extending the latest one. (`26bdc6c`)

## 11:10 AM — Windows updater stops flashing a terminal

The post-install handoff script no longer spawns a console subprocess, eliminating the brief black window users were seeing after an update.

- Dropped the ping-based settle delay from the Windows updater handoff .bat so no console subprocess runs after the installer exits, and pinned the invariant with a regression test that asserts the script has no console subprocesses. (`e03038e`)

## 11:10 AM — Readable end-of-turn error messages with one-click copy

The error row in chat bubbles no longer ellipsises diagnostics; the full message wraps on its own line with a copy button.

- Reworked the chat error chrome into two stacked lines — a wrapping error message with a one-click copy icon on top, and the Support ID chip, Report bug button, and variant-specific actions like Buy credits on the meta row below. (`813992a`)

## 11:10 AM — Plan mode is now a single shared policy across every chat surface

Plan mode unifies the spec-planning prompt and a read-only tool surface across the auth'd, public, and /specs/generate endpoints, with code-writing tools hard-disabled.

- Routed action=generate_specs and public mode=plan through a new handlers::plan_mode that appends the plan-mode system suffix and turns off write/edit/delete/run/git/dev-loop tool permissions on cold-start sessions, while warm sessions get a per-turn preamble and tool hints so a code-mode session steered into plan mode behaves consistently and flips cleanly back. (`b37e8b6`)

## 11:10 AM — Prompt caching, chat queue reliability, and busy-agent signals

A long afternoon thread wired Anthropic prompt caching from the wire up to the context popover, fixed several chat-streaming races around Send-now and warm-reopened sessions, and lit up agent avatars whenever a template is actually working.

- Wired Anthropic prompt caching end-to-end: stable per-surface prompt_cache_keys flow into the harness, cache_control + the prompt-caching beta header are attached to Haiku title/summary and changelog generator calls, cache_creation and cache_read tokens accumulate through sessions, loop_log, and dev-loop usage rollups, and a new "Cached this turn" row in the context-window popover surfaces tokens read, written, and the hit percentage. (`5842041`, `913ba83`, `d740c0c`, `13a6bde`, `388d248`, `2430397`)
- Killed the false "Agent paused" pill on warm-reopened sessions and the underlying harness-open hang: the stream watchdog now rebases its clock on the streaming edge, the server emits silent 15s progress heartbeats and wraps open_and_send_user_message in a 60s timeout, and the harness client subscribes to events before SessionInit with a 30s SessionReady ceiling so closed sockets surface as a clean bad_gateway instead of stalling forever. (`5289c45`)
- Fixed the message queue end-to-end: queued prompts now reliably replay after a turn ends, a per-item Send-now affordance (ArrowUp icon) cancels the in-flight turn and dispatches the chosen prompt inline, and stopStreaming clears its in-flight latch synchronously while aborted SSE tails are guarded so they can't clobber the new turn's state. (`8a3cdac`, `5c88139`, `51f64ed`, `69fba92`, `7f7665b`)
- Agent rows in the agents-app sidebar now show a rotating ring and pulsing status dot whenever any binding of the template is busy — automation loop, standalone-agent chat, or a project-bound instance chat — with a thinner stroke, reliable rotation on Windows, and the reduce-motion gate removed so the indicator behaves like the sibling LoopProgress spinner. (`6d8b08a`, `a7f2c28`, `bcc915d`, `e933377`)
- Polished the chat input: switching models keeps the textarea focused, the context-usage breakdown opens on click instead of hover (with Enter/Space/Escape support), text selection inside the accent user bubble is finally visible, Block headers stopped nesting buttons under trailing controls, and the noisy [attach] debug logs were removed. (`895545a`, `607f3a5`, `414c532`, `df34b22`, `e676f03`)

## Highlights

- Stable desktop signup credits restored
- Plan mode now hard-blocks code edits everywhere
- Prompt caching wired from server to context popover
- Chat queue Send-now and new-session pin races fixed
- Windows updater no longer flashes a terminal

