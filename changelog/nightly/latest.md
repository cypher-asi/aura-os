# Slash-image generation, harness identity hardening, and product analytics

- Date: `2026-05-01`
- Channel: `nightly`
- Version: `0.1.0-nightly.428.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.428.1

A dense nightly that ships end-to-end image generation in chat, locks down harness session identity across every call site, and lights up first-class product analytics. Reliability work also tightens the Windows updater handoff, dev-loop run capture, and SWE-bench scoring.

## 2:31 AM — Mixpanel product analytics with privacy controls

Aura gains opt-out-aware product analytics covering signup, chat, generation, projects, agents, and billing.

- Introduced a privacy-first Mixpanel pipeline that is anonymous by default, respects DNT/GPC, stays disabled without VITE_MIXPANEL_TOKEN, and supports localStorage opt-out — wired into app boot, auth, and chat send. (`f134511`)
- Instrumented the full product surface with ~20 events spanning project/agent/task/process creation, AURA 3D image and model generation, marketplace hires, integrations, notes, feedback, model and agent selection, file attachments, and chat session resets. (`a8c653d`, `edeb438`)
- Added subscription_started and credits_purchased tracking alongside a new Privacy section in Org Settings with an explicit opt-in/opt-out toggle and a tightened layout. (`468f979`, `977a0f7`)
- Resolved TypeScript build errors uncovered by the analytics rollout in the project form and platform detection paths. (`bdee6c5`)

## 2:09 PM — Two-tier harness session identity preflight

Server and harness now fail fast with a structured 422 when X-Aura-* identity headers are missing, ending silent Cloudflare 403s on the first LLM call.

- Added a Tier 1 server preflight that validates org, session, agent, user, and JWT identity at every harness session entry point (chat, dev-loop, project tools) and emits a stable missing_<field> 422 with structured context instead of a downstream 5xx. (`31e2448`)
- Mirrored the contract on the harness side as a Tier 2 preflight in LocalHarness, SwarmHarness, and AutomatonClient, with a server-side mapper that funnels HarnessError::SessionIdentityMissing into the same 422 envelope regardless of which layer caught it. (`7932e2c`)
- Threaded org / session / user identity through image and 3D generation streams and scheduled-process automatons, with deterministic UUIDv5 session ids for process retries and proper remapping of WS-slot 503s to harness_capacity_exhausted. (`e5ee3af`)
- Brought the bare-agent chat route to parity with the project-bound instance route, resolving project_path and wrapping the system prompt with project context so workspace tools no longer execute against an empty cwd. (`c847b85`)
- Surfaced WS-slot exhaustion during dev-loop event-stream connect as the structured 503 harness_capacity_exhausted envelope and captured dev-loop run bundles into loop-log heuristics so SWE failures retain actionable evidence. (`8555c31`, `8f3cbe1`)

## 8:15 PM — Windows updater handoff, clipboard pastes, and SWE-bench scoring

A small but meaningful trio of fixes across desktop updates, chat input, and eval scoring.

- Made the Windows updater handoff resilient by launching the NSIS installer through PowerShell Start-Process so the installer survives Aura exiting mid-handoff. (`b0c153a`)
- Chat input now accepts mixed-content clipboard pastes that include images alongside other data, instead of dropping the paste. (`603e715`)
- Hardened SWE-bench official scoring: fail fast on native Windows unless driver-only mode is requested, and recover misplaced harness reports so score.json reflects official results. (`270ec0a`)

## 8:20 PM — End-to-end /image generation in chat

The slash-image command now streams through the generation pipeline, persists results, and renders them as standalone media with several adjacent chat-stream fixes.

- Routed the /image command through the dedicated generation stream and preserved the image model plus generation mode for queued sends so the request reaches the right backend even while another stream is active. (`9a90912`, `d54c7b7`)
- Completed the slash-image flow end-to-end with a normalized GenerationCompleted payload on the server, finalized tool turns through the stream lifecycle so generated images become durable chat cards, and a renderer update that shows results as larger standalone media instead of nested inside the generic tool block. (`b03bad1`, `c79bc79`, `68c823c`)
- Stopped the optimistic user prompt from rendering alongside its persisted copy mid-stream and removed forced scroll/focus resets when switching standalone agents, keeping the chat pane stable. (`93c3001`, `6110984`)

## 10:04 PM — SWE-bench smoke diagnostics

Benchmark runs surface root causes more directly via stratified subsets and richer postmortems.

- Added a stratified SWE-bench smoke subset and embedded compact failure details in postmortems so environment, pollution, and hidden-test causes are visible without digging through raw logs. (`7f0ede7`)

## 10:51 PM — Generation stream watchdogs end indefinite image hangs

Image generation streams now have idle and max-runtime watchdogs plus structured logging, so production stalls fail terminally instead of spinning forever.

- Added per-stream generation_id, mode, and session logging across open, send, and lifecycle plus 120s event-idle and 600s max-runtime watchdogs in harness_stream and the chat-stream lifecycle handler, turning previously indefinite spinners into debuggable terminal failures. (`ba457ef`)

## Highlights

- Mixpanel analytics across the full product surface, opt-out aware
- Two-tier session identity preflight prevents silent harness 403s
- Slash /image flow now streams, persists, and renders as media
- Generation streams gain watchdogs that turn hangs into terminal failures

