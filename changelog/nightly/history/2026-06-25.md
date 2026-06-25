# Sturdier streams, smarter pollers, and a refreshed model lineup

- Date: `2026-06-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.710.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.710.1

Today's nightly is a reliability-leaning release: long-running chat turns are no longer killed by an over-eager watchdog, dead remote agents stop hammering the backend, and the model picker behaves itself when scrolled. Alongside the fixes, three new Fireworks-hosted models land in the catalog and a new server-side usage-signal pipeline begins emitting enriched analytics for completed chat turns.

## 3:21 AM — Projects sidebar regains right-click and F2 rename

Restores the context menu and keyboard-rename actions that silently broke after the sidebar's migration to LeftMenuTree.

- Right-click actions (Remove from Project, Rename, Add Agent, Delete Project) and F2-to-rename work again in the projects sidebar — LeftMenuTree rows now emit the `data-list-item` marker that `useExplorerMenus` relies on to resolve the clicked node, which also re-enables deletion of archived agents. (`e019773`)

## 11:44 PM — Server-side usage-signal analytics for chat turns

A new classifier emits an enriched `agent_turn_classified` event for each completed chat turn, persisted as `turn_usage_signal` and forwarded to Mixpanel.

- Introduces a dedicated `aura-os-usage-signals` crate and server-side emission path that classifies completed chat turns with context like route kind, agent binding source, plan mode, council, cross-agent origin, attachment count, and project layout. (`e2cc022`)
- Enriches every signal with z-billing account data — account age, funding and grant-usage buckets, lifetime purchased/granted/used cents, and balance — so downstream analytics can segment turns by billing posture. (`e2cc022`)

## 1:54 PM — Model catalog refresh: new Fireworks models and a GPT-5.4 effort fix

Adds three Fireworks-hosted chat models and corrects an effort-set mismatch that was 400-ing every GPT-5.4 nano call.

- Adds Kimi K2.7 Code (256K), GLM 5.2 (1M), and Qwen3.7 Plus (256K) to the catalog with matching display pricing, legacy-id aliases, and benchmark-pricing mirror entries. (`1fe8f07`)
- Stops the picker from offering `minimal` reasoning effort on GPT-5.4 / -mini / -nano (their API rejects it) and flips nano's default to `low`, so requests no longer 400; persisted `minimal` self-heals via the existing efforts validation. (`aa57d78`)

## 5:16 AM — Model picker no longer stacks overlapping flyouts on scroll

Fixes a race where scrolling the model list under a stationary pointer left multiple submenus open at once.

- Tracks open/closed intent in a synchronous ref so a stale scroll-reflow on an already-closed flyout bails instead of resurrecting it, preserving the single-open invariant while keeping live repositioning intact; regression tests pin both the invariant and the close-then-scroll race. (`9209a18`)

## 10:11 AM — Stuck-stream watchdog stops killing live chat turns

The destructive 60s auto-abort that was cancelling long extended-thinking turns — and billing users for output they never saw — is replaced with a 5-minute absolute safety cap.

- Raises the destructive auto-abort from 60s to a 5-minute `ABSOLUTE_TIMEOUT_MS` cap so long extended-thinking turns aren't cancelled mid-flight; the 90s SSE idle reattach can now recover real socket drops instead of being pre-empted, and users actually receive the output they were billed for. (`f33920b`)
- The non-destructive 30s "taking longer than usual" pill (Stop / Retry / Report) is unchanged; new tests pin that the abort no longer fires at the old 60s mark and that `markStreamProgress` keeps the watchdog quiet across the new window. (`f33920b`)

## 3:52 AM — Remote-agent pollers back off on dead or stuck VMs

Failed or unschedulable remote agents no longer flood `/remote_agent/state` with hundreds of 502/404s.

- The profile-status store stops polling once an agent reports a terminal `error`/`stopped` state or fails three polls in a row, then re-arms via the `RemoteAgentStateChanged` websocket push or a later `registerRemoteAgents` refresh. (`574b6b2`)
- The AgentEnvironment popover's recursive poll backs off from its 2.5s provisioning cadence to a 60s settled interval on terminal or repeatedly-failing states, and auto-resumes the fast cadence when a poll succeeds again — leaving the provisioning→ready happy path untouched. (`574b6b2`)

## Highlights

- Long extended-thinking turns no longer get auto-killed at 60s
- Dead remote agents stop flooding the backend with state polls
- Kimi K2.7 Code, GLM 5.2, and Qwen3.7 Plus join the model catalog
- GPT-5.4 nano calls no longer 400 on unsupported 'minimal' effort

