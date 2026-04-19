# Unified agents, a new browser sidekick, and a flash-free desktop boot

- Date: `2026-04-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.308.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.308.1

A dense day across Aura: the super-agent plumbing collapsed into a single permissions-driven Agent model, a Chromium-backed browser tab landed in the Projects sidekick, a new Talent Marketplace and Integrations app arrived, and a long chain of chat, context, and boot-time fixes made the CEO experience and desktop startup dramatically tighter. Release infrastructure and mobile pipelines were also overhauled.

## 6:15 PM — Unified Agent model, CEO chat plumbing, and a Chromium browser sidekick

A sweeping day-long push collapsed super-agents into a single permissions-driven Agent model, shipped a project-aware browser tab backed by Chromium CDP, added the Talent Marketplace and a dedicated Integrations app, and chased down an extensive chain of CEO chat routing, context, and tool-wiring bugs.

- Collapsed the dedicated super-agent path into a single Agent model whose CEO status is derived from AgentPermissions, retired the legacy in-process SuperAgentStream, renamed the super-agent crates to aura-os-agent-{runtime,templates}, and reworked the interface to detect CEOs from permissions instead of tags or role. (`2419f49`, `d147923`, `17855d8`, `505dfb9`, `e100b41`, `7fbb3a1`, `926ac39`, `78683e4`, `9ba6107`, `79b0904`)
- Added a project-aware browser tab to the Projects sidekick with a new aura-os-browser crate, a Chromium CDP backend with interactive input, per-user session ownership, project-scoped authz, executable auto-discovery, address-bar URL normalization, and correct wheel-delta forwarding. (`a50892f`, `c93e583`, `e00e1a0`, `3b75b94`, `350f2c5`, `ff91081`, `7c763d2`, `440e296`)
- Shipped a scaffold of the Agent Talent Marketplace as a top-level app with list/sort/filter endpoints, canonical expertise slugs, a migration for listing_status/expertise fields, and a new Integrations app that breaks provider management out of Team Settings and groups AI providers under their own header. (`3e18960`, `f93027d`, `ac48a2c`, `889c5db`, `1dca30c`)
- Added a Permissions sidekick tab with a full scope and capability editor, an installed-tools diagnostic that surfaces the exact manifest shipped to the harness, and a simplified Agent editor with a system prompt field and right-click Edit action. (`2c0f977`, `38166ab`, `91af267`, `8f31b22`)
- Stabilized CEO chat end-to-end: auto-created a Home project binding so direct CEO chats persist, gated project tools on Read/WriteProject, shipped real tool descriptions and schemas to the harness, centralized installed_tools deduping, stripped the harness-native tool catalog to stop Anthropic 400s, absolutized and JWT-stamped cross-agent endpoints, and repaired empty CEO permissions on both the agent and instance read paths. (`89cce06`, `2b804b5`, `9220e39`, `b9de762`, `fdd2f5e`, `7282f72`, `0798c25`, `64852c2`, `921b6eb`, `ce304a1`, `811b040`, `553deed`)
- Drastically cut CEO context usage and latency: slimmed list_agents/get_agent results to id/name/role scoped by org, capped tool blobs in conversation history, switched the CEO to a static core-tools allowlist, cached the tool registry across turns, and parallelized org/project fan-outs. (`b6f6c99`, `bc47efd`, `2af30d7`, `df7667f`)
- Hardened cross-agent messaging: send_to_agent now routes through the local server, drains the target's SSE reply under strict size/time budgets, hard-fails on persistence errors, live-refreshes the target's chat panel via broadcast events, and scopes the agent list to the active org with a user-scoped backstop. (`3e14ff1`, `18da7c3`, `c23075f`, `a5cb01d`, `a3c2891`, `8a085cc`, `23ad8d5`, `dd955b7`)
- Added user-authored skills: a My Skills section, create/delete endpoints that keep the user-created marker through harness overwrites, an in-app delete confirmation modal, optimistic silent refresh, and automatic registration with the harness catalog so newly created skills appear in the UI. (`e9760ea`, `f58b09f`, `9e36512`, `b2d2307`, `e861fc2`, `b9b6db4`)
- Polished the shell: an Apps organizer modal with drag-and-drop for taskbar visibility and order, a stable centered taskbar with favorites/apps split, per-app sidekick widths that retarget reliably across lazy-loaded providers, and a fix for flicker on desktop-mode switches. (`23a5c50`, `c12a77d`, `52a0f6f`, `011598e`, `73e591c`, `7dfafe9`, `2e60bea`, `712e572`)
- Context-usage indicator now hydrates on chat entry from the latest assistant_message_end, exposes a hover popover showing used vs total tokens, and survives new-session resets; also fixed a merge bug that swallowed fresh optimistic chat bubbles when prior turns had identical content. (`5062b53`, `5bfd148`, `da7a0fc`, `cfaf243`, `2f75c90`)
- Fixed the Windows auto-update sidecar lock and update banner stacking so installs can actually overwrite binaries, added a per-project local workspace folder override with a native folder picker, and exposed workspace_defaults so the "leave blank" hint shows the real resolved path. (`3d4c839`, `1fb31df`, `fa25a90`)
- Repaired several long-standing agent data hazards: blank agent names are now healed on every read path and during IndexedDB hydration, duplicate CEOs are deduped via a one-shot cleanup endpoint auto-invoked by the client, and a batched shadow-write avoids rewriting settings.json per row during list_agents. (`67aed23`, `da4abc7`, `a156f7d`, `fad98d5`, `dbb62e5`, `8dc6a31`, `df7667f`)
- Extracted every concrete AgentTool impl into a new aura-os-agent-tools crate and added a capability re-check policy layer with an in-memory audit ring buffer, fixing 403s on local installs and giving cross-agent tool calls proper telemetry. (`82d1b30`)
- Startup and auth hardening: synchronous seeding of the cached session from localStorage, a dedicated hasResolvedInitialSession flag blocking login routes until hydration finishes, a RocksStore-to-SettingsStore rename with on-disk directory migration, and waiting for React-ready UI before revealing the desktop window. (`52f9dc5`, `9da41eb`, `7460ab4`, `a3dd6a6`, `e01c574`, `ceb3e53`)
- Introduced a HarnessClient with typed tx/stream/WS calls, a Local vs Cloud toggle wired through the harness tag, and a harness-health probe surfaced in the Agent editor. (`a769bc2`, `aba4546`, `e2173a0`, `63ff4f9`, `6e63a65`)
- Misc polish: a cross-platform get_current_time system tool, Apps modal description cleanup, process canvas dot-background fade-in, lighter global border tokens, removed a sidekick status spinner that looked like a loading indicator, and a Sidekick run panel that now persists completed task turns. (`aa01d1e`, `d4eab9b`, `eec6c48`, `b1753ba`, `f91a5bc`, `a2e8588`, `c2023a3`, `0ee88a2`, `257ea71`, `c5fbc57`, `3b50c31`, `a241c7b`)
- Captured project-local agent instance permissions at creation time so cross-agent capabilities no longer silently drop on project-scoped chats. (`64f9f81`)

## 12:36 AM — Changelog publishing split out into its own workflow

Release changelog generation moved to a dedicated workflow with artifact-derived versions, immutable nightly release URLs, and an upgraded Claude Opus model.

- Split release changelog publishing into its own GitHub workflow, derived the version from release artifacts, and locked updater manifests to immutable nightly release URLs with matching validator updates. (`df6cbe0`, `f212d4d`, `340d9ae`)
- Switched changelog generation to Claude Opus 4.7. (`efe0f24`)

## 1:11 AM — Org-scoped CEO agent listing and remote control-plane URL alignment

Closed two follow-ups from the org-scoped listing change: the CEO's list_agents tool now matches the sidebar's merge strategy, and the integrations helper reads the same AURA_SERVER_BASE_URL as the rest of the server.

- Restored NULL-org agents in the CEO's list_agents tool by running org- and user-scoped lookups concurrently and merging by id, mirroring the sidebar's backfill behavior. (`430ff60`)
- Aligned control_plane_api_base_url with AURA_SERVER_BASE_URL so remote harness deployments no longer stamp localhost into cross-agent tool endpoints, with docs and a troubleshooting note updated to match. (`f9cbc36`)

## 1:15 AM — Hardened metadata handoff between release and changelog workflows

Tightened how release-nightly and release-stable pass version and channel metadata into the changelog publisher.

- Reworked the release-to-changelog metadata handoff across the nightly, stable, and publish-release-changelog workflows for more reliable version and channel propagation. (`ac4e3c5`)

## 1:28 AM — Flash-free desktop boot, mobile parity flows, and Android release lane

Eliminated the login-panel flash on desktop cold start by injecting boot-auth from the Rust on-disk store, added new mobile parity flows with regression coverage, and hardened the release pipeline around changelog generation and Android/iOS lanes.

- Killed the desktop login-panel flash by injecting boot auth from the persisted SettingsStore through a frozen window global, tying window reveal to the first committed React paint, preloading the initial shell app's lazy module, and syncing the bound server port into env so loopback tool callbacks reach the real listener. (`5de2b45`, `d18b401`, `7ad2133`, `801749e`, `5ece265`, `e4f4165`, `28df9cc`, `b79cae9`, `537b800`)
- Tightened the Windows desktop experience: GUI subsystem so no console pops up on release launch, bundled aura-node sidecar hidden with CREATE_NO_WINDOW and redirected to a log file, and main webview starts at about:blank to avoid painting stale cached content. (`b767cfc`, `dfe7cc5`, `e5b5c37`)
- Shipped new mobile remote parity flows across Feed, Project Files, Tasks, Work, Agent Setup, and the mobile shell, backed by expanded runtime and e2e regression coverage plus a refreshed mobile release rubric. (`d3fa7e2`, `b769e19`, `56708c1`, `4d7e4bc`, `1e362e9`)
- Auto-bound newly created agents to a Home project so their first chat turn persists, generalizing the CEO bootstrap helper and self-healing legacy orphan agents on next chat. (`4d3026a`)
- Refused to ship a loopback control-plane URL to remote harnesses, surfacing a named error at session init and logging a fatal-under-strict-config warning when AURA_SERVER_BASE_URL is missing on a deployment that looks remote. (`a6a9666`, `8da37ce`)
- Opened an Android GitHub APK release lane, automated mobile main release workflows across Android and iOS, and hardened the changelog Anthropic client with retries and tighter title/summary specificity rules. (`aa94703`, `a4c486f`, `3f9cd0a`, `8de9cb4`, `eac0e7a`)

## 2:00 PM — iOS App Store submission fixes for export compliance and API-key review

Two fastlane tweaks unblocked iOS submissions tied to export compliance metadata and the API-key review precheck.

- Fixed the iOS App Store Connect API-key review submission precheck and the export compliance submission path so nightly iOS builds can move through review. (`219bd35`, `b716c72`)

## Highlights

- Single unified Agent model with permissions-driven CEO
- Chromium browser sidekick for Projects
- Talent Marketplace and dedicated Integrations app
- CEO chat context, routing, and tool wiring overhauled
- Flash-free desktop boot with injected auth state
- Mobile parity flows and Android/iOS release lanes

