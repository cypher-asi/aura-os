# Smoother chat streaming, leaner input bar, and a rebuilt observability pipeline

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.659.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.659.1

A heavy nightly across the board: the chat surface gets virtualization, paginated history, and a frame-batched streaming pipeline that stops chat and the terminal from starving each other. The 1,500-line ChatInputBar is broken apart, typing lag is eliminated, and dev loops gain reattach-after-restart resilience. On the platform side, per-tool permissions become first-class, swarm VM logs surface in agent details, and the observability/status pipeline is rebuilt around a single snapshot source.

## 11:13 PM — Streaming pipeline rewrite and chat transcript polish

A late-night sweep tightened the chat transcript's visual details and rebuilt the streaming hot path so chat and terminal stop fighting for the main thread.

- Rebuilt chat and terminal streaming around a single rAF loop: chat reveals coalesce into one store update per frame with markdown rendered as memoized per-paragraph blocks, while PTY output now ships as coalesced binary WebSocket frames and flushes to xterm once per frame — ending the per-token setState storm that was starving the terminal. (`449a6ad`)
- Fixed several streaming-order and formatting bugs in the transcript: the timeline now reveals strictly in order behind a still-typing paragraph, block collapse animates symmetrically with expand, expanding a block scrolls its body into view, and user messages preserve newlines and runs of spaces instead of collapsing them. (`314d95e`, `ffb6201`, `62300dc`, `234717a`)
- Cleaned up command and list rendering: command rows recover their input from alternate keys instead of showing a bare "$ ...", list summaries follow titles directly, block copy buttons only appear on hover/focus, and the gradient band behind the streaming indicator was replaced with a shrink-wrapped pill. (`94d469c`, `80ca317`, `03686c5`, `f9f6cfd`, `44404f9`)
- Sidebar projects gained live open/closed folder icons in both the zui Explorer and the desktop LeftMenuTree, with collapsibles flipped to left-aligned labels and far-right chevrons across sidekick, explorer, message queue, and marketing surfaces. (`f925d5a`, `1b62a3e`, `058af79`, `1d980da`, `8288e7b`, `39201e8`)
- Terminal links now open in the OS default browser instead of triggering Windows' "about:blank" app picker, with the Rust new-window handlers restricted to http/https/mailto. (`3b22dea`)
- Observability and dev-loop plumbing: status health checks were made complete, the CI artifact poller now retries fetch failures, and the start_dev_loop MCP tool threads the calling agent's model so harness loops stop hitting "missing model" 400s. (`71be72f`, `5f1e3a7`, `7c4f02f`)

## 12:58 AM — Dev-loop model resolution from the calling agent

A follow-up closed the remaining gap where agent-driven loop starts still hit the harness without a model.

- When start_dev_loop is invoked without an explicit model arg or AURA_MCP_MODEL, the MCP tool now looks up the calling project-agent instance and uses its default_model, so live agent-driven loops no longer fail the harness "missing model" check. (`5d12a6c`)

## 1:16 AM — Default desktop service URLs in CI workflows

Release Infrastructure: aligned desktop service URL defaults across performance, validate, and release workflows.

- Standardized default desktop service URLs across the performance-benchmark, desktop-validate, and nightly/stable release workflows so CI jobs no longer disagree on which environment they target. (`f82c98f`)

## 1:20 AM — Inline thinking prose, swarm VM logs, and resilient dev-loop tasks

Three substantial features landed back-to-back: reasoning becomes fully readable, swarm VMs expose their logs in the UI, and dev-loop runs keep the task UI live through event-stream resyncs.

- Thinking segments now render as full dimmed inline prose in the activity timeline instead of hiding behind a collapsed "Thought for Xs" chevron, flowing chronologically between tool rows across live streams, finalized turns, and history. (`9d4c5fe`)
- Agent details gained a VM Logs tab that proxies live tail and termination snapshots from the swarm gateway, exposing per-VM log streams directly in the UI via a new RemoteLogsPanel. (`a4d4200`)
- Dev-loop runs no longer freeze task statuses when the firehose forces a resync: the forwarder coalesces text_delta events (~100ms / 4KB / 250ms-age caps), the client refetches tasks on a bumped resyncNonce, and the post-start_dev_loop startLoop bridge now retries instead of silently leaving the loop forwarderless. (`341bdff`)

## 3:14 AM — Swarm integration guide, env reference, and ops runbook

Docs: a full aura-swarm onboarding and operations bundle landed.

