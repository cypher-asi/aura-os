# Native chrome polish, 3D chat returns, and dev/stable channel split

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.471.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.471.1

A dense night of desktop-feel work: AURA stops feeling like a web view with a new context-menu system, the chat 3D pipeline comes back as a real two-step image-to-model flow with an embedded GLB viewer, and a build-time channel split lets developers run a dev AURA next to the installed stable one without collisions. Smaller fixes tighten modals, sidebars, agent sessions, and S3 attachment uploads.

## 8:16 PM — In-app context menu replaces the WebView2 native menu

Right-clicking AURA chrome no longer surfaces Chromium's Back / Refresh / Inspect menu, restoring the desktop-OS feel.

- A document-level override suppresses the native context menu everywhere, defers to in-app handlers like DesktopContextMenu and NotesEntryContextMenu via defaultPrevented, and replaces it with a compact Cut / Copy / Paste / Select All menu inside editable fields. (`52cdd47`)

## 8:38 PM — Easier top-edge window resize on Windows

The borderless main window now has a forgiving resize zone along its top edge.

- A Win32 subclass on the main HWND reports HTTOP/HTTOPLEFT/HTTOPRIGHT within a 10-logical-pixel band along the top edge so resizing no longer requires pixel-perfect aim around the floating titlebar pill, while titlebar drag, side resize, and Chromium app-region behavior stay intact and the override no-ops when maximized and re-reads DPI per hit-test. (`bc327be`)

## 8:43 PM — Modals wait for their data before opening

Confirm and subscription modals stop janking from spinner to final layout as bindings load.

- A new useDeferredModalOpen hook keeps modals closed (with a disabled trigger and a 3000ms failsafe) until prepare() resolves, eliminating mid-open relayout in the agent delete confirm, marketplace Hire picker, and Tier subscription modals. (`8cc4d0d`)
- The agent delete cascade label is shortened to "Delete (N projects)" so the footer button width stays stable across binding counts. (`8cc4d0d`)

## 8:45 PM — Dev and Stable channels can run side-by-side

A new build-time channel selector keeps a cargo-built dev AURA from colliding with the installed stable AURA.

- A new aura-os-core::channel module is the single source of truth for per-channel data dirs (aura vs aura-dev), skills home, Windows single-instance mutex, window/menu title, embedded desktop server port (19847/19848), standalone server port (3100/3101), harness sidecar port (19080/19081), default harness URL port, and updater enablement (off in dev so a cargo build can never silently install over stable). (`718a47c`)
- Release pipelines (desktop-validate, release-nightly, release-stable) now build with --no-default-features --features stable-channel, while cargo run and the dev runner scripts default to the dev channel and bind on dev ports (Vite 5174, mobile backend 3101). (`718a47c`)

## 9:04 PM — 3D chat mode returns with an image-first flow

The 3D pill is back in the chat mode selector, wired to generate an image first and then convert it to 3D.

- Chat 3D mode derives its source from the most recent successful generate_image tool result, surfaces a "Source for 3D" thumbnail above the textarea, blocks Send with a switch-to-Image hint until one exists, and dispatches via generate3dStream's URL form through both the live and queue-replay send paths. (`15aa431`)
- The standalone AURA 3D app's Image tab no longer appends the product-photography STYLE_LOCK_SUFFIX to user prompts, so image generation behaves consistently with /image and /3d (the constant is kept so stripStyleLock can clean legacy artifacts). (`5897137`)

## 9:26 PM — Chat sessions, S3 uploads, and a wave of UI polish

The largest batch of the night reworked chat 3D into a true two-step pipeline, added S3-backed attachment uploads, restructured agent chat sessions, refreshed the feedback sidekick, and corrected a long tail of interaction details.

