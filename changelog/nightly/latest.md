# Autonomous dev-loop recovery lands, plus a calmer chat and debug surface

- Date: `2026-04-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.334.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.334.1

Today's nightly is anchored by a seven-phase push that teaches Aura's dev loop to detect, decompose, and replay tasks that would otherwise fail on truncated writes — backed by live heuristics, remediation hints, and golden tests. Alongside that, the Debug app gets a project-first redesign with a sidekick-driven inspector, chat gains a proper agent-busy state, and a wide sweep of tool-output rendering fixes makes command, file, and list blocks legible again.

## 2:06 AM — Autonomous dev-loop recovery and a project-first Debug app

A long overnight push delivered end-to-end autonomous recovery for truncation failures and rebuilt the Debug surface around projects and a sidekick inspector.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-autonomous-dev-loop-recovery-and-a-project-first-debug-app","slug":"autonomous-dev-loop-recovery-and-a-project-first-debug-app","alt":"Autonomous dev-loop recovery and a project-first Debug app screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-autonomous-dev-loop-recovery-and-a-project-first-debug-app -->

- The dev loop can now recover from truncated-write failures on its own: heuristics emit structured remediation hints (split-write, reshape-search, force-tool-call), Phase 3 acts on the first hint by spawning skeleton+fill children or a shaped-retry task, and Phase 5 preemptively decomposes oversized task specs at ingestion — all gated by AURA_AUTO_DECOMPOSE_DISABLED and a per-task opt-out. (`6b6d6d9`, `79eab49`, `4f8e0a6`)
- A new LiveAnalyzer re-runs heuristics against the in-progress run bundle every 50 events, every 30s, or immediately on task_failed, broadcasting deduped Warn/Error findings as heuristic_finding domain events so the UI can surface advisories mid-flight. A replay integration test and a golden-output fixture pin the full classify → heuristic → preflight decision chain. (`097b5a5`, `6de6a5e`)
- The Debug app was rebuilt around projects: the shared LeftMenuTree now lists every project at the top level, and the run toolbar, counters, and entry inspector moved into a sidekick with Run, Events, LLM, Iterations, Blockers, Retries, Stats, and Tasks tabs driven by a new debug-sidekick-store. A portal-backed filter menu stops dropdowns from being clipped, the JSONL envelope is unwrapped so rows show real types and timestamps, and the run-detail header now carries Copy all / Copy filtered and Export buttons. (`8e7e4f0`, `1b769a8`, `865e7ec`, `586f744`)
- Chat input now tracks a true agent-busy state: a new useAgentBusy hook combines SSE streaming and loop-active signals so the stop icon appears whenever either source holds the turn, onStop routes to /loop/stop when the automation is the one running, and the server returns a typed 409 agent_busy instead of echoing the raw harness error. (`6dd691e`)
- Colored CLI output (cargo, rustc, npm) now renders as readable text in the task panel — the base64 decoder no longer bails on ESC bytes and strips ANSI escapes — and loop_log's token counters stop double-counting mid-stream usage frames, with a new narration_deltas signal added for downstream heuristics. (`7822fa1`, `f5921f6`)
- Visual polish across chat-adjacent surfaces: the leaderboard's stray horizontal scrollbar is gone, and run/task output blocks, sidekick bodies, and preview overlays now share the main chat's subtler border token for a calmer, more consistent outline. (`13e2cae`, `a6f3a4c`, `b2f25e4`, `cc9a050`)

## 7:41 PM — Unified border token and a feed commit-count fallback

The darker chat border token was promoted to a global root variable, and feed push cards stopped showing zero commits when metadata was partial.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-unified-border-token-and-a-feed-commit-count-fallback","slug":"unified-border-token-and-a-feed-commit-count-fallback","alt":"Unified border token and a feed commit-count fallback screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-unified-border-token-and-a-feed-commit-count-fallback -->

- Promoted the #17171a border token to :root so tables, blocks, tool rows, message bubbles, preview overlays, task/terminal panels, and sidekick surfaces all inherit the same outline as the main chat — retiring the per-container overrides added earlier in the day. (`150f142`)
- PushCardBody now falls back to commitIds.length when metadata.commits is missing, so older feed posts no longer display a misleading "0 commits". (`070248d`)

## 8:00 AM — Abandoned the AURA_NODE_AUTH_TOKEN shared-secret path

Work-in-progress shared-secret plumbing between aura-os and the harness was dropped in favor of the existing user JWT flow.

- Removed the uncommitted AURA_NODE_AUTH_TOKEN bearer path across HarnessHttpGateway, LocalHarness, app_builder, and the desktop main entry, consolidating harness auth on the already-shipping user JWT flow. AutomatonClient and SwarmHarness auth_token fields remain but are now permanently unused. (`c205261`)

## 8:48 AM — Tool-output decoding, linear streaming, and a logout fix

Command, file, and list tool blocks now decode their envelopes correctly, the LLM stream renders strictly in arrival order, and logout no longer traps users in a redirect loop.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-tool-output-decoding-linear-streaming-and-a-logout-fix","slug":"tool-output-decoding-linear-streaming-and-a-logout-fix","alt":"Tool-output decoding, linear streaming, and a logout fix screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-tool-output-decoding-linear-streaming-and-a-logout-fix -->

- CommandBlock, FileBlock, and ListBlock now run tool-result envelopes through a shared decodeCapturedOutput helper: run_command output renders as legible text, read_file contents show up syntax-highlighted instead of as raw JSON, and list_files / find_files / search_code finally return real rows (with search_code matches split into file:line + preview columns). (`45e55ba`, `59d2aa6`, `f62eb9d`)
- Live LLM streaming was untangled: text deltas now strictly append to the timeline tail instead of folding back into earlier text items across tools, markdown safety trims dangling * / _ so half-written emphasis no longer flashes under the cursor, and a new isWriting signal keeps the "cooking" indicator hidden while words are actively revealing but visible during thinking, tool calls, and stalls. (`aabd229`)
- Logout no longer lands on a black-screen redirect loop: App.tsx gates its boot-time showShell flag on the live auth state, logout drops the full-page reload and always runs local cleanup even when the server call throws, and a new aura-force-logged-out sentinel prevents the desktop init script's baked-in auth literals from resurrecting a dead session on reload. (`2ab59d4`)
- Billing email in Team Settings is now read-only and captioned "Tied to your ZERO account", with billing_email dropped from SetBillingRequest — closing a regression where edits that diverged from the ZERO identity booted the org back to a Free plan. (`68ea3aa`)
- Hardened the changelog media proof capture pipeline with balanced-block JSON extraction, loose-field fallbacks, and expanded test coverage across demo-agent-brief, demo-screenshot-quality, and demo-seed-planner. (`eb42a29`)

## 9:51 AM — External harness flag exposed in desktop runtime config

The desktop runtime config now surfaces AURA_DESKTOP_EXTERNAL_HARNESS alongside the other harness toggles.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-external-harness-flag-exposed-in-desktop-runtime-config","slug":"external-harness-flag-exposed-in-desktop-runtime-config","alt":"External harness flag exposed in desktop runtime config screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-external-harness-flag-exposed-in-desktop-runtime-config -->

- Desktop runtime config now reports AURA_DESKTOP_EXTERNAL_HARNESS so the UI can reflect whether an external harness is in use without reading the process environment directly. (`9993d15`)

## 9:51 AM — Post-merge cleanup to unblock the tsc build

Small follow-ups tightened the LiveAnalyzer constructor and removed unused declarations so the interface TypeScript build passes.

- Dropped the unused run_id field from LiveAnalyzer (callers already pass it at emit time) and removed leftover useIsWriting, MARKER_RUN_RE, and clearStoredAuth declarations so `tsc -b && vite build` completes cleanly. (`2a78b8e`, `b0e2713`)

## Highlights

- Autonomous recovery: tasks auto-split on truncation failures
- Debug app rebuilt around projects and a sidekick inspector
- Chat input now reflects automation-loop busy state
- Tool output finally decodes base64 and ANSI cleanly
- Logout no longer strands users on a black-screen redirect loop