- Added an aura-swarm integration guide, environment-variable reference in .env.example, and a swarm-operations runbook covering day-to-day operations, surfaced from the docs README. (`71ae735`)

## 5:56 AM — Virtualized transcript, decomposed input bar, and platform-wide upgrades

The day's biggest batch reshapes the chat surface end-to-end, persists per-tool permissions, hardens dev loops against server restarts, and consolidates the observability pipeline.

- Chat history is now cursor-paginated end to end: new server routes serve windowed events with stable reconstructed ids, ChatMessageList is virtualized via @tanstack/react-virtual with pin-to-bottom and prepend preservation, and per-token re-renders are isolated to a dedicated StreamingTail row so huge sessions no longer download or render in full. (`d43cfb4`, `aff73e2`)
- Typing in the main LLM input is no longer laggy: drafts are localized to a leaf DraftedInputBar, the autosize machinery was rewritten around mirror-element measurement, and on Chromium/Electron CSS `field-sizing: content` owns the auto-grow so keystrokes cost zero synchronous layout reads. (`adf4d1f`, `f88a075`, `8e95031`)
- The 1,510-line ChatInputBar was decomposed into memoized slot components (ModelControls, ChatModeBar, ProjectPicker, AgentInfoBar, AttachControl, InputStatusHints, AttachmentPreviews) with /-slash and @-mention machinery and per-mode model selection lifted into dedicated hooks; a regression test now guards that a draft change re-renders none of the chrome slots. (`b6183e2`, `c6b4a08`, `f6b8795`, `bdd7cbd`, `17b9cf9`)
- Per-tool tri-state permissions (on/ask/off) are now persisted on AgentPermissions and editable in the Permissions tab, forwarded to chat sessions and dev-loop/single-task automation runs; image chat mode rides the same harness generation session as video/3D, and the default org tool catalog gains generate_video plus quality/model knobs for image and 3D. (`f1afd33`)
- Dev loops now survive aura-os-server restarts: a per-run handle file is persisted so a restarted server can probe the harness sidecar, report `loop_state="detached"`, and have the AutomationBar re-adopt the run via the existing start/conflict path — rebuilding the forwarder and re-emitting loop_opened instead of leaving tasks advancing headless. (`9b916d7`)
- Chat now copes with messy tool transcripts: leaked Anthropic <invoke>/<function_calls> XML is hoisted into tool cards (with a server-side scrubber stripping markup from persisted text), the compaction `[tool_use ...]` dialect renders as proper Blocks, and unterminated [tool_result ...] markers are hoisted instead of leaking as a wall of N|-numbered lines. (`0fa0ab4`, `9c4faf9`, `042d15e`)
- Other chat quality fixes: the just-sent bubble no longer jumps on send (persisted-id ↔ clientId aliasing plus smarter input-bar measurement), and the terminal now remembers per-project command history across sessions and tabs via Arrow Up/Down over a localStorage-backed store. (`2025928`, `23221c7`)
- All Explorer/Item call sites (Tasks, Plans, Files, ProjectList, Feed, Profile, Marketplace, Feedback, sidekick previews) were migrated onto app-owned ListItem and ListTree components with fixed slot order and symmetric insets, deleting the hashed-class CSS overrides that papered over zui row metrics. (`7ef7956`)
- The observability/status pipeline was rebuilt around a single generated snapshot at `infra/evals/reports/status/status.json`: probes got truthful, minimally-scoped permissions, regression-focused evals were added, a real history persistence step landed, and the bundled `interface/public/observability/status.json` second copy was retired so nightly/stable releases preserve a full snapshot from one source. (`45c287f`, `1d96402`, `573e753`, `086a496`, `115a761`, `240d4b2`, `1bb31b2`, `7719167`, `56be76b`)
- Server logs are quieter and more useful: chromiumoxide's invalid-CDP-message firehose is now logged once-with-preview instead of dumping multi-KB JSON at WARN on every Network event, and stale empty sessions are correctly retired against the unfiltered session list after migration 0014. (`d9dfdb3`, `2ecee30`)
- Interface test suites were unblocked on Node 25 by disabling the experimental Web Storage global and adding a jsdom Storage fallback, while ~20 suites were updated to track ListItem, paginated history, 3D model args, and redesigned billing/profile panels. (`58e3328`)

## Highlights

- Frame-batched chat + terminal streaming
- Virtualized transcript with cursor-paginated history
- ChatInputBar decomposed into memoized slots
- Dev loops survive server restarts
- Per-tool tri-state permissions across chat and automation
- Unified observability snapshot pipeline