- Chat 3D was rebuilt as an in-bar two-step image-then-3D pipeline with a removable pinned source thumb owned by chat-ui-store, split image_step / model_step wire variants, an inline thumb in the input row's start slot, image-only send support, and an embedded WebGLViewer (lazy-loaded) replacing the old "Download GLB" link, with auto-expand for generated 3D model blocks. (`2b78e87`, `d5a5270`, `ffd4da5`, `69f1276`, `73fd9f9`)
- Chat attachments now upload directly to S3 via a new presign proxy endpoint and frontend upload module: Send is blocked while uploads are in flight, uploading thumbnails dim, message bubbles render from the S3 URL, and a new source_url field on MessageAttachment carries the uploaded URL through the protocol. (`acf466a`, `8492dee`, `a15dc03`, `b28b211`, `3b95dde`, `49df699`, `9725ce4`, `0070fe2`, `ea6f43f`)
- Agent chat sessions got real titles and navigation: the Chats sidekick now always attempts a Haiku summary (untitled rows are hidden until one lands), rows are clickable into the historical transcript, a new "+" button starts a fresh session and scopes the live transcript to it via a new live-session store, and the sidekick auto-refreshes when sessions are created elsewhere — with click handling kept inside the agents app shell. (`42c97f6`, `ee49740`, `309f35b`, `9cdc19b`)
- The right-click override learned two new surfaces: a Copy menu for selected non-editable text (chat / markdown output) and a Copy Image action on any <img> that writes the bitmap to the OS clipboard via ClipboardItem, re-encoding to PNG when needed. The desktop background context-menu label was also shortened to "Background". (`90c31ed`, `5c24a16`, `d0ce2d5`)
- Feedback got two upgrades: every new submission is tagged with the active app build (rendered as a vX.Y.Z chip on feed cards) via a metadata.appVersion field on activity_events, and the sidekick splits into Notes-style Details and Comments tabs driven by a new sidekickTab store slice. (`d0d49f8`, `b08b8d7`)
- Theme and chrome polish: a new --color-modal-bg token paints modals jet-black in dark mode (with a paired Dark+Light editor in Appearance settings), the zui Button dim timing was inverted so unselected buttons sit at full opacity at rest and fade on hover, the titlebar Update pill now renders at full accent saturation, focus-visible outlines no longer paint around dialog/modal wrappers, and the mode-selector row no longer text-selects on drag. (`ba64c3d`, `a16bc58`, `dc169b9`, `4f87ed6`, `4cf0bd6`)
- Chat reading and composition got steadier: an explicit upward-scroll signal in useScrollAnchorV2 now overrides streaming tail-pin and the post-stream image-pin window so user scroll-up sticks; the bottom-bar environment slot reserves space while agent metadata loads to stop "/ for commands" from snapping; user image attachments get breathing room; and the empty-state input bar pulse slows from 2s to 6s with a redesigned 2x2 segmented suggestion-chip row. (`5828b1b`, `426e8cb`, `8d9acaf`, `c6cdeab`, `3edae9d`, `163267c`, `9862578`)
- Project settings can now attach an Orbit repo from the edit modal (mirroring the new-project flow, with the server's update_project handler calling orbit.ensure_repo when a brand-new owner+repo is provided), and unnamed agents render a shared "New Agent" placeholder across AgentList, the project explorer, and the Tasks tree. (`73176b7`, `279ecdb`)
- Server-side, renamed bootstrap CEO agents are now recognized via the canonical "You are the CEO SuperAgent" system-prompt prefix, so logging in after a CEO rename no longer mints a duplicate "CEO" agent for users created before the local-stamp fix. (`2da2e55`)
- Release CI was unblocked by dropping --no-default-features and --features from the cargo packager invocation across desktop-validate, release-nightly, and release-stable; cargo-packager 0.11.8 doesn't accept those flags, and the stable-channel feature is already applied via before-packaging-command. (`a457cab`)

## Highlights

- Native browser context menu replaced across the app
- Chat 3D mode rebuilt as image-then-model with inline GLB viewer
- Dev and Stable channels can now coexist on one machine
- S3 presigned uploads wired into chat attachments
- Windows top-edge resize hit area widened

