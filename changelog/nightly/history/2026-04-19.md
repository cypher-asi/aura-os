# Unified agent model, in-app browser, and a flash-free desktop boot

- Date: `2026-04-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.309.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.309.1

A big day across the stack. The dedicated "super-agent" path was collapsed into a single permissions-driven Agent model, a real Chromium-backed browser tab landed inside the projects sidekick, and the CEO-to-agent chat loop got dozens of correctness, context-size, and performance fixes. Desktop cold start was rebuilt to eliminate the login-screen flash, mobile parity flows shipped, and the release pipeline picked up dedicated changelog publishing plus Android and iOS lanes.

## 6:15 PM — Unified Agent model, in-app browser, and a rebuilt CEO chat loop

A long push that retired the dedicated super-agent runtime, shipped a Chromium-backed browser tab and a Talent Marketplace app, and then spent the rest of the day hardening the cross-agent chat path end to end.

- Collapsed the super-agent path into a single Agent model: agents now carry required AgentPermissions and an optional IntentClassifierSpec, the in-process SuperAgentStream and its host-mode toggles were deleted, and every chat turn dispatches through the harness via the unified /api/agent_tools/:name endpoint. Crates were renamed to aura-os-agent-runtime / aura-os-agent-templates, and the interface now derives CEO status from permissions instead of role or tag checks. (`a769bc2`, `2419f49`, `e2173a0`, `d147923`, `17855d8`, `aba4546`, `505dfb9`, `79b0904`, `6e63a65`, `63ff4f9`, `e100b41`, `9ba6107`, `7fbb3a1`, `926ac39`, `78683e4`, `64f9f81`, `82d1b30`)
- Shipped a real in-app browser tab for projects: a new aura-os-browser crate with a Chromium CDP backend, REST + WebSocket endpoints, per-project initial-URL resolution with localhost auto-discovery, and a sidekick BrowserPanel with tabs, an address bar, and an OffscreenCanvas-based frame worker. Follow-ups added per-user session ownership and project-scoped authz, address-bar URL normalization, tab UI polish, non-inverted wheel deltas, and auto-discovery of Chrome/Edge executables. (`a50892f`, `c93e583`, `e00e1a0`, `3b75b94`, `350f2c5`, `ff91081`, `7c763d2`, `440e296`)
- Landed two new top-level apps: a dedicated Integrations app with category-grouped providers (later gated behind a feature flag) and a first end-to-end slice of the Agent Talent Marketplace with browse/filter/hire flows, a typed listing_status + expertise schema, and a backfill script. Also added an Apps organizer modal for reordering and hiding taskbar apps via drag-and-drop. (`ac48a2c`, `889c5db`, `1dca30c`, `23a5c50`, `c12a77d`, `52a0f6f`, `3e18960`, `f93027d`)
- Rebuilt the CEO-to-agent chat loop from the tool manifest up: cross-agent tool endpoints are now absolute URLs stamped with the caller's JWT and org id, harness-native tool names are stripped before Anthropic sees duplicates, send_to_agent was realigned with the harness contract and now drains the target's SSE reply, list_agents/get_agent returns a compact id/name/role summary scoped to the active org, and per-turn setup caches the tool registry and parallelizes network fan-outs. Persistence failures now hard-fail with structured errors instead of silent drops, and CEO permissions self-heal on both agent and instance read paths. (`38166ab`, `811b040`, `2b804b5`, `9220e39`, `553deed`, `b9de762`, `fdd2f5e`, `7282f72`, `0798c25`, `64852c2`, `921b6eb`, `ce304a1`, `2af30d7`, `dd955b7`, `3e14ff1`, `c23075f`, `df7667f`, `a5cb01d`, `18da7c3`, `aa01d1e`, `8a085cc`, `a3c2891`, `89cce06`, `da4abc7`, `a156f7d`, `23ad8d5`)
- Tamed CEO chat context bloat: list_agents/get_agent now return a trimmed summary, tool blobs in history are capped (256B outside the recent window, 2KB inside), a new GetCurrentTimeTool replaces shell `date` calls, and the context indicator in the chat input now hydrates on entry and reveals a hover popover with used/total tokens. (`b6f6c99`, `bc47efd`, `5062b53`, `5bfd148`, `da7a0fc`, `cfaf243`)
- Agent UX improvements across the sidebar and editor: a new Permissions sidekick tab with a scope + capability editor and an Active harness tools diagnostic, a simplified agent editor with a System Prompt field, right-click Edit on the agent list, last-message previews prefetched on mount with stable row height, a right-click Edit action, and a repair pass that normalizes blank agent names on every read path. (`2c0f977`, `8f31b22`, `91af267`, `c2023a3`, `a2e8588`, `67aed23`, `fad98d5`, `dbb62e5`, `8dc6a31`)
- Skills gained end-to-end authoring: Create Skill now registers with the harness so new skills show up immediately, a My Skills section lists user-authored entries via a dedicated endpoint, skills can be deleted through an in-app confirm modal with optimistic UI and silent refresh, and a write-ordering fix keeps the user-created marker from being clobbered by the harness. (`e9760ea`, `f58b09f`, `9e36512`, `b2d2307`, `e861fc2`, `b9b6db4`)
- Desktop and shell reliability: Windows auto-update now shuts down sidecar children before the NSIS installer runs, the update banner renders opaquely above overlays, Notes no longer flickers across app switches, the bottom taskbar is truly centered, and the sidekick width is remembered per-app and re-applied across lazy provider remounts. (`3d4c839`, `712e572`, `011598e`, `73e591c`, `e01c574`, `7dfafe9`, `2e60bea`)
- Projects and workspace ergonomics: a per-machine local workspace override for projects and agents with a FolderPickerField, a /api/system/workspace_defaults endpoint that surfaces the real default path in pickers, and split Git/Orbit sections in Project Settings. (`1fb31df`, `fa25a90`, `c5fbc57`)
- Server performance: list_agents now builds its response from in-memory reads and batches shadow writes into a single settings.json flush, so listing scales independently of agent count and settings size. (`df7667f`)
- Chat view polish: standalone chats no longer swallow a fresh optimistic bubble when earlier turns had identical content, cross-agent deliveries now live-refresh the recipient's standalone chat panel via the org-level agent id, and the RocksStore was renamed to a plain JSON SettingsStore with a first-launch migration from db/ to store/. (`2f75c90`, `a3c2891`, `a3dd6a6`)
- Miscellaneous UI polish: lighter global border with a tighter chat border, focused-window outer border aligned with the title bar, xterm cursor/selection in standard green, a process canvas dot-background fade-in, and trimmed AppsModal chrome. (`b1753ba`, `f91a5bc`, `3b50c31`, `eec6c48`, `d4eab9b`, `ceb3e53`, `257ea71`)
- Runtime split for cleaner boundaries: the Tier-D refactor carved concrete AgentTool implementations into a new aura-os-agent-tools crate and added a policy module with per-call capability re-checks, a TTL-bounded permissions cache, and an audit ring buffer with an AURA_TOOL_POLICY_MODE=audit safety valve. (`82d1b30`)
- Sidekick task panels: completed task turns are now persisted, malformed WRITE rows with empty code areas are fixed, and a placeholder renders when there is no stream or hydrated output. (`0ee88a2`)
- Unblocked `npm run build` by switching AgentTalentCard to the zui 'base' text size and guarding the auth-token localStorage mirror against undefined tokens. (`a241c7b`)

## 12:36 AM — Dedicated changelog workflow and immutable updater URLs

Release tooling moved changelog publishing into its own workflow and started deriving versions and download URLs from the actual release artifacts.

- Split changelog generation out of the nightly and stable release workflows into a dedicated publish-release-changelog.yml, with version derived from the release artifacts rather than passed in as a parameter. (`df6cbe0`, `f212d4d`)
- Switched the daily changelog generator to Claude Opus 4.7. (`efe0f24`)
- Nightly updater manifests now reference immutable per-release asset URLs, with validation scripts updated to match. (`340d9ae`)

## 1:11 AM — Flash-free desktop boot, mobile parity, and remote harness base URL fixes

A long follow-up window that eliminated the login-screen flash on desktop cold start, landed mobile parity flows and service-worker recovery, and unblocked remote harness deployments where cross-agent callbacks were hitting loopback.

- Rebuilt desktop boot around a single invariant: the window becomes visible exactly at the first committed React paint. The aura-os-desktop binary waits for Vite in dev, opens the webview on about:blank before the real navigation, preloads the initial shell app before signaling ready, and injects a frozen window.__AURA_BOOT_AUTH__ global from the on-disk SettingsStore so authenticated users render their shell on frame one instead of briefly flashing /login. The zero_auth_session is now persisted durably so desktop restarts are restart-safe. (`5de2b45`, `d18b401`, `7ad2133`, `801749e`, `5ece265`, `e4f4165`, `28df9cc`, `b79cae9`, `9706639`, `dfe7cc5`)
- Windows desktop polish: the release binary is now marked as the Windows GUI subsystem so no console attaches, and the bundled aura-node sidecar spawns with CREATE_NO_WINDOW and redirected stdout/stderr to a log file. (`b767cfc`, `e5b5c37`)
- Fixed remote-harness fleets grounding on os error 10061: the server's self-callback URL now resolves through a single aura_os_integrations::control_plane_api_base_url() helper tied to AURA_SERVER_BASE_URL, the desktop binary syncs the actually-bound port back into the environment, boot warns (or fails under AURA_STRICT_CONFIG=1) when a remote deployment is missing the base URL, and the server also accepts VITE_API_URL as a fallback so Render only needs a single env var. (`f9cbc36`, `a6a9666`, `8da37ce`, `537b800`)
- New agents created via POST /api/agents now auto-bind to a 'Home' project (shared with the CEO's home-project helper), so the first chat turn no longer fails with 'target agent is not bound to any project'. Existing orphan agents self-heal on their next chat attempt. (`4d3026a`)
- Mobile parity: reworked mobile drawer, topbar, organization view and project views, added a preload-recovery path for the service worker, and landed broad regression coverage including E2E layout-capability and responsive-unification specs plus updated release documentation. (`d3fa7e2`, `b769e19`, `56708c1`, `4d7e4bc`, `1e362e9`)
- Fixed the CEO's list_agents tool hiding legacy NULL-org agents: it now mirrors the /api/agents handler by running org-scoped and user-scoped lookups concurrently and merging by agent_id. (`430ff60`)
- Release tooling: hardened the changelog metadata handoff across workflows, dropped the deprecated Anthropic temperature param, strengthened retry logic in the generator, tightened changelog title/summary specificity, and added GitHub Android and iOS mobile release lanes alongside the nightly workflow. (`ac4e3c5`, `3f9cd0a`, `8de9cb4`, `eac0e7a`, `aa94703`, `a4c486f`)

## 2:00 PM — iOS submission pipeline fixes

Two small but blocking fixes to the iOS Fastlane submission flow.

- Fixed the iOS App Store Connect API-key review submission precheck in the Fastfile. (`219bd35`)
- Fixed iOS export compliance submission by updating Info.plist and the Fastlane lane. (`b716c72`)

## 7:03 PM — Seeded auth session for the workflow eval harness

Test plumbing fix so the workflow eval no longer bounces through /login.

- The mocked workflow eval now injects aura-jwt, aura-session, and aura-last-app via addInitScript so the authenticated shell renders from the first frame instead of ricocheting through /login and the default-app redirect. (`3665e71`)

## 7:25 PM — VITE_API_URL as a fallback for the control-plane base URL

A final deployment-unblocker so Render only needs one env var to configure both frontend and backend public URLs.

- The server now falls back to VITE_API_URL when AURA_SERVER_BASE_URL is unset, so remote harness agents no longer stamp loopback into cross-agent callbacks and fail with `tcp connect error: os error 10061`. AURA_SERVER_BASE_URL remains the higher-priority explicit override. (`9914207`)

## Highlights

- Single Agent model replaces the super-agent path
- Chromium-backed browser tab in projects sidekick
- Talent Marketplace and Integrations apps
- Desktop boot no longer flashes the login screen
- Dozens of CEO chat correctness and context-size fixes
- Dedicated release changelog workflow + mobile release lanes

