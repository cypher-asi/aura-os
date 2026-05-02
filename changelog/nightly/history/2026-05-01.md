# Product analytics, identity-safe sessions, and a polished slash-image flow

- Date: `2026-05-01`
- Channel: `nightly`
- Version: `0.1.0-nightly.427.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.427.1

Today's nightly lands a privacy-aware product analytics layer in the interface, hardens every harness session with a two-tier identity preflight on both server and harness sides, and finishes the slash-image generation experience end-to-end. Reliability work also reached the Windows updater handoff and the SWE-bench scoring pipeline.

## 2:31 AM — Mixpanel product analytics with built-in privacy controls

A new anonymous-by-default analytics layer landed across the interface, instrumenting key product events and giving users explicit privacy controls.

- Introduced a Mixpanel-based analytics core that is anonymous by default, ships no PII, respects DNT/GPC browser signals, and stays disabled unless VITE_MIXPANEL_TOKEN is configured. (`f134511`)
- Instrumented the full product surface — projects, agents, tasks, processes, AURA 3D image and model generation, marketplace hires, integrations, notes, feedback, subscription starts and credit purchases, plus model selection, agent selection, file attachments and chat session resets. (`468f979`, `a8c653d`, `edeb438`)
- Added a Privacy section in Org Settings with an opt-in/opt-out toggle for anonymous usage data, and tightened the panel layout so the row stays compact while context lives in a section intro. (`468f979`, `977a0f7`)
- Cleaned up TypeScript build breakage in the analytics platform detection and orbit project form so the new tracking compiles cleanly. (`bdee6c5`)

## 2:09 PM — Two-tier session identity preflight for every harness call site

Server- and harness-side preflights now fail loudly with a structured 422 the moment a session would open without its required X-Aura-* identity headers, replacing opaque downstream 403/5xx errors.

- Added a Tier 1 server preflight that emits a stable session_identity_missing 422 with a per-field code whenever chat, dev-loop, project-tool, generation, or scheduled-process sessions are missing org id, session id, agent id, user id, or JWT — and removed the noisy Windows-only debug log shim that was writing synchronously to a hardcoded file on every session start. (`31e2448`)
- Added a matching Tier 2 harness preflight on LocalHarness, SwarmHarness, and AutomatonClient::start so drift between server and harness stays observable from either side, with the server's error mapper funneling harness-side rejections into the same 422 response shape. (`7932e2c`)
- Threaded canonical org / session / user identity through image and 3D generation streams and scheduled-process automatons, with a deterministic UUIDv5 session id per (process_id, run_id) so retries share a router bucket while concurrent runs stay isolated. (`e5ee3af`)
- Mapped dev-loop WebSocket connect failures (HTTP 503 / WS 1013) to the structured harness_capacity_exhausted 503 envelope and short-circuited retries, so the eval pipeline's capacity-aware backoff actually fires instead of seeing a generic bad_gateway. (`8555c31`)
- Brought bare-agent chat to parity with the project-bound instance route by resolving the workspace path and wrapping the prompt with the canonical project_context block whenever an effective project is bound or inferred. (`c847b85`)
- Wired harness stream events into loop-log bundles and live heuristics so dev-loop and SWE-bench failures retain actionable run evidence after the fact. (`8f3cbe1`)

## 8:15 PM — Mixed clipboard pastes and a sturdier Windows updater handoff

Two targeted fixes improved chat input behavior and the Windows update experience.

- Chat input now correctly accepts clipboard pastes that mix images with other content instead of dropping the image payload. (`603e715`)
- On Windows, the NSIS updater is now launched through PowerShell Start-Process so the installer survives Aura exiting mid-handoff, removing a class of stalled-update failures. (`b0c153a`)

## 8:18 PM — SWE-bench scoring made explicit and recoverable

The SWE-bench aggregation pipeline now fails fast in unsupported configurations and reconciles misplaced harness reports.

- Aggregation now errors out on native Windows unless driver-only mode is explicitly requested, and recovers misplaced AURA.<runId>.json harness reports so score.json reflects official results when they exist. (`270ec0a`)

## 8:20 PM — Slash /image generation now works end-to-end in chat

A coordinated set of fixes routes the slash /image command through the generation stream, keeps it stable while queued, persists results, and renders them as proper media cards.

- Slash /image now routes through the dedicated generation stream and preserves both image model and generation mode for queued sends, so the right backend and model are used even while another response is still streaming. (`9a90912`, `d54c7b7`)
- Completed the slash-image flow on both interface and server, normalizing the generation_completed payload shape and threading harness command channels through the SSE bridge. (`b03bad1`)
- Generated images are now finalized through the stream lifecycle into durable chat cards instead of being cleared with transient buffers, and render as standalone larger media rather than nested inside the generic tool block. (`c79bc79`, `68c823c`)
- Stopped the live chat tail from rendering an optimistic prompt next to its persisted copy mid-stream, and stopped agent selection from forcing scroll and focus resets that yanked the chat pane around. (`93c3001`, `6110984`)

## 10:04 PM — Stratified SWE-bench smoke subset with richer postmortems

SWE-bench smoke runs now exercise a stratified subset and emit compact failure details to make environment, pollution, and hidden-test causes obvious from the postmortem alone.

- Added a stratified SWE-bench smoke subset and embedded compact failure details in postmortems so benchmark runs surface environment, pollution, and hidden-test causes directly. (`7f0ede7`)

## Highlights

- Mixpanel analytics shipped with DNT/GPC and an in-app opt-out
- Two-tier session identity preflight prevents silent harness 403s
- Slash /image generation now streams, persists, and renders as media
- Windows updater handoff hardened via PowerShell Start-Process

