# Agent permissions overhaul, in-app upgrades, and nightly release hardening

- Date: `2026-04-20`
- Channel: `nightly`
- Version: `0.1.0-nightly.314.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.314.1

A dense nightly that reshapes how agent capabilities and tools flow through sessions, lands a first-class in-app upgrade control on desktop, speeds up the chat cold-boot path, and tightens the nightly release pipeline against flaky packaging and version drift.

## 9:29 PM — Agent tool registry unified and in-app upgrade control lands

A major agent-permissions rework pairs with the first iteration of a desktop update control in Settings, plus a safer skill-delete flow and faster chat history loads.

- Replaced the tier-1/tier-2 + CEO short-circuit model with a single capability-aware tool registry: every tool now declares a Surface, CEO gets ReadAllProjects/WriteAllProjects wildcards, and toggling capabilities invalidates live sessions so list_agents, send_to_agent, and list_agent_instances actually show up without a server restart. (`2a7ac33`, `76b34a6`, `9f9784b`)
- Delete Skill now refuses with a 409 and an inline blocker list when the skill is still installed on other agents, and the catalog hides stale entries whose SKILL.md is gone so deleted skills stop reappearing under Available. (`73b0ecb`)
- Added an update status block in Settings so desktop users can see their version, check for updates, install available ones, and track download/install/failure states, with a graceful 'managed by the server' fallback on web — then promoted the control into a shared component used by both Settings and Team Settings > General. (`267eb96`, `6b6910c`, `d2bc9a8`, `969a9a9`, `823c16d`)
- Opening chats with long histories no longer pays O(lifetime events) of storage reads: session events now fan out in parallel batches of four and stop as soon as the requested window is filled. (`1e7986c`)

## 10:54 PM — Autosaving permissions and a faster chat cold boot

Permissions toggles now persist automatically, chat history survives reloads via IndexedDB, and the /agents route stops blocking first paint on network round-trips.

- The Permissions tab drops the Save/Discard bar in favor of debounced autosave with an inline status pill (Saving…/Saved/Save failed + Retry), flushing pending edits on unmount so nothing is lost when switching agents. (`7f67bdf`)
- Closed the last regressions where capability toggles silently reverted: the server now reads fresh parent caps per instance chat turn, guards against empty permissions echoes on PUT, and preserves the local shadow bundle when aura-network drops the permissions column on GET. (`5c5c565`)
- Chat history is now cached to IndexedDB so reloads paint instantly from the last successful fetch while revalidation runs in the background, with a graceful localStorage fallback in private browsing. (`588bdf3`)
- Trimmed cold-boot waterfalls on /agents: project-agent discovery gets a 30s TTL cache, sidebar preview prefetch is deprioritized behind the active chat and scheduled via requestIdleCallback, and the AgentChatView lazy import and agents-list gate are gone. (`3cfc04d`, `2b05176`, `6f149de`)

## 11:23 PM — Android release jobs fail fast on missing secrets

The ship-android and nightly Android jobs now preflight every required fastlane secret for the selected lane in one pass.

- Added a preflight check to android-mobile.yml and release-mobile-nightly.yml that surfaces every missing Android release secret up front with an actionable error, instead of dying deep inside fastlane one variable at a time. (`2cce560`)

## 10:57 AM — Desktop packaging auto-retries transient failures

Nightly, stable, and desktop-validate workflows now retry flaky macOS and Linux packaging errors instead of failing the whole run.

- Packaging now retries up to three times on known-transient failures — hdiutil 'Resource busy' on macOS and 429/5xx AppRun download errors on Linux — and the stale-DMG cleanup logic moved into a shared script reused between validate, nightly, and stable release workflows. (`66ff7e7`)

## 3:18 PM — Kimi K2.6 added to the chat model picker

The chat input bar gains a new model option and the model id namespace is cleaned up.

- Kimi K2.6 is now selectable from the chat model dropdown, and built-in model ids were normalized under the 'aura-' prefix in the models catalog. (`1ddd779`)

## 6:48 PM — Nightly version resolution hardened for reruns

Nightly artifact versioning no longer drifts across jobs or between first runs and reruns.

- A new resolve-version job computes the nightly version once and feeds it to build-app, package, and the Android APK job, replacing the per-job version computation that mixed run_number with run_attempt and could produce mismatched artifacts on reruns. (`6b038cb`)
- Added a validate-release-artifact-versions script so mismatched versions across the packaged artifact set fail the release explicitly instead of shipping silently. (`6b038cb`)

## Highlights

- Unified capability-aware tool registry fixes stale agent permissions
- In-app update control lands in Settings and Team Settings
- Chat cold boot gets IndexedDB cache and parallel history reads
- Nightly desktop packaging retries transient failures and stabilizes versioning
- Kimi K2.6 joins the chat model picker

