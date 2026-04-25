# Harness consolidation, autonomous recovery, and a refreshed desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.387.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.387.1

A heavy day for Aura: the autonomous dev loop got smarter at distinguishing transient provider blips from real failures, the desktop shell was reshaped into floating glass panels, and a major refactor migrated agent execution onto a single harness-based runtime. Operator runbooks, in-app error pages, and updater packaging also got safer.

## 8:52 AM — Resilient sync milestones and lighter tree typography

Push and commit progress now survive reloads instead of looking like full task failures, and nested rows in the left menu and sidekick read with clearer hierarchy.

- Task sync milestones, commit SHAs, and push-failure context now persist across restarts so locally completed work is shown as a remote sync issue rather than a terminal task failure, with structured harness milestone events normalized into the existing git event contract. (`68be945`, `a69f2e3`)
- Lightened child-row font weight in the left menu tree and the sidekick so nested items visibly defer to their parents. (`2b608a7`, `d973798`)

## 9:46 AM — Black drag-resize fill on Windows desktop

Switched the main window background brush so live drag-resize no longer flashes white before the WebView catches up.

- On Windows, the main window class now paints with BLACK_BRUSH instead of NULL_BRUSH so the brief sliver exposed during drag-resize blends into the dark theme rather than flashing white. (`c1aad81`)

## 10:19 AM — Autonomous dev loop hardening, harness consolidation, and a glass desktop shell

The bulk of the day: a deep pass on dev-loop reliability and recovery, a sweeping migration onto a single aura_harness runtime, a refreshed floating desktop layout, and many UI fixes around streaming, retries, and chat continuity.

