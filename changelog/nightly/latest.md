# A standalone Chat app and a five-phase agent-stream reliability overhaul

- Date: `2026-05-13`
- Channel: `nightly`
- Version: `0.1.0-nightly.508.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.508.1

Today's nightly lands a brand-new ChatGPT-style Chat app at /chat alongside a top-to-bottom reliability rework of the agent streaming pipeline — softer watchdogs, automatic WS reconnects, context-aware session forking, parallel turns per model, and end-to-end observability. A handful of smaller polish fixes round out the chat surface across desktop and mobile.

## 2:28 AM — Video thumbnails in the Sidekick panel

AuraVideo's sidekick now previews real video frames instead of a generic icon.

- Sidekick rows for videos render a still frame captured at the 0.5s mark via a media-fragment preload, with a Film icon as a graceful fallback when the frame can't be decoded. (`f3e468a`)

## 5:53 PM — ChatGPT-style Chat app at /chat

A dedicated everyday-LLM app ships with its own route, sessions list, and fixes for the first paper cuts.

- New top-level Chat app at /chat mounts a date-bucketed sessions list, the standard ChatPanel against the user's super-agent, and reuses the Agents app's AgentInfoPanel as a collapsed-by-default sidekick; the default model is seeded to aura-gpt-5-4-mini. (`4fee1da`)
- Accounts whose CEO agent had been renamed no longer get stuck on "Starting chat…" — the route now resolves the canonical chat agent through a cached api.superAgent.setup() call and distinguishes loading from an actual setup failure. (`f50c007`)
- Switching between agents or sessions in the sidebar now drops the cursor straight into the chat input on desktop instead of leaving focus stranded on the clicked row; the mobile keyboard guard is preserved. (`13576da`)

## 5:53 PM — Agent-stream reliability plan: phases 1–5

A coordinated five-phase rework hardens the chat streaming pipeline end-to-end, from watchdog timings to observability.

- Phase 1 softens the chat-turn watchdog from a hard 30s/300s pair to env-tunable 120s first-event / 30-min sliding-idle defaults, demotes stream_lagged from a terminal SSE error to a transient progress hint, and quadruples the harness WS broadcast capacity to 16384 (tunable via AURA_HARNESS_BROADCAST_CAPACITY) so long Opus tool-use turns and slow consumers no longer kill live streams. (`4759233`)
- Phase 2 makes WS connects resilient: LocalHarness and SwarmHarness retry the initial connect up to 3 times with 500ms/1s/2s backoff, and the client now treats harness_ws_closed/read_error as recoverable streamDropped, auto-retrying the last user message twice behind a "Reconnecting…" banner instead of losing it. (`ea75e00`)
- Phase 3 introduces automatic session forking: once context_utilization crosses 0.80 (AURA_CHAT_AUTO_FORK_THRESHOLD), the next user send transparently mints a fresh session seeded with a rollover summary and the UI shows a subtle "Continued from previous chat" banner — no more hitting upstream context caps mid-conversation. (`ce9707b`)
- Phase 4 reworks chat concurrency: the session registry is now keyed on (partition, model) and backed by DashMap, the per-partition turn queue grows from 2 to 4, and the bare-agent busy guard is narrowed so a loop on a sibling instance no longer blocks bare-agent chat — enabling ~128 simultaneous turns per user across distinct agents and models. (`bf563e0`)
- Phase 5 wires up observability: a new lock-free StabilityMetrics struct tracks every reliability counter from phases 1–4 and exposes them as a JSON snapshot at /api/admin/health alongside active session counts and resolved env config; the client emits aura:stream-close breadcrumbs and sets X-Aura-Client-Retry on auto-retries so the server counter is wired end-to-end. (`6e7f92c`)
- Follow-up fixes keep the EARN button label vertically centered in the titlebar, drop a dead `name` field from the video generation request to silence a dead_code warning, and guard the Phase 5 breadcrumb's process.env fallback behind globalThis so the browser-only tsconfig (and the Tauri desktop build) stays green. (`b3c6e4f`, `609e946`, `2e81f83`)

## 5:53 PM — Parallel chats and a cross-agent inbox for /chat

The Chat app gains a unified cross-agent session list, and the streaming hook is rebuilt around per-partition state so two chats can run side by side.

- Chat's left panel becomes a unified cross-agent inbox: SessionsList now renders a single bucketed list of native button rows (eliminating the cross-bucket multi-select bug), each row paints the session's agent avatar via a new renderRowSuffix prop, and selecting a session swaps both the chat panel and the sidekick to that agent's profile, chats, skills, and memory. (`629b008`)
- Chatting with two agents in a kept-mounted panel no longer breaks: a new per-(projectId, agentInstanceId) send-control module fixes Agent B silently no-op'ing after a mid-stream switch and Agent A's UI freezing on the final assistant bubble, with auto-retry timers now partition-bound so transient SSE drops recover cleanly even after the user navigates away. (`c776152`)
- The agent environment hover card now shows the chat's actual workspace folder — resolved from AgentInstance, Agent, or Project bindings via useTerminalTarget — instead of always falling back to the aura-os-server launch directory, and the row is relabeled "Workspace Folder" on both desktop and mobile. (`1793c70`)

## Highlights

- New ChatGPT-style Chat app at /chat with cross-agent inbox
- Five-phase agent-stream reliability plan shipped end-to-end
- Auto-forking chat sessions when context fills up
- Parallel chats per (agent, model) with per-partition send control
- /api/admin/health snapshot for live stability counters

