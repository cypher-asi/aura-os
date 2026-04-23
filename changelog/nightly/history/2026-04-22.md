# Autonomous recovery, Debug workspace overhaul, and Windows updater reliability

- Date: `2026-04-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.343.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.343.1

A dense nightly covering three major threads: a new self-healing dev loop that decomposes oversized tasks and rides out provider rate limits, a top-to-bottom rework of the Debug app around project-first navigation and a sidekick inspector, and a raft of reliability fixes spanning the Windows auto-updater, logout, live LLM streaming, and the changelog media pipeline.

## 2:06 AM — Debug app gains a sidekick inspector and chat learns when the agent is busy

A long evening thread reshaped the Debug experience around project-first navigation and a right-hand inspector, while the chat surface finally reflects automation-loop activity.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-debug-app-gains-a-sidekick-inspector-and-chat-learns-when-the-ag","slug":"debug-app-gains-a-sidekick-inspector-and-chat-learns-when-the-ag","alt":"Debug app gains a sidekick inspector and chat learns when the agent is busy screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-debug-app-gains-a-sidekick-inspector-and-chat-learns-when-the-ag -->

- Debug was restructured around a shared project tree with a dedicated sidekick (Run, Events, LLM, Iterations, Blockers, Retries, Stats, Tasks tabs), a portal-backed filter menu that no longer clips, and proper unwrapping of the loop_log JSONL envelope so rows stop showing 'unknown' type and timestamp. Follow-ups mounted the sidekick panel/taskbar via the app registry, stabilized the run-detail header against reflow, tightened it into a single line matched to the sidebar search height, and added Copy All / Copy Filtered / Export buttons for grabbing JSONL or a full run bundle. (`8e7e4f0`, `1b769a8`, `865e7ec`, `586f744`)
- Chat now surfaces agent-busy state when the automation loop holds a turn: a new useAgentBusy hook drives the stop icon from either SSE streaming or loop activity, Stop routes to /loop/stop when appropriate, and the server returns a typed 409 agent_busy instead of echoing the raw 'A turn is currently in progress' harness string. (`6dd691e`)
- ANSI-colored CLI output (cargo, rustc, npm) in the task panel is now decoded properly — the base64 decoder allows ESC bytes through, strips ANSI escapes, and recurses into more output keys instead of rendering a raw blob. (`7822fa1`)
- Run telemetry got more trustworthy: loop_log's token counters no longer double-count mid-stream usage frames, and a new narration_deltas counter becomes a first-class signal for zero-tool-call and narration-bloat heuristics. Output block borders were also softened to match the calmer LLM chat treatment. (`f5921f6`, `a6f3a4c`)
- A stray horizontal scrollbar on the Feed leaderboard was eliminated by dropping the nested chartWrap and rendering rows directly inside the parent scroll area. (`13e2cae`)

## 5:49 PM — Heuristic findings now carry actionable remediation hints

Run-analysis findings gained a RemediationHint so downstream loops inherit concrete next steps instead of raw diagnostics.

- Each heuristic rule now emits a typed RemediationHint (SplitWriteIntoSkeletonPlusAppends, ReshapeSearchQuery, ForceToolCallNextTurn, RetrySmallerScope, NoAutoFix), and aura-run-analyze renders it as a compact one-liner under each finding — setting up the autonomous recovery work later in the day. (`6b6d6d9`)

## 6:05 PM — Run and task output blocks adopt the standard block border

A small visual pass unified the stroke used on run timeline rows and task output panels.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-run-and-task-output-blocks-adopt-the-standard-block-border","slug":"run-and-task-output-blocks-adopt-the-standard-block-border","alt":"Run and task output blocks adopt the standard block border screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-run-and-task-output-blocks-adopt-the-standard-block-border -->

- Run event timeline rows and task live/build output containers now use the standard --color-border token, matching the .block primitive outline instead of the lighter variant. (`b2f25e4`)

## 6:13 PM — Automatic task decomposition after truncation failures

Phase 3 of the autonomous recovery work: truncation/no-file-ops failures now fan out into skeleton+fill or shaped-retry children automatically.

- When a task fails with truncation or no-file-ops, the dev loop loads the run bundle, runs heuristics, and acts on the first RemediationHint — spawning a skeleton+fill pair, a reshaped-search retry, or a force-tool-call retry. The parent is moved to failed and a task_auto_remediated event is broadcast, all gated by MAX_RETRIES_PER_TASK and the AURA_AUTO_DECOMPOSE_DISABLED kill switch. (`79eab49`)

## 6:40 PM — Chat border token propagates into sidekick and preview overlays

A small follow-up aligned sidekick and preview surfaces with the darker chat border.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-chat-border-token-propagates-into-sidekick-and-preview-overlays","slug":"chat-border-token-propagates-into-sidekick-and-preview-overlays","alt":"Chat border token propagates into sidekick and preview overlays screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-chat-border-token-propagates-into-sidekick-and-preview-overlays -->

- The main chat's darker --color-border override (#17171a) now also applies inside the sidekick body and the preview overlay, so tables, blocks, tools, and output sections share the same subtle outline as the LLM chat. (`cc9a050`)

## 6:45 PM — Self-healing dev loop, Debug live runs, Windows updater fix, and a pile of reliability work

The day's largest batch lands autonomous task recovery end-to-end, a live-runs view in the Debug app, a reliable Windows auto-update handoff, a logout fix, streaming-chat cleanups, and hardening for the changelog media pipeline.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-self-healing-dev-loop-debug-live-runs-windows-updater-fix-and-a-","slug":"self-healing-dev-loop-debug-live-runs-windows-updater-fix-and-a-","alt":"Self-healing dev loop, Debug live runs, Windows updater fix, and a pile of reliability work screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-self-healing-dev-loop-debug-live-runs-windows-updater-fix-and-a- -->

- Autonomous recovery is now wired front-to-back: oversized task specs are decomposed into skeleton+fill children at ingestion (Phase 5), a LiveAnalyzer re-runs heuristics every 50 events or 30s during a run and broadcasts advisories (Phase 6), and a replay integration test plus a golden fixture pin the full classify→heuristics→decompose chain against a synthetic truncated run (Phase 7). (`4f8e0a6`, `097b5a5`, `6de6a5e`, `2a78b8e`)
- Provider rate limits no longer cascade: a new RateLimited failure class is checked before Truncation, Retry-After is extracted from structured fields or parsed from message text, project-wide cooldowns are raised to max(default, hint) capped at 120s, restart conflicts on the harness are resolved by stop-stale or adopt-live, and the TaskOutputSection now renders 'Rate limited by provider — resuming in Ns…' via a new useCooldownStatus hook instead of hanging on 'Waiting for agent output'. (`dc50429`, `2d0124d`, `53dec4d`, `7a735ec`)
- Definition-of-Done completion gate now requires evidence that matches the change type: docs-only edits pass freely, non-Rust source needs build+test, and Rust source must have build, test, cargo fmt, and clippy telemetry before a task can transition to done. Every decision emits a task_completion_gate event with the full input snapshot, and create_task is now idempotent on (project, spec, title) so repeated generate-spec→extract-tasks cycles stop doubling the task list. (`371aacf`, `15c8728`, `8fb8af9`, `2d0124d`)
- Debug got a live operational view: a 'Running now' section lists in-progress runs across the workspace (polling 3s active / 10s idle), expand/collapse state and last-visited project/run are persisted, /debug redirects back to the remembered location, and server startup now reconciles orphan Running bundles to Interrupted. stop_loop and start_loop also finalize bundles explicitly so ghost live runs can't linger until the next restart. The run-detail timeline is now always shown in full, and the Copy All action confirms with a transient 'Copied' label. (`46ae8e9`, `5e25855`, `4f83bcf`, `3855508`, `ea9ab6e`)
- Windows auto-update now hands off to NSIS reliably: Aura downloads the verified installer itself, stages it under runtime/updater, triggers shutdown to release sidecar file locks, and spawns setup with DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB so it survives Aura's exit — replacing the cargo-packager PowerShell shim that kept getting torn down with WebView2. The settings Updates row promotes to a full-width panel during available/downloading/installing/failed states, and the local auto-update smoke test gained a Windows leg. (`61300eb`)
- Desktop window dragging is now fluid: a single shared useSyncExternalStore snapshot replaces ~40 per-component window.resize listeners with shallow-equality dedup and rAF coalescing, and the main window's background brush switched from BLACK_BRUSH to NULL_BRUSH so Windows no longer paints black bars chasing the resize edge. The IDE window also now receives the auth bootstrap script, fixing the blank file tree and 'missing authorization token' errors in the separate WebView. (`88a1fee`, `dd97291`, `9993d15`)
- Logout no longer strands users on a black-screen redirect loop. The boot-time logged-in snapshot is now gated behind unresolved-session state, logout skips the window.location reload and always runs local cleanup even when the server call fails, and a sticky aura-force-logged-out sentinel plus an IDB-localStorage wipe prevent the desktop init script from resurrecting a dead session on reload. (`2ab59d4`)
- Live LLM streaming was simplified and made safer: text deltas now strictly append to the timeline tail so arrival order matches render order across tools and thinking blocks; the stream-safe content pass hides dangling *, _ and odd emphasis markers while closers are in flight; and the cooking indicator is now pinned above the input bar, aligned to the 680px text column, with isWriting used to hide it only while words are actively revealing. Standalone agent chat scrolling, broken by the earlier changelog instrumentation wrapper, was also restored by preserving the flex height chain. (`aabd229`, `c4f512d`, `16f38ac`, `27d79bd`)
- Tool output rendering became legible across the board: command and read_file blocks now decode the base64 stdout/stderr envelope and render file contents as syntax-highlighted code instead of raw JSON; list_files, find_files and search_code envelopes are unpacked so tables stop showing '0 items'; GenericToolBlock's Input/Result panels regained their 10px inset by rendering as divs; and the global --color-border token was unified across chat, sidekick, tools, blocks and previews. (`45e55ba`, `59d2aa6`, `f62eb9d`, `150f142`, `ed2e669`)
- Login was redesigned around a full-screen AURA_visual_loop video background with a centered translucent sign-in card titled 'Login with ZERO Pro', trimmed to a narrower 308px width. Billing email is now read-only in Org Settings and tied to the ZERO account identity, so stale clients can't knock an org back to Free by editing it. (`dacd52e`, `3fdb15e`, `df72d28`, `3969c21`, `04b5496`, `a68d479`, `68ea3aa`)
- The release changelog media pipeline now publishes successful captures before retrying failures, dispatches a dedicated retry workflow for failed slots, unifies partial-success policy across publish/reconcile/retry, tightens JSON candidate inference for agent briefs, and hardens screenshot proof capture — with a relaxed partial-failure gate so one flaky slot no longer blocks the whole release. (`2f96782`, `14a67af`, `9005c60`, `e0b0ade`, `eb42a29`, `027e0e2`)
- Smaller polish: the Feed push card now falls back to commitIds.length when metadata.commits is absent; sidekick context no longer blinks during task-provider refresh; the last Debug sidekick tab no longer ghost-duplicates next to the More button thanks to hysteresis in useOverflowTabs; stat-card dollar values always render two decimals; and long block titles stop crowding trailing EXIT badges. (`070248d`, `fe06055`, `764be8b`, `773a3a8`, `ed2e669`)

## Highlights

- Dev loop now auto-decomposes truncated tasks and honours provider Retry-After
- Debug app rebuilt around project-first nav with a live-runs sidekick
- Windows auto-updater hands off to NSIS reliably
- Logout no longer traps users on a black-screen redirect loop
- Definition-of-Done gate requires build, test, fmt, and clippy evidence for Rust changes

