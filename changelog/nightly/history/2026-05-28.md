# AuraShell unification, public landing rebuild, and dev-loop reliability overhaul

- Date: `2026-05-28`
- Channel: `nightly`
- Version: `0.1.0-nightly.565.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.565.1

A very large nightly that consolidates the desktop and logged-out shells into a single AuraShell, rebuilds the public landing around persona-themed mock desktops and a refreshed marketing surface, and lands a deep simplification of the dev-loop, harness transport, and task streaming pipeline. Reliability work covers Start/Stop wedges, reattachable chat and task streams, IndexedDB-backed task storage, and a long string of UI fixes for the sidekick Run pane and activity timeline.

## 7:45 PM — AuraShell unification and public landing rebuild

Collapsed DesktopShell and LoggedOutShell into a single AuraShell mounted once, unified Simple/Advanced/Public modes behind one ui-mode-store, and rebuilt the logged-out surface around persona-themed mock desktops, marketing pages, and a refreshed chrome.

- Consolidated DesktopShell and LoggedOutShell into one AuraShell with stable DOM identity across Simple/Advanced/Public flips, plus a new ui-mode-store that migrates legacy Normie users to Simple and pins ChatApp in Simple mode. (`753679e`, `c1f2b39`, `972f1a6`, `66b6177`, `8f70b66`)
- Rebuilt the public landing as a persona-driven hero: right-edge PersonaTickRail and bottom avatar dock both drive a layered cross-fade between persona wallpapers, page backgrounds, CTA glow, and nav contrast tokens, with mouse-wheel cycling and curated themes for Vibecoder, Solo Builder, Giga Brain, Coordinator, Researcher, and Cypher Punk. (`70e948c`, `718ff95`, `d4fc240`, `aedb5c3`, `99b92e0`, `04e450f`, `e7a7b2c`)
- Replaced the old empty-state banner with a windowed MockAuraApp hero: real ShellTitlebar overlay, BottomTaskbar-style dock pills, fish-eye magnified persona dock, and four MSN-style DM windows with expand/staggered-collapse, FLIP scrolling, syntax-highlighted code, and theme-derived chat palettes. (`6612f13`, `811a134`, `ea0c280`, `2936b0c`, `41b80f9`, `222a569`, `799131f`)
- Routed Product, Changelog, Feedback, Pricing, and Models into a PublicMarketingPanel that mounts inside the public shell, ported aura-web's /feedback proxy onto aura-os-server, and added a Download pill plus auto-detected installer link from the changelog Current Version stat. (`c6f14c2`, `b1c203e`, `3db1d04`, `3757865`)
- Polished the public chrome: shimmering neon 'Create your agent' CTA, sliding active pill in the marketing nav, persona-aware sidebar text, sliding Simple/Advanced toggle, and a Powered-by-THE-GRID lightning bolt in the public bottom taskbar. (`3becac2`, `ccfcf64`, `cdbf630`, `be7160b`, `b4f8bd7`, `8042049`, `f1925f9`)
- Added a mobile public shell with hamburger drawer and chat composer so logged-out visitors on iOS/Android get a proper public surface instead of falling through to the authed MobileShell. (`a5601b4`, `3a1e943`)
- Reworked the dev-loop pipeline: collapsed three completion gates into a single workspace-health rule, replaced in-memory retry trackers with a persisted tasks.attempts column, deleted the aura-os-automation crate, and consolidated start_loop/run_single behind a shared RunRequest controller. (`bed7fd0`, `08e6fb3`, `c82285e`, `2010f17`, `21ec74d`)
- Fixed long-standing dev-loop wedges: synchronous LoopEnded on Stop, freshness gate on forwarder reuse, attempt-aware retry policy for ResearchLoopAbort, and a client safety-net hydrate after every Start/Resume/Stop. (`521e75b`, `419f060`, `6cd7181`, `d8c4958`)
- Sidekick Run pane and Tasks tab finally bind to live automation: forwarder events stamp routing fields, implicit task_started is synthesized when the harness skips it, and the per-task context-usage pill hydrates from a new endpoint so cold-loaded rows show their context ring. (`1465d47`, `adb09a3`, `eeaed42`, `f6eafb1`, `f716813`)
- Tightened the chat input experience: anti-oscillation lockout at the wrap boundary, copy button unified across every Block renderer, per-segment thinking durations, session-wide gallery navigation, and a fade-in for decoded images. (`8612fd6`, `848af60`, `8bf4abc`, `4f60e4a`, `d6d371c`)
- Reliability and platform plumbing: per-token aura-network sync dedupe, persisted sentinel that silences the permissions heal storm across restarts, repo-local Cargo target dir, and structured planning contracts for specs and tasks. (`24d3bf7`, `3e85c94`, `933cb9e`, `132fb6f`, `8336ebb`)

## 10:13 PM — Image generation: deliver completion frame before storage persistence

Fixed an image-generation hang where a slow storage backend could prevent the terminal SSE frame from ever reaching the client.

- Reordered run_image_upstream_task so the generation_completed SSE frame is sent before persist_completion is awaited, preventing the client from sitting on a forever-cooking pill when storage is slow or unreachable; persistence still runs best-effort afterward and a new regression test pins the timing. (`83566d9`)

## 10:13 PM — Reattachable streams, IndexedDB task storage, and RuntimeRequest wire shape

Migrated the harness session-start onto a single RuntimeRequest wire, introduced sequenced firehose and per-stream live registries so chat and task streams survive reloads, moved task caches off localStorage to IndexedDB, and polished the activity timeline.

- Migrated session start to a unified RuntimeRequest two-step exchange (POST /v1/run then WS /stream/:run_id) across the harness client, local harness, and aura-os-server handlers, deprecating the old SessionInit first-frame contract. (`cad02e0`)
- Added a sequenced /ws/events firehose with replay on reconnect, a LiveStreamRegistry for resumable per-run SSE, and migrated streaming spec generation onto the registry so a dropped connection no longer restarts generation. (`f3ee1d4`, `2d2ad41`, `28c9e26`, `9a3590f`)
- Moved task output cache, panel store, and turn cache from localStorage to IndexedDB with auto-migration, plus a boot diagnostic that warns on >3MB localStorage usage and an auth-restore retry that evicts legacy task keys on QuotaExceededError. (`bcfc120`, `42d243b`)
- Stabilized the sidekick task preview during live streaming: virtualized timeline and event list with @tanstack/react-virtual, deferred trailing tool cards while text streams, restored prior assistant turns above the live stream, and recognized post-task_done test markers. (`59013ff`)
- Restored visible thinking blocks during streaming, collapsed empty Thinking placeholders to header-only rows, and rolled out a synthetic Brain Thinking block for models that don't emit thinking_delta so every standard LLM surface shows reasoning narration consistently. (`2f9af4f`)
- Marketing surfaces gained a /models page proxied through aura-os-server, a floating changelog stats card with live commit counts from seven GitHub repos and a releases-per-day chart, a /product agent marquee with hover-zoom posters, and an AgentChatSection with three overlapping phone shells. (`bb175f4`, `fd30201`, `1cacc13`, `1475f24`, `7cdf520`)
- Polished public assets: replaced placeholder iOS app icon with the AURA orb and unblocked mobile chat input for local agents. (`57b131a`, `b40c906`)
- Restored readable task descriptions in dark mode, kept the streaming caret mounted to avoid 1px text shifts on completion, and preserved live output across refresh during active runs. (`fcdbdd5`, `610886f`, `8a98a84`)

## 2:18 PM — Automation tool logging and canonical HarnessSession run_id

Surfaced tool command and result text in aura::automation logs and started consolidating the harness transport behind a single canonical run abstraction.

- Automation traces now record the tool command summary, duration, and result on tool_call_started/completed, including the failure text on errors, so a run_command timeout is finally diagnosable from logs alone. (`12cc43d`)
- HarnessSession now retains the harness-allocated run_id and exposes a canonical open_run plus run_id-keyed pause/stop/status, with shared git-event normalization on the unified ws_bridge so every consumer gets canonical git event shapes. (`cc32640`, `aaad434`)

## 2:28 PM — Clearer tool feedback in the sidekick activity timeline

Tightened the streaming UX so command rows, phase labels, and the Thinking placeholder reflect what's actually happening during tool runs.

- CommandBlock now distinguishes in-flight, clean-exit, and empty-output states instead of always saying 'No output', the pinned phase label stops reporting stale Thinking once tools have run, and a new tool_call_started settles prior still-pending rows so the timeline shows one active row at a time. (`b69ba4a`)

## 4:55 PM — Resumable chat turns, granular spec edits, and unified HarnessLink transport

Completed the harness transport unification on HarnessLink, made chat turns survive passive SSE disconnects and reattach on reload, added granular spec-edit tools with if_match concurrency, and finished a string of cross-agent and task-state fixes.

- Migrated every automaton and dev-loop consumer onto the canonical HarnessLink transport (submit_run/attach_run) and deleted the legacy AutomatonClient, so chat and automaton runs now share one HTTP/WS surface with typed AutomatonEvent classification on the bridge. (`0003318`, `548ff7c`, `009f7c7`, `5c62331`, `af9d990`)
- Each chat turn is now registered as a reattachable ChatTurn stream and the client reattaches in-flight turns on reload or transient disconnect via /api/streams, with passive SSE drops no longer cancelling the upstream turn. (`7f53e06`, `ffe6da7`, `726efef`, `10ddf75`)
- Added granular update_spec_section and append_to_spec endpoints/tools with blake3 content_hash plus if_match concurrency so agents stop re-emitting whole spec bodies and stale edits fail loudly with 409. (`313c5e0`)
- Tool-driven task completions now flip the task modal off In Progress, clear the loop's current_task_id, and finalize the per-task stream live, instead of waiting for a manual refresh. (`8d9df00`, `890df0d`)
- Chat got user-facing recovery affordances: a Retry button on error bubbles, a moving placeholder while images and videos generate, and the overlay scrollbar lifted above the input fade so the thumb stays visible. (`a701606`, `aa383e5`, `85142bd`)
- Fixed cross-agent messaging so replies land in the session the recipient UI actually opens and the B->A callback carries the turn's model, eliminating empty-panel and 'model name must not be empty' regressions. (`149c954`, `719e47e`)
- Suppressed the warn + protocol-mismatch noise that automaton-only frames produced on the shared WS bridge by classifying them through a typed AutomatonEvent enum with an Unknown catch-all. (`520fcab`)

## Highlights

- One unified AuraShell across Simple, Advanced, and Public modes
- Rebuilt public landing with persona theming, mock Aura desktop, and marketing pages
- Dev-loop simplified: one health gate, persisted attempts, unified HarnessLink transport
- Reattachable chat and task streams survive reloads and SSE drops
- Sidekick Run pane and activity timeline finally show live task progress reliably
- Task storage moved off localStorage to IndexedDB to end quota wedges