- Definition-of-Done gate gained five guardrails: empty-path writes are rejected, workspaces are preflighted before runs, rollbacks emit a dedicated git_commit_rolled_back event with strike-through UI, and recovered empty-path misfires are now accepted when a real-path write actually lands. Tool events also drive files_changed inference so verified runs aren't falsely rejected. (`a8e3e72`, `f1c9dce`, `a2c218d`, `87e929c`)
- Transient provider failures now have a real recovery ladder: 5xx, stream-terminated, and rate-limited errors classify as ProviderInternalError, project cooldowns escalate per failure class with ±20% jitter, single-task retry budget rose to 3, and completion-gate failures route through the same infra retry path with a stateful resume preamble ("[aura-retry attempt=N]") on retried turns. (`9cb0c6a`, `7150cd3`, `8e75d47`, `373be42`, `88fa94e`, `e94aa54`)
- Per-tool-call retries are now first-class: the harness's tool_call_retrying / tool_call_failed events drive a server-side budget of 8 and surface a live "Writing retrying (n/8)…" header on tool cards instead of a stuck "Writing code…" during upstream storms. (`f474edc`, `4424201`)
- A new pure reconciler decides recovery actions (adopt run, retry push, retry task, decompose, mark terminal) and is exposed on the task output API as a recommended_action field so the UI can render "retrying push", "provider throttling", etc. without guessing. (`d09c166`, `c0e7121`)
- Task status is now decoupled from git push outcome: pushes that fail emit push_deferred plus a project_push_stuck banner once a streak hits the threshold, an Orbit ENOSPC guard trips a 15-minute cooldown with an amber "Orbit out of disk" indicator, and a remote-push-recovery runbook documents the operator workflow. (`73ab86f`, `f4425e2`, `fc08c18`, `5badbea`)
- Task state machine unified with aura-storage via a single safe_transition helper; ready→failed is now bridged through in_progress, retry is idempotent on ready, and flat /api/tasks/:id and /api/specs/:id routes match what the harness's HttpDomainApi calls. (`bde1254`, `ef50887`, `3809aeb`)
- DoD gate gets a language-neutral retry tier with a capped budget for missing build/test/fmt/lint axes, while kernel-policy denials (run_command, allow_shell, binary_allowlist) short-circuit to a precise diagnostic that names the exact env knobs operators need to flip. (`70623bd`, `3bdb2b4`, `71304ce`, `5760d25`)
- Stuck-agent loops are now caught: the harness's anti-waste "appears stuck / stopping to prevent waste" terminal signal stops the tight reconnect loop instead of triggering endless WS restarts. (`4c01759`)
- Harness WS reader is now an RAII handle that's aborted on every retry / adopt / stop, ending the slow leak that filled the 128-slot ws_slots cap and caused 503 "WS connection cap reached" responses. (`ee5d955`)
- Major server consolidation: the legacy agent_tools dispatcher (~13k lines), aura-os-link compatibility layer, and standalone aura-os-process scheduler are gone, replaced by a new aura-os-harness adapter crate that runs every chat turn, dev loop, and scheduled process as a harness automaton through a single bridge. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `00d095e`, `71d1821`, `c1e87fb`, `2dd8391`, `f39dc74`, `c6174bb`)
- External CLI adapter pathway (claude_code, codex, gemini_cli, opencode, cursor) was removed end-to-end across runtime, UI, evals, and docs; aura_harness is now the only supported runtime, and the harness becomes authoritative for task DoD with aura-os keeping verification evidence for display only. (`b43e4b8`, `49a1d45`)
- New aura-os-events and aura-os-loops crates introduce a topic-scoped EventHub and LoopRegistry so concurrent chat, automation, task, process, and spec loops are tracked per (user, project, agent_instance, agent, kind, instance) instead of bleeding through one global broadcast; a GET /api/loops snapshot and a single LoopProgress component render consistent activity across agent rows, sidekick tabs, and task explorer rows. (`9860141`, `26ed693`, `82f93b3`, `ac52a80`)
- Run pane and Task Overlay no longer blink scroll: replaced the MutationObserver/RAF/scrollIntoView dance with overflow-anchor + a synchronous useLayoutEffect, killed a stray border under the cooking indicator, and reconciled stale "active" rows so each project shows only one cooking indicator. (`0244c85`, `3089289`, `2509b9c`, `bf02505`, `206097d`)
- Failure context surfaces clearly in the Run pane: abandoned pending tool cards resolve to "Interrupted by upstream error" on retry, errored file cards show action-specific titles instead of "Untitled file", and task failureReason plus completion-gate-rejected cards render in the panel. (`d131349`)
- Desktop shell rebuilt around floating glass: the bottom taskbar splits into three capsules, the topbar and main content gain rounded corners and 5px insets, sidebar/sidekick separators become transparent gaps, and corner radii are unified at 20px with a tighter panel layout. (`065b565`, `d0bd776`, `de67ed6`, `8d8225f`, `3ace217`, `07c6832`, `b1c6453`, `8494863`, `21373eb`, `b995cb2`, `eeba9fc`, `8fc9dbd`, `4474f6c`, `bce7a34`, `2251b35`, `fece144`, `5019432`, `e0b2735`, `4f67df1`)
- Browser surface improvements: in-app Aura-branded error overlay on main-frame load failures, address bar restyled as a flat pill with a site-info icon and star, and unresolved input is now searched on DuckDuckGo instead of being silently dropped. (`bd92f08`, `7837adb`, `1c155de`)
- Cross-platform desktop input fixes: a native Cocoa app menu wires Cmd+C/V/X/A/Z to the WebView on macOS, and the custom titlebar is now draggable on macOS/Linux via tao::drag_window since WebKit ignores -webkit-app-region. (`cc3193a`, `c2294d3`)
- Desktop sidecar boot is more honest about policy: --external-harness now requires LOCAL_HARNESS_URL with a /health probe, the bundled harness ships an explicit AURA_ALLOWED_COMMANDS allow-list now that empty no longer means permissive, and the README plus eval stack document AURA_ALLOW_SHELL=1 alongside the new knobs. (`ed55e37`, `a41c273`, `f1f4735`, `76d8a05`, `abfb6d1`, `71304ce`, `d29f248`)
- Project-bound chat sessions stop spuriously denying tools: agents auto-splice ReadProject/WriteProject self-caps when entering a project, X-Aura-Project-Id is stamped on every cross-agent tool call so the dispatcher injects project_id deterministically, and project_id is dropped from required schemas. Capable tools also ship by default rather than waiting for a load_domain_tools handshake. (`c477313`, `8d0d715`, `b6a066e`, `def464a`, `13acee2`, `6efa695`)
- Mid-turn chat state now survives a page refresh: server emits throttled assistant_turn_progress with an in_flight flag, the client rebuilds partial assistant turns and pending sidekick placeholders, and the sidekick preview selection persists in a ?preview= URL param. End-of-stream rendering also stops dropping tool-only turns, racing history fetches, and orphaning optimistic user bubbles. (`6021e18`, `2bb8f04`, `4c671f1`, `07bbdc3`)
- Tool input rendering normalizes provider/UI payloads so stringified JSON no longer renders as character-indexed objects, textual [tool: …] markers expand into proper Block renderers in both live streams and historical task overlays, and credit exhaustion now classifies as terminal so automation stops immediately. (`ad52832`, `cc71745`, `cc4781d`, `95cd075`, `5fe6976`)
- Quality-of-life chat features: copy buttons with cross-OS clipboard fallback on file/spec/text bubbles, inline rename of project agents from the sidebar context menu (and via F2), and stripped emojis from sidebar last-message previews. (`55eb3c7`, `efa2c79`, `5bc8ad9`)
- Smaller reliability and polish: GroupCollapsible no longer nests buttons (fixing hydration warnings on copy controls), queue z-index now sits above the cooking indicator, the LoopProgress spinner keeps rotating in determinate mode, the composer hides until chat history resolves to avoid an empty-agent flash, and live tool-approval message types were added to the protocol. (`6e9126b`, `12f5d68`, `ac52a80`, `07bbdc3`, `53b2c16`, `3636203`, `61eb586`, `09b8424`, `c2b82af`)

