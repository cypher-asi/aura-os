# A unified agent model, a built-in browser, and a flash-free desktop boot

- Date: `2026-04-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.303.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.303.1

Today's nightly is a heavy one. The long-running super-agent refactor finally lands: there is now a single Agent model gated by explicit AgentPermissions, with the CEO's LLM loop running entirely through the harness. A new in-app browser ships behind a real Chromium/CDP backend, a Talent Marketplace app goes in end-to-end, and a long chain of fixes stabilizes CEO chat — from context bloat and tool-name collisions all the way to unreachable loopback callbacks on remote harnesses. On the desktop side, an entire day of iteration on the startup sequence ends with a flash-free boot, hidden Windows consoles, and auth injected directly from the on-disk store.

## 6:15 PM — Unified agents, an in-app browser, and a marketplace

The main development window delivered a sweeping refactor of the agent runtime, shipped a real embedded browser, introduced the Talent Marketplace, and spent substantial time stabilizing CEO chat under load.

- Collapsed the dedicated super-agent path into a single Agent model whose powers come from a required AgentPermissions bundle, retired the in-process SuperAgentStream, and renamed the crates to aura-os-agent-{runtime,templates,tools} with a policy + audit layer for the cross-agent dispatcher. (`2419f49`, `d147923`, `17855d8`, `aba4546`, `505dfb9`, `6e63a65`, `e100b41`, `9ba6107`, `7fbb3a1`, `926ac39`, `78683e4`, `64f9f81`, `82d1b30`)
- Shipped a projects-sidekick Browser with a real Chromium/CDP backend: interactive input, project-aware initial URL discovery from terminal output, per-user session ownership, auto-discovered executables with isolated temp profiles, and a polished address bar + tabs. (`a50892f`, `c93e583`, `e00e1a0`, `3b75b94`, `350f2c5`, `ff91081`, `7c763d2`, `440e296`)
- Scaffolded the Talent Marketplace app with a backend list endpoint (sort/filter/search), canonical expertise and listing-status modules, a sidebar using the shared OverlayScrollbar, and an Integrations app reshuffle that pulls AI providers into their own group (feature-gated). (`3e18960`, `f93027d`, `ac48a2c`, `889c5db`, `1dca30c`)
- Reworked the bottom taskbar: apps now center on the viewport with favorites on the left, and a new Apps organizer modal (drag-and-drop with @dnd-kit, portaled overlay) lets users hide and reorder taskbar apps. (`011598e`, `73e591c`, `23a5c50`, `c12a77d`, `52a0f6f`, `d4eab9b`)
- Added a first-class Permissions tab with a scope + capability editor, plus a read-only Active Harness Tools diagnostic that surfaces exactly what the server ships to the harness (and flags unregistered tools). (`2c0f977`, `38166ab`)
- Stabilized CEO chat end-to-end: repaired empty CEO permissions and missing Home-project bindings, deduped and absolutized cross-agent tool manifests, stamped JWT/org headers onto dispatcher calls, stripped tool names already served by the aura_node sidecar, and fixed send_to_agent to drain the target's SSE reply and report real persistence status. (`89cce06`, `811b040`, `2b804b5`, `9220e39`, `553deed`, `b9de762`, `fdd2f5e`, `7282f72`, `0798c25`, `64852c2`, `921b6eb`, `ce304a1`, `dd955b7`, `3e14ff1`, `c23075f`, `a5cb01d`, `18da7c3`, `c1dc471`)
- Cut CEO context bloat: list_agents/get_agent now return compact summaries scoped by org, tool blobs in conversation history are truncated with progressive caps on older turns, and the chat UI gained a hoverable context-usage popover showing used vs. total tokens hydrated on chat entry. (`b6f6c99`, `bc47efd`, `5062b53`, `5bfd148`, `da7a0fc`, `cfaf243`, `2af30d7`)
- Built a full Skills workflow: user-created skills now register with the harness on creation, a "My Skills" section distinguishes authored skills from shop-installed ones, deletion uses an in-app confirm modal, and the tab refreshes silently with optimistic row removal. (`e9760ea`, `f58b09f`, `9e36512`, `b2d2307`, `e861fc2`, `b9b6db4`)
- Scoped agent listings to the active org fleet so teammates' agents appear, with a concurrent user-scoped backstop that keeps caller-owned NULL-org agents visible, plus a backfill script to stamp legacy records. (`8a085cc`, `23ad8d5`, `a3c2891`)
- Hardened Desktop Windows updates: the update banner now paints on an opaque surface above every overlay, and a new shutdown hook stops the aura-node sidecar and dev server so the NSIS installer can replace binaries without file-lock conflicts. (`3d4c839`)
- Added a local workspace folder override for projects and agents (with a FolderPickerField and a new /api/system/workspace_defaults endpoint showing the resolved default path), and renamed the on-disk store directory from db/ to store/ with a one-shot migration. (`1fb31df`, `fa25a90`, `a3dd6a6`)
- Numerous agent-sidebar reliability fixes: auth token seeded synchronously from localStorage, blank agent names repaired on every read path and on IndexedDB hydration, last-message preview restored on load with stable row height, and batched shadow writes so listing N agents no longer rewrites settings.json N times. (`67aed23`, `fad98d5`, `dbb62e5`, `8dc6a31`, `c2023a3`, `df7667f`, `52f9dc5`)
- Performance pass on CEO-preset chat setup: cached ToolRegistry and tool metadata in LazyLocks, parallelized project/agent lookups with tokio::join!, added a short-lived list_agents cache, and dropped the per-session liveness probe from session resolution. (`2af30d7`)
- Shell polish: sidekick width is now remembered per-app with lazy-remount-safe retargeting, notes no longer flicker on app switches, and the desktop window waits for React to be ready before showing. (`7dfafe9`, `2e60bea`, `712e572`, `e01c574`)

## 12:36 AM — Release infrastructure: dedicated changelog workflow and immutable updater URLs

Release publishing moved into its own GitHub Actions workflow with hardened metadata and updater manifests that point at immutable nightly artifacts.

- Split changelog publishing out of the nightly and stable release workflows into a dedicated publish-release-changelog workflow, deriving the version directly from release artifacts. (`df6cbe0`, `f212d4d`)
- Switched the nightly updater manifests to use immutable release URLs, with new validators for desktop downloads and manifests. (`340d9ae`)
- Upgraded the changelog generator to Claude Opus 4.7. (`efe0f24`)

## 1:11 AM — CEO fleet visibility and remote-harness config alignment

Two targeted fixes made the CEO see its full fleet and aligned the control-plane base URL with the server's public URL for remote harnesses.

- The CEO's list_agents LLM tool now merges org-scoped and user-scoped lookups the same way the sidebar does, so legacy agents with a NULL org_id no longer disappear from the CEO's view. (`430ff60`)
- control_plane_api_base_url() now reads AURA_SERVER_BASE_URL, matching how the server resolves its own public URL; this fixes "external tool callback unreachable" errors on remote harnesses that were being sent loopback addresses. (`f9cbc36`)

## 1:15 AM — Release changelog metadata handoff hardening

A follow-up to the new changelog workflow tightened how release metadata is passed between jobs.

- Hardened the metadata handoff between the nightly/stable release workflows and the new publish-release-changelog workflow. (`ac4e3c5`)

## 1:28 AM — Stop the login panel from flashing at startup

Reintroduced the hasResolvedInitialSession gate so authenticated users never see the login form for a frame on cold start.

- LoginView is now gated on a dedicated startup-only hasResolvedInitialSession flag (restored from an earlier fix), and signalDesktopReady is delayed from the login route until the first restoreSession resolves — so a persisted /login URL no longer flashes the form before redirect. (`5de2b45`)

## 1:30 AM — Mobile parity, a flash-free desktop boot, and remote-harness safety

A focused late-night run delivered mobile remote parity flows, ended the desktop cold-start login flash after several iterations, hid the Windows console, and added guardrails against shipping loopback URLs to remote harnesses.

- Rolled out mobile remote-parity flows across Feed, Projects, Agent editor, and the mobile shell, with accompanying runtime + regression coverage and refreshed release-gate documentation. (`d3fa7e2`, `b769e19`, `56708c1`, `4d7e4bc`, `1e362e9`)
- Ended the desktop startup login flash through a sequence of fixes: route-level /login redirect, holding the whole route tree until auth resolved, injecting boot-auth from the on-disk SettingsStore directly into the webview as window.__AURA_BOOT_AUTH__, tying window reveal to React's first committed paint, and preloading the initial shell app before the window is shown. (`d18b401`, `7ad2133`, `801749e`, `5ece265`, `e4f4165`, `28df9cc`, `b79cae9`)
- Windows desktop no longer opens a conhost terminal next to the app in release builds, and the bundled aura-node sidecar now launches with CREATE_NO_WINDOW with output redirected to a log file. The main webview also starts from about:blank to avoid painting stale cached content on cold start. (`b767cfc`, `e5b5c37`, `dfe7cc5`)
- New agents created via POST /api/agents are now automatically bound to a Home project on creation (and lazily repaired on first chat), so first-turn chat no longer fails with "not bound to any project in storage". (`4d3026a`)
- Remote harness deployments now refuse to stamp loopback control-plane URLs onto cross-agent tool endpoints, warn at boot (or fatally under AURA_STRICT_CONFIG=1), and the desktop server writes its bound port back into the env so loopback tool callbacks reach the real listener. (`a6a9666`, `8da37ce`, `537b800`)
- Hardened the Anthropic retry path in the changelog generator and dropped the deprecated temperature parameter. (`3f9cd0a`, `8de9cb4`)

## Highlights

- Unified Agent model with required AgentPermissions replaces the super-agent path
- In-app Chromium browser ships in the projects sidekick
- Talent Marketplace app lands end-to-end
- CEO chat: tool dispatch, context usage, and cross-agent messaging hardened
- Desktop cold start is finally flash-free on Windows and macOS
- Release changelog publishing moves to its own hardened workflow

