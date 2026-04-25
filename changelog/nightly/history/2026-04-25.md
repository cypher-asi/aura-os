# Harness consolidation, autonomous loop reliability, and a polished desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.386.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.386.1

A heavy day for Aura's autonomy stack: the dev loop was hardened against transient provider errors, push failures, and policy denials, then largely refactored to delegate work to the new harness automatons. The desktop shell got a coordinated visual pass with floating capsules and rounded panels, and the chat surface gained richer retry, recovery, and error-state handling. Release tooling also got a real fix after the harness/aura-node crate move.

## 8:52 AM — Durable sync checkpoints for the dev loop

Sync milestones now persist across push timeouts and reloads so locally completed work survives restarts, with light typographic polish to the left menu and Sidekick.

- Dev-loop sync milestones and task sync state are now persisted as durable checkpoints, so a push timeout or restart resumes from the last commit/push milestone instead of treating repo sync as opaque task output and surfacing a misleading task failure. (`68be945`, `a69f2e3`)
- Lightened child-row font weight in the left menu tree and Sidekick so nested items read as clearly subordinate to their parents. (`2b608a7`, `d973798`)

## 9:46 AM — Black drag-resize fill on Windows desktop

The Windows desktop window now flashes black instead of white during live drag-resize, blending into Aura's dark theme.

- Switched the main window class background brush back to BLACK_BRUSH so newly exposed client area during drag-resize fills with black, matching the WebView2 background and avoiding a jarring white flash on Windows. (`c1aad81`)

## 10:19 AM — Autonomous dev loop hardening and the harness migration

A long arc that turned the dev loop into a recoverable system — DoD guardrails, transient-error retries, push decoupling, ENOSPC handling — and then refactored agent runtime, dev loop, and process scheduling onto the new aura-os-harness automatons.

