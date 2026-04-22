# Autonomous recovery lands, plus a new login and Windows updater fix

- Date: `2026-04-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.337.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.337.1

A heavy day across the stack: the dev loop gained an end-to-end autonomous recovery pipeline that decomposes oversized tasks before and after failure, the Debug app was rebuilt around a sidekick-driven layout, the live LLM stream was rewritten for correctness, and the Windows auto-updater now actually hands off to NSIS. A redesigned ZERO login screen and several tool-output decoding fixes round it out.

## 2:06 AM — Debug app rebuilt around a sidekick inspector

The Debug experience moved to a project-first layout with a dedicated sidekick, and several chat, feed, and tool-output issues were fixed alongside it.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-debug-app-rebuilt-around-a-sidekick-inspector","slug":"debug-app-rebuilt-around-a-sidekick-inspector","alt":"Debug app rebuilt around a sidekick inspector screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-debug-app-rebuilt-around-a-sidekick-inspector -->

- Debug app now uses the shared LeftMenuTree for project-first navigation and moves the run toolbar, counters, and entry inspector into a new tabbed sidekick (Run, Events, LLM, Iterations, Blockers, Retries, Stats, Tasks); the registry was also corrected to actually mount the sidekick panel and taskbar, and the run-detail header was tightened into a single stable line with aligned inspector actions and new Copy all / Copy filtered / Export buttons. (`8e7e4f0`, `1b769a8`, `865e7ec`, `586f744`)
- Chat input now reflects a unified agent-busy state: a new useAgentBusy hook combines SSE streaming with loop activity so the stop button appears whenever the agent is busy, onStop routes to /loop/stop when the automation loop holds the turn, and the server returns a typed 409 agent_busy instead of echoing the raw harness error. (`6dd691e`)
- Task output from colored CLIs like cargo, rustc, and npm now renders as legible text: the base64 decoder allows ANSI ESC through, strips escape sequences, and recursively decodes additional output fields instead of bailing and showing raw base64. (`7822fa1`)
- Feed leaderboard is centered again and no longer surfaces a stray horizontal scrollbar; nested scroll wrappers were removed so rows render directly in the parent scroll area. (`13e2cae`)
- loop_log token counters no longer double-count mid-stream token_usage frames, and a new narration_deltas counter is emitted as a first-class signal for zero-tool-call and narration-bloat heuristics. (`f5921f6`)

## 5:49 PM — Remediation hints attached to heuristic findings

Heuristic findings now carry actionable next steps that downstream tools and dev loops can act on directly.

- Findings gained an optional RemediationHint enum (split-write, reshape-search, force-tool-call, retry-smaller-scope, no-auto-fix), each rule populates a hint matching its failure mode, and aura-run-analyze renders the hint as a compact one-liner under each finding. (`6b6d6d9`)

## 6:13 PM — Auto-decompose and reshape on truncation failure

The dev loop now reacts to truncation-style failures by spawning shaped child tasks instead of blindly retrying.

- On truncation or no-file-ops failures, the dev loop loads the run bundle, runs heuristics, and acts on the first RemediationHint: SplitWriteIntoSkeletonPlusAppends spawns skeleton + fill child tasks, while ReshapeSearchQuery and ForceToolCallNextTurn each spawn a shaped-retry task. The parent moves to failed, a task_auto_remediated event is broadcast, and AURA_AUTO_DECOMPOSE_DISABLED=1 restores the previous retry path. (`79eab49`)

## 6:05 PM — Matching block borders on run and task output

Run timeline rows and task output blocks were restyled to match the standard block outline.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-matching-block-borders-on-run-and-task-output","slug":"matching-block-borders-on-run-and-task-output","alt":"Matching block borders on run and task output screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-matching-block-borders-on-run-and-task-output -->

- Run event timeline rows and the task live/build output blocks now use the standard --color-border token so their outline matches the shared .block primitive. (`b2f25e4`)

## 6:40 PM — Sidekick and preview inherit chat's border token

The calmer chat border was propagated into the sidekick body and preview overlay for visual consistency.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-sidekick-and-preview-inherit-chat-s-border-token","slug":"sidekick-and-preview-inherit-chat-s-border-token","alt":"Sidekick and preview inherit chat's border token screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-sidekick-and-preview-inherit-chat-s-border-token -->

- The chat panel's darker #17171a border override now also applies inside the sidekick body and the preview overlay, so tables, blocks, tools, and output sections there match the LLM chat surface. (`cc9a050`)

## 6:45 PM — Closed-loop autonomous recovery, Windows updater, and new login

The largest batch of the day: preflight task decomposition, live heuristics, a reliable Windows auto-updater handoff, a logout fix, a redesigned login screen, and a sweep of tool-rendering and release-media improvements.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-closed-loop-autonomous-recovery-windows-updater-and-new-login","slug":"closed-loop-autonomous-recovery-windows-updater-and-new-login","alt":"Closed-loop autonomous recovery, Windows updater, and new login screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-closed-loop-autonomous-recovery-windows-updater-and-new-login -->

- Oversized task specs are now split before they ever run: detect_preflight_decomposition flags tasks whose title or description signal a likely-oversized generation, fans them out into shared skeleton + fill children (the same helper Phase 3 uses post-failure), moves the parent to a non-runnable status, and broadcasts task_preflight_decomposed. Honors AURA_AUTO_DECOMPOSE_DISABLED and a new per-task skip_auto_decompose opt-out. (`4f8e0a6`)
- A new LiveAnalyzer re-runs the heuristics engine against the in-progress run bundle every 50 events, every 30s, or immediately on task_failed, deduping findings by stable id and broadcasting Warn/Error results as dev_loop_advisory / heuristic_finding domain events with RemediationHint payloads so the UI can surface them mid-flight; followup cleanup removed an unused run_id field from the analyzer. AURA_LIVE_HEURISTICS_DISABLED opts out. (`097b5a5`, `2a78b8e`)
- A replay-based integration test reproduces the original write_file truncation failure and asserts the full decision chain (classify_failure -> Truncation, heuristics -> SplitWriteIntoSkeletonPlusAppends, preflight detector -> Some), and a golden test in aura-run-analyze pins the rendered output including remediation lines against a committed fixture. (`6de6a5e`)
- Windows auto-update now reliably installs instead of silently exiting: Aura downloads and stages the verified installer itself under <data_dir>/runtime/updater, runs the shutdown hook to release file locks, then spawns the NSIS setup detached with CREATE_BREAKAWAY_FROM_JOB / CREATE_NEW_PROCESS_GROUP and /P /R. The Updates settings row also promotes to a full-width panel when an update is available, downloading, installing, or failed, and the desktop auto-update smoke test now covers Windows alongside macOS. (`61300eb`)
- Logout no longer strands users on a black-screen redirect loop: App.tsx stops using a stale boot-time isLoggedIn snapshot once the auth store resolves, logout() drops the window reload and always runs local cleanup even if the server call throws, and a new aura-force-logged-out sentinel plus wiping of the IDB localStorage fallback prevents the stale desktop init script from resurrecting a dead session. (`2ab59d4`)
- The live LLM stream was rewritten so arrival order equals render order: text deltas strictly append to the timeline tail instead of folding back across tool and thinking blocks, the stream-safe content pass cleans up dangling * / _ markers and odd emphasis counts, and a new isWriting signal keeps the cooking indicator visible during stalls, thinking, and pending tools but hides it while words are actively revealing. A follow-up removed an unused binding to keep tsc + vite build green. (`aabd229`, `b0e2713`)
- Tool result rendering is now correct for several common tools: CommandBlock and FileBlock decode the base64 stdout envelope from run_command and read_file so output renders as legible, syntax-highlighted text instead of a raw JSON blob, and ListBlock pulls rows out of base64 stdout envelopes for list_files, find_files, and search_code (including splitting path:line:match into primary and secondary columns) so results no longer show up as "0 items". GenericToolBlock also regained its 10px left inset by switching its containers away from <pre>, and a global --color-border token unification removed drift across chat, sidekick, preview, tool rows, and terminal panels. (`45e55ba`, `59d2aa6`, `f62eb9d`, `150f142`)
- Login was redesigned around a full-screen AURA visual-loop video with a centered translucent sign-in card titled "Login with ZERO Pro" (narrower, lighter weight, mobile layout unchanged). (`dacd52e`, `3fdb15e`, `df72d28`, `3969c21`, `04b5496`, `a68d479`)
- Billing email is now locked to the ZERO account identity: the field is rendered as read-only with a "Tied to your ZERO account" caption, the API no longer accepts billing_email in SetBillingRequest, and a regression that could boot users into a Free plan when edits diverged from their ZERO record is fixed. (`68ea3aa`)
- Desktop runtime config now surfaces AURA_DESKTOP_EXTERNAL_HARNESS alongside the other harness toggles so the UI can reflect external-harness mode without reading the process environment, and an abandoned AURA_NODE_AUTH_TOKEN shared-secret bearer path between aura-os and the harness was dropped (user JWT flow untouched). (`9993d15`, `c205261`)
- PushCardBody in the activity feed now falls back to commitIds.length when metadata.commits is missing, so older posts show a real commit count instead of 0. (`070248d`)
- Release changelog media pipeline got more resilient: successful screenshots are committed and pushed before failures trigger an automatic retry workflow dispatch, a strict rubric gate still fails the job until every slot passes, candidate inference for the daily changelog generator was tightened, and the capture scripts now parse fenced / trailing-comma / loose-field JSON from agent briefs much more robustly. (`2f96782`, `14a67af`, `eb42a29`)

## Highlights

- Debug app rebuilt around project-first nav and a sidekick inspector
- Autonomous dev-loop recovery: preflight + post-failure task decomposition
- Live heuristics now surface advisories mid-run
- Windows auto-updater reliably hands off to NSIS
- Logout no longer strands users on a black screen
- New ZERO Pro login with full-screen video backdrop

