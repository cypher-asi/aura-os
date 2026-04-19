# Unified agent model, in-app browser, and a flash-free desktop boot

- Date: `2026-04-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.305.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.305.1

A heavy day across the stack: the dedicated super-agent path was collapsed into a single permissions-driven Agent model, a real Chromium-backed browser tab landed in the projects sidekick, a Talent Marketplace app was scaffolded end-to-end, and a long sequence of fixes stopped the desktop app from flashing the login screen at startup. Release tooling also got meaningfully more robust.

## 6:15 PM — Agent platform rebuilt around permissions, with a new browser and marketplace

The biggest thread of the day: the super-agent code path was retired, replaced by a single Agent model gated by AgentPermissions, while a Chromium-backed browser tab and a Talent Marketplace app shipped alongside dozens of chat reliability and UX fixes.

- Collapsed the dedicated super-agent path into one Agent model: AgentPermissions is now required on every agent, the CEO is detected purely by its preset bundle, the in-process SuperAgentStream and its caches were deleted, and the super-agent crates were renamed to aura-os-agent-runtime and aura-os-agent-templates. The interface followed suit, dropping host-mode toggles and deriving super-agent status from permissions. (`7fbb3a1`, `e100b41`, `926ac39`, `78683e4`, `9ba6107`, `79b0904`)
- Shipped an in-app browser in the projects sidekick: a new aura-os-browser crate with a Chromium CDP backend, REST + WebSocket endpoints, a lazy BrowserPanel with tabs and address bar, off-main-thread frame painting, project-aware initial URLs via terminal URL sniffing and port probing, and per-user session ownership with project-scoped authz. (`a50892f`, `c93e583`, `e00e1a0`, `3b75b94`, `350f2c5`, `440e296`, `ff91081`)
- Scaffolded an Agent Talent Marketplace as a top-level app with browsing, filtering, and hiring flows, backed by a new /api/marketplace/agents endpoint, first-class listing_status and expertise fields on Agent, a tag-backfill script, and a permissions-based sidekick reuse of the existing agent UI. (`3e18960`, `f93027d`)
- Hardened cross-agent tool delivery end-to-end: real descriptions and schemas are now sent to the harness, duplicate and harness-native tool names are stripped, endpoints are absolutized against the control-plane URL, JWT and org-id headers are stamped on dispatcher calls, and send_to_agent now drains the target's SSE reply and reports persistence outcome so silent drops surface as errors. (`9220e39`, `b9de762`, `7282f72`, `0798c25`, `64852c2`, `921b6eb`, `ce304a1`, `18da7c3`, `c23075f`, `fdd2f5e`, `3e14ff1`)
- Stopped CEO chats from blowing their context window in two turns: list_agents / get_agent now return compact id/name/role summaries scoped to the active org, tool blobs in history are truncated with an older-turn cap, and the CEO manifest ships a static core-tools allowlist instead of per-turn classifier narrowing. (`b6f6c99`, `bc47efd`, `8a085cc`, `23ad8d5`)
- Made the CEO usable out of the box: setup auto-creates a Home project binding so direct chats persist, legacy CEOs with empty permissions are repaired on read and write, duplicate CEOs can be swept via a new /api/super-agent/cleanup endpoint, and the agent store auto-invokes cleanup when it sees duplicates. (`89cce06`, `811b040`, `553deed`, `da4abc7`, `a156f7d`, `2b804b5`)
- Added a Permissions sidekick tab with a scope + capability editor, an Active harness tools diagnostic that flags missing registrations, a new Edit action on the agent right-click menu, and a slimmer agent editor with a System Prompt field. (`2c0f977`, `38166ab`, `8f31b22`, `91af267`)
- Introduced a first-class Integrations app with category-grouped navigation and a dedicated Providers section, plus an Apps organizer modal that lets users drag and drop taskbar apps between Visible and Hidden with persistent ordering. (`ac48a2c`, `889c5db`, `23a5c50`, `c12a77d`, `52a0f6f`, `1dca30c`)
- Added a Skills workflow: users can create, list, and delete their own skills from a new My Skills section, with a harness-overwrite race fixed so the user-created marker sticks, silent refreshes and optimistic removal on mutation, and an in-app delete confirmation modal replacing window.confirm. (`e9760ea`, `f58b09f`, `9e36512`, `b2d2307`, `e861fc2`, `b9b6db4`)
- Fixed the Windows desktop auto-updater by shutting down sidecar children before the NSIS installer runs, and resolved the update banner's transparent background and stacking-order bug so it always paints on top. (`3d4c839`)
- Chat UX improvements: a hover/click popover on the context indicator showing used vs total tokens, hydration of the context indicator on chat open, a fix for a stale identical-message history row swallowing fresh optimistic bubbles, and live cross-agent chat refresh via a WebSocket event bus. (`da7a0fc`, `5062b53`, `5bfd148`, `2f75c90`, `a3c2891`, `a5cb01d`, `cfaf243`)
- Sliced CEO-preset chat setup latency by caching the tool registry and metadata, parallelizing project/org lookups, dropping redundant liveness probes, TTL-caching agent network lookups, and batching list_agents shadow writes so settings.json is rewritten at most once per request. (`2af30d7`, `df7667f`, `dd955b7`)
- Added a cross-platform get_current_time tool so CEOs asked for the date stop falling back to shell-specific date commands, and extracted every concrete AgentTool into a new aura-os-agent-tools peer crate with per-call capability re-checks, an audit ring buffer, and an AURA_TOOL_POLICY_MODE=audit safety valve. (`aa01d1e`, `82d1b30`)
- Workspace and project polish: a per-machine local workspace folder override for projects and agents, a /api/system/workspace_defaults endpoint that surfaces the real default path in folder pickers, a split Github/Orbit section in project settings, and a per-app sidekick width that survives lazy provider remounts. (`1fb31df`, `fa25a90`, `c5fbc57`, `7dfafe9`, `2e60bea`)
- Repaired blank agent-name regressions on every read path, on hydration from the IndexedDB cache, and in the sidebar preview row, so project-local general agents no longer render as empty labels. (`67aed23`, `fad98d5`, `dbb62e5`, `8dc6a31`, `c2023a3`)
- Interface polish: taskbar app rail recentered and favorites moved to the left, Notes content no longer flickers on app switches, the sidekick sessions list loses its misleading spinner, window and chat borders were retuned, and the Today's Signups label on the leaderboard was corrected. (`011598e`, `73e591c`, `712e572`, `a2e8588`, `b1753ba`, `f91a5bc`, `257ea71`, `eec6c48`, `ceb3e53`)
- Storage and auth plumbing: renamed RocksStore to SettingsStore with an on-disk db/ to store/ migration, snapshotted AgentPermissions + IntentClassifierSpec onto AgentInstance so project-scoped chats don't silently drop cross-agent capabilities, and made the auth token module synchronously seed the cached session from localStorage on import. (`a3dd6a6`, `64f9f81`, `52f9dc5`, `9da41eb`, `7460ab4`, `e01c574`)
- Closed out the Sidekick run panel regressions where completed turns were dropped and malformed WRITE rows rendered during streaming, and unblocked the frontend build by fixing tsc errors in the marketplace card and the auth-token localStorage mirror. (`0ee88a2`, `a241c7b`)

## 12:36 AM — Changelog publishing moved to its own workflow with immutable asset URLs

Release Infrastructure was split out and hardened so the daily changelog runs independently of nightly builds and always points at stable download URLs.

- Moved release changelog publishing into a dedicated GitHub Actions workflow, with the version derived from release artifacts instead of passed through job inputs. (`df6cbe0`, `f212d4d`)
- Updater manifests now reference immutable nightly release URLs, with accompanying validation scripts for desktop downloads and manifests so broken or mutable links are caught before publish. (`340d9ae`)
- Switched the daily changelog generator to Claude Opus 4.7. (`efe0f24`)

## 1:11 AM — CEO list_agents now sees legacy NULL-org agents and hits the right control-plane URL

Two targeted backend fixes aligned the CEO's agent visibility and cross-agent callbacks with the rest of the server.

- The CEO's list_agents tool now merges org-scoped and user-scoped results (mirroring the sidebar handler), so legacy agents with a NULL org_id stop disappearing from the CEO's view. (`430ff60`)
- control_plane_api_base_url now reads AURA_SERVER_BASE_URL instead of an undocumented variable, so remote harnesses (e.g. aura-swarm on Render) no longer see cross-agent tool endpoints stamped with a loopback URL, with documentation updated to match. (`f9cbc36`)

## 1:15 AM — Release changelog metadata handoff hardened

Tightened how release metadata is passed between the nightly, stable, and changelog-publish workflows.

- Reworked the changelog metadata handoff between the nightly, stable, and publish-release-changelog workflows so version, channel, and artifact data flow reliably between jobs. (`ac4e3c5`)

## 1:28 AM — Flash-free desktop boot, mobile parity flows, and safer remote deployments

A long debugging thread finally eliminated the login-screen flash on desktop cold start, mobile gained real parity for org, project, and agent flows, and remote deployments now refuse to silently fall back to loopback URLs.

- Ended the desktop login-screen flash on cold start by injecting boot auth directly from the Rust on-disk settings store into the webview before any page scripts run, preloading the initial shell app's lazy module, and gating the Tauri window reveal on both React's first paint and that preload. Earlier attempts that gated only LoginView, the /login route, or the whole route tree are superseded. (`5de2b45`, `d18b401`, `7ad2133`, `801749e`, `5ece265`, `e4f4165`, `28df9cc`, `b79cae9`)
- Desktop polish on Windows: the release binary now uses the GUI subsystem (no stray conhost window), the bundled aura-node sidecar is spawned with CREATE_NO_WINDOW and logs to a file, the main webview starts from about:blank to avoid painting stale cached pages, and the bound server port is synced into the process env so loopback tool callbacks reach the real listener. (`b767cfc`, `dfe7cc5`, `e5b5c37`, `537b800`)
- Shipped mobile remote parity flows across feed, projects, agent editor, and mobile shell (topbar, drawer, organization view), backed by new mobile runtime and regression coverage and refreshed mobile release documentation. (`d3fa7e2`, `b769e19`, `56708c1`, `4d7e4bc`, `1e362e9`)
- Auto-binding new agents to a Home project so the very first chat turn persists, generalizing the existing CEO helper and adding a lazy self-heal for orphan agents on their next chat attempt. (`4d3026a`)
- Remote-deployment safety: the server now refuses to ship a loopback control-plane URL to a remote harness, logs a boot-time warning (fatal under AURA_STRICT_CONFIG=1) when AURA_SERVER_BASE_URL is missing on a remote-looking deployment, and centralizes base URL resolution through the shared helper. (`a6a9666`, `8da37ce`)
- Hardened the changelog generator's Anthropic client: dropped the deprecated temperature parameter and added retries for transient failures. (`3f9cd0a`, `8de9cb4`)

## 10:53 AM — Android GitHub APK lane and tighter changelog specificity

A small infrastructure follow-up exposed an Android release lane and tightened the changelog generator's prompts.

- Exposed an Android GitHub APK release lane via the android-mobile workflow. (`aa94703`)
- Tightened the changelog generator's guidance on title and summary specificity to reduce generic phrasing. (`eac0e7a`)

## Highlights

- Super-agent path collapsed into a single permissions-based Agent model
- New Chromium-backed browser tab in the projects sidekick
- Talent Marketplace app scaffolded end-to-end
- Desktop cold start no longer flashes the login screen
- Release changelog publishing moved to its own hardened workflow