## 11:17 PM — Desktop sidecar build resolves aura-node by package

Fixed the release packaging script that was failing to find aura-node when building the desktop sidecar.

- prepare-desktop-sidecar.mjs now scopes the cargo build to the aura-runtime package with `-p aura-runtime --bin aura-node`, since `--bin aura-node` alone only resolves against default-run packages and was failing the harness sidecar build. (`cb4e6a1`, `4da6c8c`)

## 11:55 PM — Reverted accidental hooks directory move

A CI retrigger commit unintentionally moved interface hooks into a shared/ directory without updating imports; the move was reverted to restore main.

- Reverted the workflow-retrigger commit that had relocated interface/src/hooks/* into interface/src/shared/hooks/ without updating import sites, breaking main. (`2320faf`, `08ec42c`)

## 10:36 AM — Updater sidecar contract validation and changelog media gates

Release pipelines gained explicit validation that the updater sidecar package contract is intact, and the changelog media workflow learned to skip and gate captures more reliably.

- Desktop builds now validate the updater sidecar package contract through a new verify-desktop CI step wired into nightly and stable release workflows, with matching updater and build-script checks. (`63d4c89`)
- Hardened the publish-release-changelog-media workflow with stricter skip and capture gates and proportional high-res media scaling, so changelog screenshots fall back cleanly when prerequisites aren't met. (`ee70b4b`)

## Highlights

- Autonomous dev loop now retries transient provider errors, jitters cooldowns, and recovers cleanly from stuck pushes
- Desktop shell reworked into floating capsules with rounded glass panels and consistent insets
- Single-runtime overhaul: legacy agent tool dispatcher, link layer, and external CLI adapters retired in favor of aura_harness
- New per-loop event hub keeps concurrent chat, automation, and task work cleanly isolated
- Desktop fixes: black drag-resize fill on Windows, working Cmd+C/V/X/A/Z on macOS, draggable titlebar on macOS/Linux

