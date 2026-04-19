# One Agent model, a new in-app browser, and a Talent Marketplace

- Date: `2026-04-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.302.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.302.1

A heavy day across the stack: the super-agent split is gone — there is now a single Agent type governed by permissions — while the product gains a Chromium-backed browser in the projects sidekick and a new Talent Marketplace. A long reliability arc hardened CEO chat routing, context usage, desktop startup, and the release changelog pipeline.

## 6:15 PM — Unified agents, a sidekick browser, and a Marketplace

The bulk of the day: agents collapse into a single permissions-driven model, a Chromium-backed browser lands in the projects sidekick, the Talent Marketplace ships, and CEO chat reliability gets a long, focused overhaul.

- Collapsed the dedicated super-agent path into the regular Agent model: what makes an agent a CEO is now an AgentPermissions bundle plus an optional intent classifier, and every chat turn flows through the harness via a single dispatcher. The legacy in-process SuperAgentStream, host-mode toggles, migration helpers, and the Local/Cloud UI were all retired, and the crates were renamed to aura-os-agent-runtime and aura-os-agent-templates. (`a769bc2`, `2419f49`, `e2173a0`, `c93e583`, `d147923`, `17855d8`, `aba4546`, `505dfb9`, `79b0904`, `6e63a65`, `63ff4f9`, `e100b41`, `9ba6107`, `7fbb3a1`, `926ac39`, `78683e4`, `64f9f81`)
- Shipped a real in-app browser in the projects sidekick: a new aura-os-browser crate with a Chromium/CDP backend, REST + WebSocket endpoints, tabbed BrowserPanel with address bar and dev-URL auto-discovery, project-aware initial URLs, per-user session ownership, URL normalization, and fixes for wheel-delta inversion. Executable auto-discovery and isolated temp profiles make it work out-of-the-box on dev machines. (`a50892f`, `c93e583`, `e00e1a0`, `3b75b94`, `350f2c5`, `ff91081`, `7c763d2`, `440e296`)
- Introduced the Agent Talent Marketplace: a new top-level app for browsing, filtering, and hiring published agents, with typed listing_status and expertise fields on the Agent record, a /api/marketplace/agents endpoint, and agent-scoped permissions editing via a new Permissions sidekick tab. (`3e18960`, `2c0f977`, `f93027d`)
- Reworked the taskbar and Integrations: apps split integrations out of Team Settings into a dedicated Integrations app with grouped Providers, added a drag-and-drop Apps organizer for taskbar visibility and ordering, and centered the bottom taskbar layout. A long sequence of AppsModal drag-overlay fixes followed (vertical-axis constraint, body portal, stable cross-section DnD). (`ac48a2c`, `889c5db`, `011598e`, `73e591c`, `23a5c50`, `c12a77d`, `52a0f6f`, `d4eab9b`, `1dca30c`)
- Hardened CEO cross-agent messaging end-to-end: deduplicated installed_tools before shipping to the LLM, stripped harness-native duplicates by walking the real harness catalog, absolutized tool endpoints and stamped JWT + org id on them, realigned send_to_agent with the harness contract, drained the target's SSE reply back to the caller under strict size/time budgets, and surfaced persistence status so silent drops became visible. (`b9de762`, `fdd2f5e`, `7282f72`, `0798c25`, `64852c2`, `921b6eb`, `ce304a1`, `dd955b7`, `3e14ff1`, `c23075f`, `18da7c3`, `a5cb01d`, `c1dc471`)
- Fixed CEO chats exhausting context in two turns: slimmed list_agents/get_agent responses to id/name/role, scoped listings to the caller's org, capped tool blobs in history replay, replaced the per-turn classifier with a static CEO_CORE_TOOLS allowlist, and added a bottom-bar context-usage popover showing used/total tokens that hydrates on chat open. (`b6f6c99`, `bc47efd`, `5062b53`, `5bfd148`, `da7a0fc`, `cfaf243`, `2af30d7`)
- Stabilized the agents sidebar: chat previews now load on mount with concurrency-gated prefetch and row heights stay constant, the CEO's permissions safety net repairs empty bundles on read and on project-instance chats, agent listings scope to the active org with a user-scoped backstop for NULL-org rows, and a diagnostic endpoint shows the exact installed_tools list shipped to the harness (with duplicate detection). (`c2023a3`, `811b040`, `553deed`, `38166ab`, `8a085cc`, `23ad8d5`, `a3c2891`, `2b804b5`, `9220e39`)
- Cut CEO chat latency and per-turn work: process-wide ToolRegistry and metadata caches, concurrent persistence + history loading, parallelized org/project lookups, session-resolution shortcut, 5s TTL cache around network agent lookups invalidated by mutations, and a batched settings.json flush so GET /api/agents no longer rewrites disk once per row. (`2af30d7`, `df7667f`)
- Added a Skills workflow on the agent: Create Skill registers with the harness and keeps its user-created marker after the harness overwrites SKILL.md, a "My Skills" section lists user-authored work separately from the shop, skills can be deleted via a proper in-app modal, and section updates are now silent + optimistic instead of flashing the whole pane. (`e9760ea`, `f58b09f`, `9e36512`, `b2d2307`, `e861fc2`, `b9b6db4`)
- Windows auto-update now succeeds: the installer can replace binaries because Aura terminates its sidecar children on update, and the update banner stays opaque and on top of other overlays. Desktop UI also gets a Notes flicker fix on app switches and a retargeting sidekick width that remembers per-app preferences through lazy provider remounts. (`3d4c839`, `712e572`, `7dfafe9`, `2e60bea`, `e01c574`)
- Split the agent tools into a new aura-os-agent-tools peer crate so the runtime no longer pulls the full domain graph, and added per-call capability re-checks, a TTL permissions cache, and an audit ring buffer/tracing target for the cross-agent dispatcher (with an AURA_TOOL_POLICY_MODE=audit safety valve). (`82d1b30`)
- Tightened auth and storage on the way in: sessions are seeded synchronously from localStorage so the first render is authenticated, the local KV store was renamed from RocksStore to SettingsStore with an on-disk migration from db/ to store/, per-user browser/terminal session ownership + project-scoped authz landed, and a new /api/system/workspace_defaults powers an improved folder picker. (`52f9dc5`, `a3dd6a6`, `3b75b94`, `fa25a90`, `1fb31df`)

## 12:36 AM — Release changelog moved to its own workflow

The daily changelog pipeline was extracted from the release workflows and tightened around artifact metadata and updater URLs.

- Published the changelog from a dedicated publish-release-changelog workflow instead of inline in release-nightly/release-stable, deriving the version directly from release artifacts so the two always agree. (`df6cbe0`, `f212d4d`)
- Switched updater manifests to immutable nightly release URLs and hardened the desktop manifest/downloads validators that back them. (`340d9ae`)
- Upgraded the changelog generator to Claude Opus 4.7. (`efe0f24`)

## 1:11 AM — CEO fleet visibility and remote harness callbacks

Two production-grade fixes: the CEO's list_agents now matches the sidebar's org+user merge, and cross-agent tool endpoints read from the same base-URL variable the rest of the server already honors.

- CEO's list_agents tool now mirrors the server's sidebar strategy by concurrently merging org-scoped and user-scoped lookups, so legacy NULL-org agents no longer vanish from the CEO's view (e.g. 15 visible agents instead of 4). (`430ff60`)
- Aligned the integrations control-plane base URL with AURA_SERVER_BASE_URL so remote harnesses on Render stop hitting the loopback fallback when calling cross-agent tools; documented the variable in .env.example and the Render deployment guide. (`f9cbc36`)

## 1:15 AM — Release changelog metadata handoff hardened

Another pass on the release changelog pipeline tightens how version metadata flows between the nightly/stable workflows and the new publish workflow.

- Stabilized how the nightly and stable release workflows hand off version and artifact metadata to the changelog publisher so downstream jobs get a consistent, well-formed payload. (`ac4e3c5`)

## 1:28 AM — No more login flash for authenticated users

Restored a dedicated startup-only auth flag so cached-session users never see the login form for a frame at /login.

- Reintroduced hasResolvedInitialSession on the auth store and gated LoginView on it while leaving RequireAuth keyed off isLoading, so authenticated users still get an instant shell paint but the login form no longer flashes during cold start at /login. (`5de2b45`)

## 1:30 AM — Mobile parity, desktop cold start, and agent self-healing

Mobile project flows reach parity with desktop, a multi-step sequence finally eliminates the desktop login flash by binding window reveal to first paint and durable session storage, and new agents auto-bind to a Home project so their first chat actually persists.

- Brought mobile project flows to parity with desktop: rebuilt MobileOrganizationView, ProjectAgentSetup, ProjectFiles, ProjectTasks, and the mobile shell/topbar, added a runtime capability layer, and backed it with mobile shell, preload-recovery, and e2e regression coverage plus refreshed release docs. (`d3fa7e2`, `b769e19`, `56708c1`, `4d7e4bc`, `1e362e9`)
- Eliminated the desktop boot login flash for good: the auth store is seeded synchronously, the route tree is held until the first restore resolves, /login redirects at the route level for cached sessions, and the desktop window now only becomes visible at React's first committed paint (with the emergency fallback raised to 15s). (`d18b401`, `7ad2133`, `801749e`)
- Made desktop auth restart-safe: the zero-auth session moved from a process-local cache into the JSON-backed SettingsStore, and the Tauri shell now preloads aura-session / aura-jwt into the webview before the bundle runs so reopening the app lands directly in the shell. (`5ece265`)
- New agents created via POST /api/agents now auto-bind to a Home project, so a freshly created agent's first chat persists instead of failing with "target agent is not bound to any project in storage"; existing orphan agents self-heal on their next chat attempt. (`4d3026a`)
- Refused to ship a loopback control-plane URL to a remote harness: session init and diagnostic now emit a named error when the deployment looks remote but AURA_SERVER_BASE_URL is missing, with a boot-time warning (fatal under AURA_STRICT_CONFIG=1) and a shared resolver between server, desktop, and integrations. (`a6a9666`, `8da37ce`)
- Windows desktop polish: release builds use the GUI subsystem so no conhost terminal attaches alongside the webview, and the main webview now starts from about:blank to prevent WebView2 painting stale cached content on launch. (`b767cfc`, `dfe7cc5`)
- Hardened the changelog generator's Anthropic integration: removed the deprecated temperature parameter and added retry handling for transient failures. (`3f9cd0a`, `8de9cb4`)

## Highlights

- Unified Agent model replaces the super-agent path
- Project sidekick gains a real Chromium browser
- Talent Marketplace app shipped end-to-end
- Desktop cold start no longer flashes the login screen
- Release changelog moved to its own hardened workflow

