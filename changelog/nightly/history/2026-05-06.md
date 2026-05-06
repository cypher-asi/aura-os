# Native-feeling chrome, a reworked 3D chat flow, and side-by-side dev builds

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.470.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.470.1

Today's nightly tightens the desktop OS feel with a fully in-app right-click menu and a more forgiving Windows resize edge, rebuilds chat's 3D mode around an inline image-then-model pipeline, and introduces dev/stable build channels so contributors can run a development AURA next to the installed app. A long evening batch also landed clickable chat session history, S3-backed attachment uploads, and a feedback sidekick split into Details and Comments.

## 8:16 PM — In-app context menu replaces the WebView2 native menu

Right-clicking AURA chrome no longer surfaces Chromium's Back/Refresh/Inspect menu; editable fields get a compact in-app Cut/Copy/Paste/Select All instead.

- A document-level listener now suppresses the native WebView2/Chromium menu across AURA chrome while still deferring to in-app handlers like DesktopContextMenu, NotesEntryContextMenu, and ProcessCanvas via defaultPrevented. (`52cdd47`)
- Inputs, textareas, and contenteditable regions get a built-in Cut / Copy / Paste / Select All menu so right-click editing keeps working without exposing browser internals. (`52cdd47`)

## 8:38 PM — Easier top-edge resizing on Windows

A Win32 subclass widens the borderless main window's top resize zone so the floating titlebar pill no longer steals the hit area.

- On Windows, the main HWND now reports HTTOP/HTTOPLEFT/HTTOPRIGHT across a 10 logical-pixel band along the top edge instead of tao's default ~4px, while leaving titlebar drag, side resize, and Chromium app-region behavior untouched. (`bc327be`)
- The subclass becomes a no-op when the window is maximized and re-reads DPI on each hit-test, so the wider grab zone stays consistent across mixed-DPI monitor setups. (`bc327be`)

## 8:43 PM — Modals stop flickering while their data loads

A new shared hook holds modals closed until their async prepare step resolves, eliminating the post-open jank in three high-traffic dialogs.

- useDeferredModalOpen runs a caller-supplied prepare() (cascade refresh, projects refresh, billing fetch), keeps the trigger button disabled until it resolves, and only then opens the modal — with a 3000ms failsafe and a cycle token to ignore stale resolutions. (`8cc4d0d`)
- Applied to Delete Agent (no more mid-render "Delete and remove from N projects" widening, now shortened to "Delete (N projects)"), the marketplace Hire project picker, and the Tier subscription modal so each opens once at its final size. (`8cc4d0d`)

## 8:45 PM — Dev and stable build channels can coexist on one machine

A new build-time channel selector gives cargo-run dev builds their own data dir, ports, single-instance lock, and window identity so they never collide with an installed stable AURA.

