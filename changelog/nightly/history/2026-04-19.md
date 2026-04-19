# Unified agents, embedded browser, and a flash-free desktop boot

- Date: `2026-04-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.306.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.306.1

A dense day across Aura: the super-agent concept collapsed into a single permissions-driven Agent model, a Chromium-backed browser tab and Talent Marketplace landed in the sidekick, the CEO's cross-agent tooling was hardened end-to-end, and the desktop app finally boots straight into the shell without a login flash. Release tooling also picked up immutable updater URLs, a standalone changelog workflow, and automated mobile release lanes.

## 6:15 PM — Unified Agent model, embedded browser, and marketplace scaffolding

A long evening batch that rebuilt super-agents around AgentPermissions, shipped a Chromium-backed browser inside the projects sidekick, scaffolded the Talent Marketplace app, and landed a deep round of CEO chat reliability fixes.

- Collapsed the dedicated super-agent stack into a single Agent model: CEO status is now derived from AgentPermissions (universe scope + core capabilities), the in-process SuperAgentStream and host-mode env vars are gone, and every chat turn routes through the unified harness path. The interface drops the Local/Cloud toggle and exposes a read-only permissions summary instead. (`7fbb3a1`, `926ac39`, `e100b41`, `78683e4`, `64f9f81`)
- Added a projects-sidekick Browser tab backed by a new aura-os-browser crate and a Chromium/CDP backend: real input, accurate navigation, backpressured screencast, per-user session ownership, project-scoped authz, auto-discovered Chrome/Edge executables, and isolated temp profiles. The UI ships tabs, an address bar that normalizes bare hostnames, and fixes non-inverted wheel deltas. (`a50892f`, `c93e583`, `e00e1a0`, `3b75b94`, `350f2c5`, `ff91081`, `440e296`, `7c763d2`)
- Scaffolded the Agent Talent Marketplace as a first-class app with GET /api/marketplace/agents (sort/filter/search/pagination), canonical listing_status and expertise fields, a backfill script, and a new Marketplace left menu, talent cards, and Hire flow. Providers were split out of Integrations into their own group behind a feature flag. (`3e18960`, `889c5db`, `1dca30c`, `f93027d`)
- Made the CEO's cross-agent chat actually work end to end: dispatcher tools now ship real descriptions and schemas, endpoints are absolutized against AURA_SERVER_BASE_URL, JWT + org id are stamped on every call, duplicate and harness-native tool names are stripped before Anthropic sees them, and send_to_agent drains the target's SSE reply, surfaces persistence failures as hard errors, and targets the local server instead of aura-network. (`9220e39`, `64852c2`, `921b6eb`, `b9de762`, `7282f72`, `0798c25`, `ce304a1`, `3e14ff1`, `18da7c3`, `c23075f`, `a5cb01d`, `dd955b7`)
- Tamed CEO chat context bloat: list_agents is now scoped to the active org and returns only id/name/role, tool blobs in history are capped, and a static CEO_CORE_TOOLS allowlist replaces the per-turn intent classifier. A cached ToolRegistry, parallelised org/integration lookups, and a 5s agent-lookup cache cut per-turn setup latency. The bottom-bar context indicator now hydrates on chat entry and shows used/total tokens on hover. (`b6f6c99`, `bc47efd`, `2af30d7`, `5062b53`, `5bfd148`, `da7a0fc`, `df7667f`)
- New Apps organizer modal lets users drag-and-drop taskbar apps between Visible and Hidden, a new dedicated Integrations app groups providers by category, and a per-app Permissions sidekick tab with an Active harness tools diagnostic shows exactly which tools ship to the LLM. (`23a5c50`, `c12a77d`, `52a0f6f`, `ac48a2c`, `2c0f977`, `38166ab`)
- Authored-skill lifecycle is complete: Create Skill now registers with the harness (surviving its own overwrite), a My Skills section is backed by a user-created marker, and skills can be deleted through an in-app modal with optimistic removal and silent refresh. (`e9760ea`, `f58b09f`, `9e36512`, `b2d2307`, `e861fc2`, `b9b6db4`)
- Projects and agents gained per-machine workspace overrides with a FolderPickerField, a /api/system/workspace_defaults endpoint now surfaces the real default path, the agent editor is simplified with a System Prompt field, and project-local general agents self-heal blank names across every list path and the IndexedDB cache. (`1fb31df`, `fa25a90`, `91af267`, `67aed23`, `fad98d5`, `dbb62e5`, `8dc6a31`)
- Desktop update banner is always legible on top of taskbar overlays, Windows auto-update now stops sidecar children before the installer runs, and sidekick widths are remembered per-app with lazy-provider remount handled cleanly. (`3d4c839`, `7dfafe9`, `2e60bea`)

## 12:36 AM — Release changelog pipeline split out and updater URLs made immutable

Release infrastructure got its own publish workflow and stopped pointing updater manifests at mutable URLs.

- Changelog generation now runs in a dedicated publish-release-changelog workflow instead of piggybacking on the nightly/stable release pipelines, and derives its version directly from the release artifacts. (`df6cbe0`, `f212d4d`)
- Nightly updater manifests are now pinned to immutable release URLs, with validators updated so downloads and manifests stay in lockstep. Changelog generation moved to Claude Opus 4.7. (`340d9ae`, `efe0f24`)

## 1:11 AM — CEO agent listing and remote control-plane URL fixes

Two targeted fixes so the CEO sees every agent the sidebar does and cross-agent tool callbacks work on remote deployments.

- The CEO's list_agents LLM tool now runs org- and user-scoped lookups concurrently and merges by id, restoring visibility of legacy NULL-org rows that had been disappearing since listing went strictly org-scoped. (`430ff60`)
- control_plane_api_base_url now reads AURA_SERVER_BASE_URL (the same var the server already resolves), so remote harnesses stop stamping http://127.0.0.1 into cross-agent tool endpoints. Documented in .env.example and render-deployment.md. (`f9cbc36`)

## 1:15 AM — Changelog metadata handoff between release workflows

Tightened how release metadata flows from the build workflows into the changelog publisher.

- Hardened the metadata handoff between the nightly/stable release workflows and the new changelog publisher so downstream jobs get consistent version and channel inputs. (`ac4e3c5`)

## 1:28 AM — Flash-free desktop boot, mobile parity flows, and auto-bound chat persistence

A morning block focused on making desktop cold start land directly in the shell, shipping a round of mobile remote-parity UI, and fixing the first-chat persistence gap for freshly created agents.

- Desktop cold start no longer flashes the login screen: boot auth is injected from the on-disk Aura store into window.__AURA_BOOT_AUTH__ before any JS runs, the initial app route is preloaded before the window is revealed, signalDesktopReady fires on the first committed React paint, and the Windows console and sidecar terminals are suppressed in release builds. WebView2 starts at about:blank to avoid stale cached content. (`5de2b45`, `d18b401`, `7ad2133`, `801749e`, `5ece265`, `e4f4165`, `28df9cc`, `b79cae9`, `b767cfc`, `dfe7cc5`, `e5b5c37`)
- Mobile gained a coordinated parity pass: refreshed topbar/drawer flows, a leaner AgentEditorModal, project files/tasks/work views reworked for mobile layout, a FeedMainPanel that hides the commit grid when empty, plus new runtime helpers (host-config, native-runtime, preload-recovery, service worker registration) and broad regression coverage including PWA visual tests. (`d3fa7e2`, `b769e19`, `56708c1`, `4d7e4bc`, `1e362e9`)
- New agents are now auto-bound to a Home project on create, and existing orphan agents self-heal on their next chat attempt, so the very first message no longer hard-fails with "Chat persistence unavailable". (`4d3026a`)
- Deployment safety: the server refuses to ship a loopback control-plane URL to a remote harness, warns at boot (fatal under AURA_STRICT_CONFIG=1) when AURA_SERVER_BASE_URL is missing on a remote-looking install, and the desktop app syncs the bound server port back into the env so local tool callbacks reach the real listener. (`a6a9666`, `537b800`, `8da37ce`)
- Changelog tooling stabilised: dropped the deprecated Anthropic temperature param and hardened retry behaviour in the generator. (`3f9cd0a`, `8de9cb4`)

## 10:53 AM — Mobile release automation and Android APK lane

Afternoon release-infra work that opened up mobile release automation and tightened changelog prompts.

- Exposed an Android GitHub APK release lane and automated the main mobile release workflows across iOS, Android, and the nightly pipeline. (`aa94703`, `a4c486f`)
- Tightened the daily changelog generator's title and summary specificity rules so published entries stay concrete. (`eac0e7a`)

## Highlights

- Unified Agent model replaces the super-agent path with permissions-gated tools
- New Chromium-backed browser tab and Talent Marketplace app
- Desktop cold start no longer flashes the login screen
- CEO cross-agent chat made reliable with dedupe, auth, and context fixes
- Release pipeline hardened with immutable URLs and mobile automation

