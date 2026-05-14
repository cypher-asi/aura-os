# Video generation in chat, stuck-stream recovery, and a refreshed input bar

- Date: `2026-05-14`
- Channel: `nightly`
- Version: `0.1.0-nightly.519.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.519.1

A heavy nightly that lands native video generation inside chat, ships an end-to-end "agent stuck and silent drops" recovery story (watchdogs, queued sends, support IDs, one-click bug reports), and reorganizes the chat input bar around an inline model picker and a richer per-bucket context indicator. Desktop release infrastructure also got unblocked on macOS-latest after a rustup shim regression.

## 2:29 AM — Video generation joins chat, and stuck streams stop swallowing messages

A large morning push that introduces video as a first-class chat mode end to end and lands the core of the agent-stuck/silent-drops recovery work across client and server.

- Video becomes a first-class chat generation mode: a new VideoBlock renders inline HTML5 playback (with a 0.5s poster frame and MP4 download), the agent mode system, slash command, model picker, progress text, and queue/dispatch paths all learn the video case, and the standalone-agent stream no longer misroutes video into image/3D rendering. (`b99ce50`, `4a2a5d9`, `ec9c63b`, `1fd4789`, `007699f`, `79c0834`, `d06e704`, `f56188f`, `ad43af0`)
- AURA Video gains Seedance 2.0 and 2.0 Fast alongside Veo, with provider-aware resolution, duration, and aspect-ratio constraints; Seedance ships visible but disabled with a "coming soon" label until the BytePlus account is live. (`a6d7ffe`, `62a3dc1`)
- Video and 3D generation turns now persist into chat history: server handlers resolve the agent/session context and call the standard persist pipeline, and the frontend passes agentId/agentInstanceId through both project and standalone agent flows. (`afe9649`, `b430244`, `287bc37`, `c63ce8d`)
- Stuck-stream recovery lands across the chat surface: a 30s SSE-idle watchdog flips the cooking indicator into a StuckStreamPill with Stop/Retry, a 60s auto-timeout finalizes the stream with a synthetic transcript event, and messages typed during an in-flight turn are now queued instead of silently dropped. Stop also actually aborts the in-flight SSE on the project-chat partition path. (`2b65d90`, `9b9499f`, `3014a7d`, `c7a9748`, `20cd00e`)
- Server tightens hang detection and adds traceability: first-event timeout drops 120s→90s and max-idle 30min→3min, a tool-heartbeat env knob is added, and every SSE-bound ErrorMsg is now stamped with a short support_id and logged via structured tracing so user reports join cleanly to server logs. (`c1d0c09`)
- Reset actually resets standalone agent chats: a new GET /api/agents/:agent_id/sessions/:session_id/events endpoint scopes history to the pinned session so pressing "+" or RotateCcw no longer drags prior-session messages back in, and the message queue is cleared on new-chat to prevent leaked sends. (`107e4e8`)
- Project agent picker stops hiding the Standard Agent row behind a network spinner and guards against fast double-clicks creating duplicate instances, and the Chat app's "+" now opens the same AgentSelectorModal scoped to CEO Home so users stay inside the Chat app instead of jumping to /projects. (`fc3c1bc`, `ad179dc`)
- Chat input bar gains a Cursor-style Context popover with per-bucket token counts (System prompt / Tools / Skills / MCP / Subagents / Conversation), powered by a new context_breakdown field on SessionUsage emitted from the harness. (`f6fd518`)
- Small polish: the EARN credits pill label is optically recentered. (`4f275cd`)

## 12:27 PM — One-click Report Bug, progress-ring context pill, and a tidier input bar

A follow-up wave that turns the stuck-stream and support_id plumbing into a real bug-reporting flow and reshuffles the chat input bar so context and model controls finally read as one row.

- Report Bug becomes one click: a 50-entry breadcrumb ring buffer plus support_id parsing now feed a new ReportBugButton that opens the existing feedback modal pre-filled with build version, stream key, agent/session ids, the last 3 support_ids, and the last 20 breadcrumbs — wired into the chat error bubble and the StuckStreamPill, replacing the Phase-2 console.warn placeholder. (`009505a`)
- The context pill becomes a small SVG progress ring + lowercase "NN% context" chip with warning (≥70%) and danger (≥90%) color states, and is re-aligned to share the exact box model as the neighbouring project and model buttons. (`1f12644`, `892f054`)
- Desktop chat input reorganizes: the model picker moves inline next to the send button so the active model is visible alongside the typing target, leaving the context indicator alone at the far right of the bottom info bar. (`edf020e`)
- The pinned cooking shimmer now stays mounted for the entire active turn (including a stable "Queued…" state) instead of flickering on every word-by-word reveal step, and the redundant inline reset-context button is removed in favor of the single "+" new-chat affordance. (`cc84bc2`, `d9ff8fb`)

## 12:27 PM — Protocol catch-up for Phase 6 progress events and first-class support_id

A targeted server/protocol change that re-syncs aura-os with the Phase 6 harness so the workspace builds and support IDs survive end-to-end.

- aura-protocol gains an OutboundMessage::Progress variant for harness heartbeats and promotes support_id to a first-class optional field on ErrorMsg (kept wire-backwards-compatible via skip_serializing_if). The server handles the new variant in its exhaustive match, and the error remapper reuses a pre-stamped support_id instead of minting a second one — so a single error never carries two different IDs across surfaces. (`96d270f`)

## 12:27 PM — Multi-line input bar reflow and richer agent-chat context wiring

Afternoon polish on the input bar's layout when prompts wrap, plus restoring the per-bucket context view on the standalone agent surfaces.

- When the chat textarea wraps to a second row, the model picker now drops into a new bottom-left footer slot inside the input container so long prompts get full width, with the +/send buttons re-anchored to share a baseline with the picker. A ResizeObserver + padding-aware re-measure prevents the picker from oscillating in and out of the footer on each keystroke when backspacing inside a still-wrapping prompt. (`f0bf353`, `dbd6154`, `8340720`)
- The rich per-bucket Context popover now works on the Chat-app and standalone agent surfaces too: usage.context_breakdown is parsed via a shared snake→camel helper, and mid-turn TextDelta / ThinkingDelta / ToolResult bumps make the context ring move live instead of jumping only at turn boundaries. (`3c76651`)
- Picking Standard Agent from the Chat app's "+" modal now hydrates the new agent into the store via api.agents.get before navigating, so the destination route renders the new chat immediately instead of silently falling back to the CEO agent. (`4bfefba`)
- The sliding-pill animation on the chat mode selector is restored, and the spec block hoists its Copy button into the header's trailing slot to free vertical space. (`6345569`, `70d5fa6`, `187351f`)

## 1:33 PM — Error bubbles read as one line with their Support ID and Report Bug action

The chat error chrome is reorganized so the error message, support_id chip, and primary action live on a single row.

- Error messages are split off the bubble's content into a dedicated errorMessage field and rendered as the leading element of the error actions row — truncated to one line with full text on hover — so the Support ID chip and the Report Bug button finally sit next to the message they describe. The insufficient-credits "Buy credits" button also moves into the same row so the whole error chrome reads as one line. (`77b9f16`)

## 1:55 PM — macOS-latest nightly unblocked after a rustup-init shim regression

Desktop nightly was failing on the macos-latest arm64 runner because Homebrew's rustup-init was masquerading as rustc; the runtime parity check now resolves the real toolchain binary.

- The desktop runtime parity check stopped trusting `rustc --version` output verbatim — first by anchoring the parser to a literal `rustc X.Y.Z` line, then by resolving rustc up front via `rustup which rustc` so Homebrew's `/opt/homebrew/bin/rustc` symlink to rustup-init can no longer report itself as "rustc 1.29.0" on macos-latest. A fresh empty commit re-triggers the Desktop Nightly Release workflow with the fix plus the matching aura-harness sync in place. (`918cb9b`, `6210a72`, `b09ebce`)

## Highlights

- Video generation lands as a first-class chat mode with Veo + Seedance
- Stuck-stream watchdog, queued sends, and Report Bug with support IDs
- Per-bucket Context popover and inline model picker in the chat input
- macOS-latest nightly unblocked after rustup-init shim regression