- A new Channel enum in aura-os-core is the single source of truth for per-channel identifiers: data dir (aura vs aura-dev), skills home (~/.aura vs ~/.aura-dev), Windows mutex, window/menu title, embedded desktop port (19847 vs 19848), standalone server port (3100 vs 3101), harness sidecar port (19080 vs 19081), default harness URL port (8080 vs 8081), and updater enablement (off in dev). (`718a47c`)
- cargo run and scripts/dev/* default to the dev channel via cargo's default feature, while desktop-validate, release-nightly, and release-stable workflows build with --no-default-features --features stable-channel; the desktop crate also disables default features on its core/server deps to prevent transitive dev-channel leakage. (`718a47c`)
- Dev script defaults move to dev-channel ports (Vite 5174, mobile backend 3101) so npm run dev and the mobile runner won't bind on top of an installed stable AURA. (`718a47c`)

## 9:04 PM — 3D chat mode returns with an image-first flow

The 3D pill is back in the chat mode selector, wired to generate an image and then convert it to 3D, while the standalone AURA 3D app stops appending its style-lock suffix to user prompts.

- Chat 3D mode now derives its source from the most recent successful generate_image tool result in the thread, surfaces it as a "Source for 3D" thumb above the textarea, blocks Send with a switch-to-Image hint until one exists, and dispatches via generate3dStream's URL form on both live and queue-replay paths. (`15aa431`)
- The AURA 3D app's Image tab now sends prompts verbatim instead of appending the product-photography STYLE_LOCK_SUFFIX, matching how /image and /3d already behave; the constant stays so stripStyleLock can clean it off legacy artifacts. (`5897137`)

## 9:26 PM — Inline 3D pipeline, S3 attachments, and a richer chat-history sidekick

A long evening batch reshaped chat 3D into an inline two-step pipeline, made session history clickable and self-titling, moved attachments to presigned S3 uploads, and added a Details/Comments split to the feedback sidekick — alongside a wave of polish across context menus, modals, theming, and project settings.

- Chat 3D was reworked into an in-bar two-step image→model pipeline: a removable pinned source thumb (now docked inline in the input row's start slot) replaces the gating hint, sendMessage can dispatch the model step on image-only sends, and Model3DBlock embeds a lazy-loaded WebGLViewer with a download link and auto-expands on completion. Style-lock was also removed from the chat 3D image step. (`2b78e87`, `d5a5270`, `ffd4da5`, `69f1276`, `73fd9f9`)
- Agent Chats sidekick rows are now clickable and self-titling: the token-count gate on Haiku summaries is gone, untitled rows are hidden until a title arrives, and clicking a row opens the historical transcript while staying inside the current app shell. A new "+" button on the input mode row starts a fresh session (scoped via a live-session store), and the sidekick auto-refreshes when sessions appear elsewhere. (`42c97f6`, `ee49740`, `309f35b`, `9cdc19b`)
- Chat attachments now flow through a new server presign endpoint and a frontend upload module: files are pushed to S3 via presigned URLs, Send is blocked while uploads are in-flight (thumbnails dim), and MessageAttachment grew a source_url field so the streaming/persist paths can carry the S3 URL through. A stale-closure fix and a next-tick deferral keep the upload start aligned with the attachment ref. (`acf466a`, `8492dee`, `a15dc03`, `b28b211`, `3b95dde`, `49df699`, `9725ce4`, `0070fe2`)
- Context menu coverage expanded: selected non-editable text (chat / markdown output) now gets a Copy-only menu, and right-clicking any image opens a standard menu with a Copy Image action that re-encodes via canvas to PNG when needed. The desktop background label was shortened to "Background". (`90c31ed`, `5c24a16`, `d0ce2d5`)
- Feedback got a Notes-style Details/Comments split in the sidekick (driven by a sidekickTab store slice) and every new submission is now tagged with the active app version, surfaced as a "Tagged with version X" line in the modal and a vX.Y.Z chip on each feed card — carried via the existing metadata blob with no schema migration. (`b08b8d7`, `d0d49f8`)
- Theming and chrome polish: a new --color-modal-bg ZUI token paints modals jet-black in dark mode (with a paired Dark+Light editor in Settings → Appearance), the base Button's dim was inverted so rest is full opacity and hover dims, the titlebar Update pill now renders at full accent saturation, focus rings no longer paint around modal/dialog wrappers, and the empty-state chat suggestions were rebuilt as a 2×2 grid of icon chips with a slower 6s input-bar pulse. (`ba64c3d`, `a16bc58`, `dc169b9`, `4f87ed6`, `c6cdeab`, `3edae9d`, `163267c`, `4cf0bd6`, `8d9acaf`, `9862578`)
- Reliability fixes around agents and chat reading position: a renamed bootstrap CEO is now recognized via its canonical system-prompt prefix so re-login no longer mints duplicate "CEO" agents, sidebar rows fall back to a "New Agent" label when names are blank, the bottom-bar environment slot stays width-stable while agent metadata loads, and the chat list respects explicit user scroll-up over both the streaming tail-pin and the post-stream image-pin window. (`2da2e55`, `279ecdb`, `426e8cb`, `5828b1b`)
- Project Settings can now attach an Orbit repo from the edit modal using the same create-default / create-custom / link-existing choices as the new-project flow, and the server's update_project handler calls orbit.ensure_repo when a brand-new owner+repo is attached. (`73176b7`)
- Release-pipeline fix: cargo packager invocations dropped the unsupported --no-default-features / --features flags (the stable-channel feature is already wired via before-packaging-command in the desktop crate), unblocking nightly and stable workflows that were failing with "unexpected argument". (`a457cab`)

## Highlights

- Native browser context menus replaced with in-app Cut/Copy/Paste, selection copy, and image copy
- Chat 3D mode reworked into an inline image-then-model pipeline with embedded GLB viewer
- Dev and stable build channels can now run side-by-side on one machine
- Chat session history is clickable, auto-titled, and a new "+" starts a fresh session
- Attachments now upload to S3 via presigned URLs before send