- Definition-of-Done gate hardened end to end: empty-path writes are rejected unless a real-path write later lands, files_changed is now inferred from successful tool events, workspace preflight runs before the loop starts, and rolled-back commits surface in the UI with a strike-through Git step. (`a8e3e72`, `f1c9dce`, `a2c218d`)
- Transient provider errors (HTTP 5xx, stream-terminated, broken pipes) are now classified as retryable with jittered, escalating per-class cooldowns; single-task retries get a budget of 3 to absorb a provider blip, and completion-gate failures route through the same infra retry ladder when the underlying cause was transient. (`9cb0c6a`, `7150cd3`, `373be42`, `88fa94e`)
- Retried tasks now ship with a stateful resume preamble ("[aura-retry attempt=N]…") so the next turn doesn't redo work, and the Run pane resolves abandoned tool cards on retry, surfaces task failureReason, and renders a live "Writing retrying (n/8)…" state from the harness's new ToolCallRetrying / ToolCallFailed events with a matching server-side per-tool retry budget. (`8e75d47`, `d131349`, `f474edc`, `4424201`)
- Task terminal status is now decoupled from git push success — push failures emit a push_deferred event and a project_push_stuck banner instead of demoting completed tasks, with first-class handling for orbit ENOSPC (15-minute cooldown, amber Orbit status dot, runbook) and a remote-push-recovery runbook for operators. (`73ab86f`, `f4425e2`, `fc08c18`, `5badbea`)
- Closed the run_command policy-denial trap end to end: the desktop sidecar now sets AURA_ALLOWED_COMMANDS plus AURA_ALLOW_SHELL, --external-harness probes the harness /health policy, the DoD gate emits a specific diagnostic naming AURA_STRICT_MODE / ENABLE_CMD_TOOLS / binary_allowlist, and aura-harness's run_command-by-default contract is honored across server, sidecar, and docs. (`ed55e37`, `a41c273`, `5760d25`, `f1f4735`, `76d8a05`, `abfb6d1`, `71304ce`, `3bdb2b4`)
- Project-scoped agent tools (create_spec, create_task, list_specs, …) work without the LLM threading project_id: chat sessions auto-splice ReadProject/WriteProject self-caps for the bound project, the cross-agent dispatcher injects project_id from X-Aura-Project-Id, and the schemas drop it from required. (`8d0d715`, `b6a066e`, `def464a`, `13acee2`, `6efa695`, `c477313`)
- A pure recovery-action reconciler (adopt run, retry push, retry task, decompose, mark terminal) is now exposed on the task-output API as a recommended_action, and a new DoD retry tier with a language-neutral follow-up prompt re-prompts on missing build/test/fmt/lint axes before falling through to terminal failure. (`d09c166`, `c0e7121`, `70623bd`, `e94aa54`)
- Task state machine is now unified with aura-storage via a single safe_transition helper: the dev loop's five direct transition sites and /tasks/:id/retry all bridge ready→failed via in_progress, /retry is idempotent on ready, and the harness reader WebSocket is closed on every restart so the 128-slot WS cap stops getting exhausted. (`3809aeb`, `ef50887`, `ee5d955`, `bde1254`)
- Stuck-agent storms are no longer self-perpetuating: terminal harness signals like "appears stuck" or "stopping to prevent waste" now bypass the error-event restart, and provider credit exhaustion is classified as terminal so automation halts immediately with an insufficient-credits outcome. (`4c01759`, `95cd075`, `5fe6976`)
- Major refactor: the legacy agent-tool dispatcher and aura-os-link compatibility layer are deleted, dev loop and process scheduling now run as harness automatons, the reconciler derives recovery from harness signals, and external CLI adapters (claude_code, codex, gemini_cli, opencode, cursor) are retired — Aura OS ships only on the aura_harness runtime. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `00d095e`, `71d1821`, `c1e87fb`, `2dd8391`, `f39dc74`, `b43e4b8`, `49a1d45`)
- Concurrent loops are now isolated end to end: a new aura-os-events / aura-os-loops pair tracks chat, automation, task, process and spec loops per (user, project, agent_instance, agent, kind) with topic-scoped channels, the in-memory caches are re-keyed to remove cross-agent bleed, and a single LoopProgress component renders activity in agent rows, the sidekick, and per-task explorer rows from a /api/loops snapshot plus WS bridge. (`9860141`, `26ed693`, `ac52a80`, `61eb586`)
- Desktop shell got a coordinated visual pass: the bottom taskbar splits into three floating glass capsules with consistent 5px insets and rounded corners, the topbar and main content area float with matching radius and gaps, and the right sidekick mirrors the left menu's bottom fade. (`065b565`, `d0bd776`, `de67ed6`, `8d8225f`, `3ace217`, `07c6832`, `b1c6453`, `8494863`, `21373eb`, `b995cb2`, `eeba9fc`, `8fc9dbd`, `078aca5`, `13acee2`, `4474f6c`, `bce7a34`, `2251b35`, `fece144`)
- Chat and Run pane stream behavior is much steadier: scroll uses overflow-anchor instead of MutationObserver-driven sentinels (eliminating the up-then-down blink), mid-turn state is recovered from the server after a hard refresh, the assistant turn is preserved at end-of-stream, and stale "active" panel rows in localStorage are reconciled against the server's active task list. (`0244c85`, `6021e18`, `2bb8f04`, `3089289`, `09b8424`)
- Browser surface gets a flat Edge-style address pill, free-form queries fall back to a DuckDuckGo search, and main-frame load failures now render an Aura-branded error overlay with Ask Agent / Show Details / Reload instead of Chromium's default error page. (`7837adb`, `1c155de`, `bd92f08`)
- Native desktop polish: macOS gains a real NSMenu so Cmd+C/V/X/A/Z work inside the WebView, the custom titlebar is now draggable on macOS and Linux via tao::drag_window (WebKit ignores -webkit-app-region), and the chat composer is hidden until history resolves to avoid an empty-agent flash. (`cc3193a`, `c2294d3`, `07bbdc3`)
- Inline rename for project agents: a Rename entry in the sidebar context menu (and F2 on a focused row) opens the existing inline rename overlay, matching the project rename UX. (`efa2c79`)
- Spec and file previews gained a Copy button with cross-OS clipboard support (navigator.clipboard with execCommand fallback for Capacitor WebViews), and the GroupCollapsible header was fixed so interactive controls no longer cause a nested-button hydration error. (`55eb3c7`, `6e9126b`)
- Tool call inputs that arrived as stringified JSON no longer render as character-indexed objects, and historical/inline [tool: …] markers in completed task output are now expanded into real Block renderers instead of falling back to the legacy inline marker path. (`ad52832`, `cc71745`, `cc4781d`)

## 11:17 PM — Desktop sidecar build fix after the harness package move

The release script that bundles aura-node into the desktop sidecar was failing because the binary now lives in the aura-runtime package; the build invocation was corrected.

- prepare-desktop-sidecar now builds aura-node with `-p aura-runtime --bin aura-node` instead of `-p aura-node`, fixing the "no bin target named aura-node in default-run packages" error introduced when the binary moved into the aura-runtime package. (`cb4e6a1`, `4da6c8c`)

## 11:55 PM — Reverted accidental hooks/ relocation

A CI retrigger commit unintentionally moved interface/src/hooks into interface/src/shared/hooks without updating imports; it was reverted to restore the build.

- A workflow-retrigger change accidentally moved interface/src/hooks/* under interface/src/shared/hooks/ without rewriting imports, breaking main; the original layout was restored to unblock CI. (`2320faf`, `08ec42c`)

## 10:36 AM — Changelog media capture workflow guards

The release-changelog media workflow gained tighter skip and capture gates, plus matching planner/quality logic and small shell adjustments.

- Hardened the publish-release-changelog-media workflow with stricter skip and capture gates and matching planner/quality logic so changelog media generation no longer runs (or fails) on releases that shouldn't produce it. (`ee70b4b`)

## Highlights

- Autonomous dev loop now survives provider 5xx, push failures, and policy denials
- Major refactor: agent runtime, dev loop, and process scheduling now run through the unified harness
- Desktop shell redesigned with floating capsules, rounded panels, and corner-radius cohesion
- Chat and run pane preserve in-flight state across refresh and surface live tool retry status
- External CLI agent adapters retired — Aura OS now ships only on the aura_harness runtime

