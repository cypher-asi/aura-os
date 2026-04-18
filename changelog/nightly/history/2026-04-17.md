# Feedback and Notes apps ship, chat scroll overhauled, agent reliability hardened

- Date: `2026-04-17`
- Channel: `nightly`
- Version: `0.1.0-nightly.284.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/nightly

A dense nightly that delivered two new first-class apps — Feedback and Notes — while simultaneously replacing the chat panel's virtualizer with native CSS scroll anchoring to eliminate the long-standing resize jank. Agent session management got deterministic cancellation and proper context scoping, and the release pipeline gained build-version surfacing across all CI targets.

## 8:13 PM — Chat scroll rebuilt and Feedback app launched end-to-end

Four iterative JS-side scroll fixes were superseded by a root-cause rewrite to CSS scroll anchoring, while the Feedback app went from mock data to a fully wired backend with votes, product tags, and session reliability improvements.

- Replaced the TanStack virtualizer with native CSS scroll anchoring in the chat panel, eliminating the frame-lag jank that caused messages to slide and pop during sidekick lane resizes. The virtualizer, per-message ResizeObserver, height cache, and ~533 lines of scroll-correction plumbing were removed; a single targeted useLayoutEffect now handles the only case the browser can't cover — pinning to the bottom as new tokens stream in. (`bc92aec`, `1876a8b`, `2ac44d6`, `8879923`)
- All agent tool outputs (thinking, file ops, commands, specs, tasks, media, status readouts) now render through a unified Block primitive with a fixed-height scrollable body. Content streaming inside a Block no longer causes layout shifts in the surrounding chat lane — it behaves like a rolling tail -f inside the block. Stacked tool-row borders were also collapsed from 2px to a clean 1px divider. (`ac75c03`, `ddcca63`, `aabd6a5`, `3506a6d`, `4f7ef42`, `22e4711`, `5231af4`)
- The Feedback app launched with a full backend (list, create, vote, status-update, comment endpoints in Rust) and a live frontend store replacing mock data. Votes and status updates are applied optimistically and reconciled with server aggregates, reverting on failure. A dedicated AURA_NETWORK_FEEDBACK_URL override lets feedback traffic target a local aura-network instance independently of the main network client. (`ad094d0`, `a36c106`, `1f7fea8`, `a229971`)
- Feedback posts can now be tagged with a product (AURA, The Grid, Wilder World, Z Chain) stored in the existing metadata blob. The left filter panel gained a Product section, and the composer defaults to AURA independently of the active filter — fixing a bug where switching the filter retargeted new posts. (`71151ff`, `9f57cc2`)
- Agent session management received two reliability fixes: session reset now scopes LLM context to the current storage session only (preventing corrupted tool_use blocks from prior sessions re-injecting into the model), and stale active sessions are transitioned to completed on rotation so the sidekick no longer shows a spinning status icon for every historical session. (`20fd39c`, `be5cc2d`)
- Project delete now returns a clear 409 with an actionable message (pointing to Archive) instead of an opaque 500 when residual foreign-key references block deletion. Spec deletion similarly blocks with a 409 when tasks still reference the spec, surfacing the task count inline. (`efaadf2`)

## 2:50 PM — Notes app introduced with TipTap editor and slug-based file paths

A new Notes app lets users write and organize free-form markdown notes per project, with WYSIWYG editing, auto-renaming files to match titles, and a sidekick showing metadata, table of contents, and local comments.

- Notes are stored as plain markdown files on disk under the data directory, organized by project. The TipTap editor supports both WYSIWYG rich-text and raw markdown modes, with live first-line titles. A sidekick panel surfaces file metadata, a generated table of contents, and local comments stored in a sidecar JSON file. (`3233d51`)
- Note files are now stored under human-readable project slugs instead of UUIDs, with a .project-id marker file keeping lookups stable across renames. On every autosave, the file is renamed to match its first-line title (with collision suffixes), and the client rekeys its caches and updates the URL without disturbing the editor caret. (`a8bcc24`)
- The Notes app now auto-selects a note on entry — restoring the last-opened note from localStorage, falling back to the first note found — and eliminates the empty 'select a note' state. A URL-store oscillation that caused an HTTP storm of alternating read and comment requests when switching notes was also fixed. (`8a87c08`, `06a6071`)
- Feedback gained a ZERO product option and a 'New Idea' button at the top of the feed. The chat model picker now uses the adapter-specific model list and hides entirely when the current generation mode has no selectable models. (`8698dff`)

## 3:52 PM — Notes polish, route-driven shell, and super-agent reset hardened

Notes received context menus, autosave-rename tree patching, and a fixed title style, while the app shell was refactored to derive the active app from the URL — eliminating a flicker when switching between Notes and Feedback.

- Right-clicking a note or folder in the Notes navigator now opens a context menu with rename, delete, reveal-in-folder, and new-note/new-folder actions, mirroring the Projects explorer UX. (`7ad8e66`)
- Autosave-driven renames now patch the notes tree in place synchronously instead of triggering a full loadTree round-trip, eliminating the brief highlight loss and sidekick info flash that occurred between the state update and the tree refresh. (`f1d283c`)
- The app shell now derives the active app synchronously from the URL pathname instead of mirroring it through a Zustand effect. This eliminated a one-render lag that allowed Notes' auto-select effect to fire a replace-navigate back into /notes/... when switching to Feedback, cancelling the app switch. (`3e4121f`)
- Super-agent session reset is now race-condition-free: each run is tracked with a CancellationToken and a monotonic generation counter. Reset cancels the in-flight /v1/messages stream mid-chunk and gates the cache write on the generation still matching, so any race past cancellation is discarded rather than overwriting the fresh session. (`30b71c5`)
- The build version, short commit SHA, build timestamp, and release channel are now baked into the interface bundle at build time and displayed in the Settings view. All CI workflows (stable, nightly, mobile nightly, Android, iOS) pass these values to the build so production releases always show the correct metadata. (`4b19d7b`)

## 4:53 PM — Shell background, keyboard shortcuts, and super-agent context utilization

The desktop wallpaper now shows through the top bar and taskbar in every app, sidekick previews close on Escape, and super-agents report real context utilization percentages in the UI.

- The configured desktop background now shows through the top bar and bottom taskbar in every app, not just the desktop app. Content surfaces (sidebar, middle panel, sidekick) remain opaque outside desktop mode, and a hydration flag prevents image-mode boots from briefly painting a broken or transparent shell before the image data loads. (`a441491`, `cb43789`, `809413e`)
- Pressing Escape now closes sidekick preview overlays and task/spec sidekick previews, making keyboard-driven workflows faster. (`809413e`, `2aa7464`)
- Super-agents now report real context utilization to the UI. Anthropic prompt-side token counts (input, cache creation, cache read) are captured from message_start.usage, accumulated cumulatively, and expressed as a percentage of the 200k Claude context window — fixing the blank N% indicator that previously showed for super-agents. (`01414ab`)
- Build version information is now also visible in the Team Settings general section, so operators can confirm the deployed build without navigating to the standalone Settings view. (`bbab5ed`)

## 5:35 PM — Test coverage locked in for Notes and Feedback

Every component in the Notes and Feedback apps now ships with a colocated test covering its load-bearing behavior, and the desktop shell background was stabilized against app-switch flashes.

- 66 new tests across 17 files cover the full Notes and Feedback component surfaces — editor modes, context menus, rename/delete modals, comment submission, filter trees, sidekick panels, and loading/error/empty states. Heavy dependencies (ZUI, TipTap, browser-db) are mocked per-file so assertions focus on each component's own decisions. (`2cf7e90`)
- The desktop shell background no longer flashes the wallpaper through when switching between apps that use an ActiveProvider wrapper (e.g. Process, Tasks). The opaque middle background was moved to a shell-level element that is never unmounted during app switches. (`05255bb`)

## 9:13 PM — Release Infrastructure: changelog generation hardened

The daily changelog generation script was significantly strengthened with rubric-based validation fixtures and relaxed count limits to improve output quality checks.

- The changelog generation script was overhauled with rubric fixtures (a known-good candidate and a known-bad generic candidate) and an automated test suite, making it easier to catch regressions in output quality. Validator count limits were also relaxed to reduce false rejections on legitimate multi-entry changelogs. (`d5180da`, `90f33e2`)

## Highlights

- Chat scroll jank eliminated via CSS anchor rewrite
- Feedback app launched with live API, votes, and product filtering
- Notes app added with TipTap editor, slug paths, and context menus
- Agent session reset made race-condition-free with cancellable runs
- Build version now visible in Settings and Team Settings on all platforms
- Release changelog tooling hardened with rubric fixtures

