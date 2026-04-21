# Agent permissions overhaul, in-app upgrades, and nightly pipeline hardening

- Date: `2026-04-20`
- Channel: `nightly`
- Version: `0.1.0-nightly.315.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.315.1

A dense nightly that reworks how agent capabilities flow from UI toggles to live tool sessions, adds a proper in-app update control for desktop users, and shores up the nightly release pipeline across Android, macOS packaging, version numbering, and the updater sidecar. Chat opens also get noticeably faster on cold boot and reload.

## 9:29 PM — Agent capabilities, skills, and chat startup get a major rework

A broad late-night push unified the agent tool registry, fixed long-standing permission toggle bugs, added an in-app upgrade control, and cut cold-boot latency for chat.

- Rebuilt the agent tool registry around a single capability-aware pipeline: every tool now declares an Always/OnDemand surface, CEO and non-CEO bundles flow through the same permission filter, and saving a capability change invalidates live chat sessions (direct and project-instance) plus the dispatcher permissions cache so toggles take effect on the next turn without a server restart. Also restored missing CEO tools like list_agents, send_to_agent, and list_agent_instances. (`2a7ac33`, `76b34a6`)
- Closed three separate paths where permission edits silently reverted: project-instance chats now read fresh parent capabilities at cold-start instead of a stale snapshot, update_agent trusts the submitted bundle when aura-network omits permissions in its PUT echo, and GET /agents no longer clobbers the local shadow when the network response drops the permissions column. (`9f9784b`, `5c5c565`)
- Replaced the Save/Discard bar in the Permissions sidekick with debounced autosave and an inline status pill (Saving… / Saved / Save failed + Retry), and restyled the capability toggles with a high-contrast track so on/off state reads clearly against the dark panel. (`7f67bdf`, `76b34a6`)
- Hardened the Delete skill flow: the server now refuses with 409 when a user-authored skill is still installed on any agent and returns the blocking {agent_id, name} list for inline display in the confirm modal, and the catalog proxy hides entries whose SKILL.md no longer exists on disk so deleted skills stop reappearing under Available. (`73b0ecb`)
- Shipped an in-app upgrade control on desktop: a new block under Settings > Version (and mirrored into Team Settings > General > About) surfaces latest-version state, check-for-updates, install, and download/install/failure states, with a 'managed by the server' fallback on the web. (`267eb96`, `6b6910c`, `d2bc9a8`, `969a9a9`, `823c16d`)
- Cut cold-boot latency for chat: history now hydrates instantly from an IndexedDB cache while the network revalidates, the /agents index skips a lazy chunk fetch and agent-list gate by redirecting off the cached last agent id, and the sidebar preview prefetch yields to the foreground chat via requestIdleCallback with lower concurrency. (`588bdf3`, `6f149de`, `2b05176`)
- Reduced server-side chat open cost: per-session event reads now fan out in parallel batches and stop as soon as the limit+offset window is filled, and the orgs→projects→project_agents discovery behind every chat turn is cached for 30s per (jwt, agent_id) with targeted invalidation on auto-bind. (`1e7986c`, `3cfc04d`)

## 11:23 PM — Android release jobs preflight their signing secrets

The ship-android and nightly mobile jobs now fail fast with an actionable error when Play Store or signing secrets are missing, instead of dying deep inside fastlane.

- Added a preflight that checks every required secret for the selected lane in one pass and wired it into both android-mobile.yml and release-mobile-nightly.yml, so signed-build and Play Store paths surface all missing variables up front rather than one-at-a-time fastlane errors. (`2cce560`)

## 10:57 AM — Transient macOS and Linux packaging failures now auto-retry

Desktop packaging across nightly, stable, and validate workflows retries known transient failures up to three times, with stale DMG mounts cleaned up between attempts.

- Replaced the single-shot retry with a three-attempt loop across desktop-validate, release-nightly, and release-stable that matches hdiutil 'Resource busy' on macOS and 429/5xx AppRun download errors on Linux, and extracted the stale-DMG cleanup into a shared script that runs between retries. (`66ff7e7`)

## 3:18 PM — Kimi K2.6 joins the chat model picker

The chat input bar's model list now includes Kimi K2.6 alongside the existing Claude, GPT, and Codex options.

- Added Kimi K2.6 to the default model constants and updated ChatInputBar so it shows up in the quick picker; the bundled model ids were also normalized to the aura-* prefix used throughout the app. (`1ddd779`)

## 6:48 PM — Nightly version numbers stay stable across rerun attempts

Nightly build, package, and Android jobs now share a single resolved version so rerunning a failed attempt no longer produces mismatched artifact versions.

- Hoisted nightly version resolution into a dedicated resolve-version job consumed by build-app, package, and package-android-apk, dropping the per-job run_attempt suffix that caused reruns to mint new versions, and added a validate-release-artifact-versions script to catch drift between produced artifacts. (`6b038cb`)

## 7:34 PM — Desktop updater stages its sidecar outside the install tree

The desktop app now copies the bundled harness binary into a versioned staging directory under the user data folder before launching it, and routes install-update requests through the main event loop.

- Bundled harness binaries are staged into <data_dir>/runtime/sidecar under a content-addressed name derived from size, mtime, and package version, so the updater can replace the install tree without the running sidecar holding files open. The /update/install HTTP route now dispatches a UserEvent::InstallUpdate through the event loop proxy instead of calling into the updater inline. (`1b37b3c`)

## Highlights

- Unified, autosaving agent permissions that take effect without a restart
- In-app upgrade control in Settings and Team Settings
- Faster cold chat opens with IDB-cached history and cached project discovery
- Kimi K2.6 available in the chat model picker
- More resilient nightly packaging, versioning, and desktop updater staging

