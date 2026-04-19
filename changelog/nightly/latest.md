# Unified agents, harness-hosted CEOs, and a Talent Marketplace

- Date: `2026-04-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.304.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.304.1

A heavy day across the stack: the super-agent system was collapsed into a single permissions-driven Agent model running through the harness, a full in-app headless browser and Talent Marketplace shipped, the CEO chat pipeline was rebuilt around real cross-agent tools, and a long desktop boot-flash investigation finally ended with auth bootstrapped from the on-disk store. Release tooling also moved to a dedicated workflow.

## 6:15 PM — Agents unified under a permissions-driven model with harness-hosted CEOs

The dedicated super-agent stack was dismantled and replaced with a single Agent type whose CEO behavior comes entirely from an AgentPermissions bundle, plus a Chromium-backed browser sidekick, a Talent Marketplace, and a long tail of CEO chat fixes.

- Collapsed the super-agent path into one Agent model: every agent now carries required AgentPermissions, CEO status is derived from the ceo_preset bundle, and chat dispatch, tool gating, and the UI all route through the same harness path. The legacy in-process SuperAgentStream, host-mode toggles, migration scaffolding, and the aura-os-super-agent crates were retired in favor of aura-os-agent-{runtime,templates,tools}. (`d147923`, `17855d8`, `aba4546`, `505dfb9`, `e100b41`, `7fbb3a1`, `926ac39`, `78683e4`, `82d1b30`)
- Added a new projects-sidekick Browser with a pluggable backend, shipping a Chromium CDP implementation that streams screencast frames, drives real input, auto-discovers Chrome/Edge executables, isolates temp profiles, and scopes sessions per owner with project-level authz. The address bar now normalizes bare hostnames, wheel deltas are no longer inverted, and tabs render as valid sibling buttons. (`a50892f`, `c93e583`, `e00e1a0`, `3b75b94`, `350f2c5`, `ff91081`, `7c763d2`, `440e296`)
- Shipped the first end-to-end slice of the Agent Talent Marketplace: a new top-level app with sort, filter, and hire flows, a GET /api/marketplace/agents endpoint, typed listing_status + expertise fields on Agent, a backfill script, and a migration doc. The sidebar was later brought in line with other apps via the shared OverlayScrollbar. (`3e18960`, `f93027d`)
- Overhauled the CEO chat pipeline so cross-agent tools actually work: real descriptions and JSON schemas are shipped to the harness, endpoints are absolutized against AURA_SERVER_BASE_URL, JWT + org id are stamped on outgoing tools, installed_tools are centrally deduped (with logging) and harness-native/FS names stripped, send_to_agent was realigned to the harness contract and now drains the target's SSE reply with budgets, and CEO-preset turns got aggressive latency and context trimming. (`38166ab`, `9220e39`, `b9de762`, `fdd2f5e`, `7282f72`, `0798c25`, `64852c2`, `921b6eb`, `ce304a1`, `2af30d7`, `b6f6c99`, `bc47efd`, `18da7c3`)
- Made cross-agent messaging reliable: send_to_agent now reports persistence status via response headers and hard-fails on persist errors instead of confabulating success, the CEO gets an auto-created Home project so direct chats persist, empty CEO permissions are repaired on read and instance-chat paths, new agents auto-bind to a home project, and chat panels live-refresh via org-level agent ids. (`89cce06`, `811b040`, `2b804b5`, `553deed`, `dd955b7`, `c23075f`, `a5cb01d`, `3e14ff1`, `a3c2891`)
- Added a Permissions sidekick tab with scope and per-capability editing, an Active harness tools diagnostic that surfaces unregistered tool names, org-scoped agent listing so teammates' fleets appear, and a consolidated agent editor modal with a new System Prompt field and tooltip-driven option cards. (`2c0f977`, `38166ab`, `8a085cc`, `23ad8d5`, `91af267`, `8f31b22`)
- Introduced a user-authored skills workflow: Create Skill now registers with the harness (preserving the My Skills marker after harness overwrites), a My Skills section lists user-authored entries, and delete is handled via an in-app confirm modal with optimistic removal and silent refresh. (`e9760ea`, `f58b09f`, `9e36512`, `b2d2307`, `e861fc2`, `b9b6db4`)
- Tightened the shell and agent sidebar: a taskbar Apps organizer modal with drag-and-drop visibility and ordering, per-app persisted sidekick widths with lazy-provider-safe retargeting, stable last-message previews in the agents sidebar, a hoverable context-usage popover showing used/total tokens, and a dedicated Integrations app with grouped providers. (`23a5c50`, `c12a77d`, `52a0f6f`, `7dfafe9`, `2e60bea`, `c2023a3`, `da7a0fc`, `cfaf243`, `ac48a2c`, `889c5db`)
- Fixed the Windows auto-update failure caused by sidecar processes holding install-directory locks by adding a ShutdownForUpdate event that stops children before install_and_restart, and restored the update banner's opacity and stacking. (`3d4c839`)
- Added per-project/agent local workspace folder overrides with a FolderPickerField that shows the resolved default from a new /api/system/workspace_defaults endpoint, plus a one-time migration from db/ to store/ and a SettingsStore rename that drops the vestigial RocksDB terminology. (`1fb31df`, `fa25a90`, `a3dd6a6`)

## 12:36 AM — Release changelog publishing moved to its own workflow

Release infrastructure was split so changelog generation runs independently of the nightly/stable release jobs, with version derived from artifacts and updater manifests pinned to immutable URLs.

- Extracted changelog publishing into a dedicated publish-release-changelog workflow called from nightly and stable releases, and moved generation to Claude Opus 4.7. (`df6cbe0`, `efe0f24`)
- Derived the changelog version directly from release artifacts and rewrote updater manifests to reference immutable nightly release URLs, with validation scripts updated to match. (`f212d4d`, `340d9ae`)

## 1:11 AM — CEO list_agents and control-plane URL fixes for remote harnesses

Two targeted server-side fixes restored agent visibility and cross-agent callbacks on deployed harnesses.

- The CEO's list_agents tool now merges org-scoped and user-scoped lookups (mirroring the sidebar fix) so legacy NULL-org agents are no longer hidden from the LLM. (`430ff60`)
- Aligned the integrations control-plane base URL with AURA_SERVER_BASE_URL so remote harnesses (e.g. aura-swarm on Render) stop stamping 127.0.0.1 into cross-agent tool endpoints, with env docs and a troubleshooting note added. (`f9cbc36`)

## 1:15 AM — Release changelog metadata handoff hardened

Follow-up to the workflow split that tightens how nightly and stable releases pass changelog metadata into the publish step.

- Hardened the metadata handoff between release-nightly, release-stable, and publish-release-changelog so the changelog job receives a well-formed version, channel, and artifact set. (`ac4e3c5`)

## 1:28 AM — Desktop boot flash eliminated and mobile parity flows landed

A multi-step investigation into the cold-start login flash ended by injecting auth from the on-disk store and tying window reveal to first paint, alongside new mobile shell flows and a second changelog-generator reliability pass.

- Ended the desktop login-screen boot flash by writing the cached session into the durable SettingsStore, injecting window.__AURA_BOOT_AUTH__ from Rust before any page scripts run, preloading the initial shell app's lazy module, and gating signalDesktopReady on React's first committed paint (with the fallback timer stretched to 15s). Intermediate iterations added a hasResolvedInitialSession flag, route-level /login redirects, and an explicit isLoggedInSync primitive before the on-disk injection landed. (`5de2b45`, `d18b401`, `7ad2133`, `801749e`, `5ece265`, `e4f4165`, `28df9cc`, `b79cae9`)
- Cleaned up other Windows and WebView2 boot artifacts: release builds now use the GUI subsystem so no conhost terminal appears, the bundled aura-node sidecar spawns with CREATE_NO_WINDOW and logs to a file, and the main webview starts at about:blank so stale cached /login pages never flash. (`b767cfc`, `e5b5c37`, `dfe7cc5`)
- Fixed loopback callback failures by syncing the bound server port into the process env and refusing to ship loopback URLs to remote harnesses (with a strict-config warning), plus centralized resolution of the local server base URL behind the shared aura-os-integrations helper. (`537b800`, `a6a9666`, `8da37ce`)
- Generalized the CEO-only Home project bootstrap into a shared helper so every newly created agent auto-binds to a Home project on creation, with a lazy self-heal on first chat for existing orphan agents. (`4d3026a`)
- Landed mobile remote-parity flows across feed, projects, agent editor, and the mobile shell, backed by new regression coverage (MobileShell, AgentEditorForm, preload-recovery, service-worker registration) and refreshed mobile release docs and visual audits. (`d3fa7e2`, `b769e19`, `56708c1`, `4d7e4bc`, `1e362e9`)
- Hardened the daily changelog generator by removing the deprecated Anthropic temperature parameter and improving retry handling. (`3f9cd0a`, `8de9cb4`)

## 10:53 AM — Changelog titles and summaries made more specific

A small editorial pass on the changelog generator to push it toward more concrete, less templated output.

- Tightened changelog title and summary specificity in the release generator script. (`eac0e7a`)

## Highlights

- Single Agent model with required permissions replaces the super-agent path
- Headless browser sidekick with Chromium CDP backend
- Agent Talent Marketplace app scaffolded end-to-end
- CEO chat rewired: real tool schemas, dedupe, auth stamping, context slimming
- Desktop boot flash eliminated via Rust-injected auth and first-paint window reveal
- Release changelog publishing moved to its own hardened workflow

