# Desktop chrome polish, chat 3D revival, and dev/stable channel split

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.469.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.469.1

A dense day of platform work: AURA's desktop chrome stops feeling like a browser, chat regains a working 3D pipeline with an embedded GLB viewer, and the codebase grows a clean dev/stable channel split so contributors can run a cargo build alongside the installed app. Smaller threads landed across modals, sidebars, feedback, and S3-backed attachment uploads.

## 8:16 PM — Native WebView2 context menu replaced with AURA-owned menus

Right-clicking AURA chrome no longer leaks the Chromium menu; editable fields get a compact in-app Cut/Copy/Paste/Select All instead.

- Installed a document-level context-menu interceptor that defers to in-app handlers (DesktopContextMenu, NotesEntryContextMenu, ProcessCanvas) and otherwise cancels the native WebView2 menu, restoring the desktop-OS feel. (`52cdd47`)
- Inside inputs, textareas, and contenteditables, the override now renders a compact in-app Cut / Copy / Paste / Select All so right-click editing keeps working without surrendering the chrome. (`52cdd47`)

## 8:38 PM — Easier top-edge window resize on Windows

A Win32 subclass widens the top resize zone on the borderless Windows main window so users no longer need pixel-perfect aim under the floating titlebar pill.

- Hit-tests within a 10-logical-pixel band along the top edge now report HTTOP/HTTOPLEFT/HTTOPRIGHT, while titlebar drag, side resize, and Chromium app-region behavior fall through unchanged. The subclass disables itself when maximized and re-reads DPI per hit-test for mixed-DPI setups. (`bc327be`)

## 8:43 PM — Modals wait for their data before opening

A new shared hook eliminates the jank where confirm and subscription modals popped open and then resized as async data arrived.

- Introduced useDeferredModalOpen, which runs a prepare() step (cascade refresh, project list fetch, billing subscription fetch), keeps the trigger disabled while loading, and only flips the modal open once data resolves — with a 3s failsafe and stale-resolution guards. (`8cc4d0d`)
- Applied the pattern to the Delete Agent confirm modal (also shortening the cascade label to a width-stable "Delete (N projects)"), the Marketplace Hire project picker, and the Tier subscription modal, each of which previously flickered between loading and final state. (`8cc4d0d`)

## 8:45 PM — Dev and stable build channels can coexist on one machine

A new aura-os-core channel selector gives dev builds their own data dir, ports, single-instance lock, and window identity so a cargo-built AURA can run next to the installed stable app.

- Added a Channel enum that owns every per-channel identifier — data dir (aura vs aura-dev), skills home, Windows mutex, window/menu title, embedded desktop server port (19847/19848), standalone server port (3100/3101), harness sidecar (19080/19081), default harness URL port, and updater enablement (off in dev so a cargo-built shell can never silently replace the installed stable app). (`718a47c`)
- Wired the release pipeline (desktop-validate, release-nightly, release-stable) and cargo packager to build with --no-default-features --features stable-channel, while cargo run and scripts/dev/* default to the dev channel; Vite and the mobile backend dev defaults moved to 5174/3101 to avoid colliding with installed stable. (`718a47c`)

## 9:04 PM — Chat 3D mode comes back with an image-first flow

The 3D pill returns to the chat mode selector, with a flow that derives its source from the most recent generated image in the thread.

- Re-enabled 3D mode in the chat input bar: a "Source for 3D" thumbnail surfaces the latest successful generate_image result, Send is gated until one exists, and the 3D request now flows through generate3dStream's URL form on both live and queue-replay paths. (`15aa431`)
- Stopped appending the product-photography STYLE_LOCK_SUFFIX in the AURA 3D app's Image tab so its prompts behave consistently with /image and /3d, while keeping the constant available for cleaning up legacy artifacts. (`5897137`)

## 9:26 PM — Two-step chat 3D pipeline, S3 attachment uploads, and chat session navigation

A long evening of polish: the chat 3D flow becomes an in-bar two-step pipeline with an embedded GLB viewer, attachments move to S3 via presigned URLs, agent sessions get summarized clickable rows, and a wave of UI fixes lands across context menus, modals, theming, and the chat input.

- Reworked chat 3D as an in-bar two-step image-then-model pipeline: a removable pinned source thumb owned by chat-ui-store replaces the "generate an image first" gate, the wire variant splits into image_step and model_step, and only the image step carries STYLE_LOCK_SUFFIX. A follow-up moved the source thumb inline into the input row, allowed image-only sends to dispatch the model step, and replaced Model3DBlock's download link with a lazy-loaded WebGLViewer; generated 3D blocks now also auto-expand instead of rendering as a collapsed header. (`2b78e87`, `d5a5270`, `ffd4da5`, `69f1276`, `73fd9f9`)
- Added an S3 presign proxy on the server, a frontend upload module, and wired chat attachments through presigned URLs end-to-end: Send is blocked while uploads are in flight, uploading thumbnails dim, a stale-closure bug in the update callback was fixed, and MessageAttachment grew a source_url field for persisted S3 references. (`acf466a`, `8492dee`, `a15dc03`, `b28b211`, `3b95dde`, `49df699`, `9725ce4`)
- Agent Chats sidekick now summarizes session titles via Haiku without the lagging token-count gate, hides truly untitled rows instead of showing placeholder "New chat", and makes rows clickable to open the historical transcript — staying inside the agents app shell rather than swapping to the projects shell. A new "+" button on the chat input mode row starts a fresh session (distinct from the soft RotateCcw reset), with a live-session store scoping the visible transcript and a sessions-list version counter auto-refreshing the sidekick. (`42c97f6`, `ee49740`, `309f35b`, `9cdc19b`)
- Right-click handling and theming got a second pass: selected non-editable text now gets a Copy-only menu, right-clicking an image surfaces a Copy Image action that re-encodes via canvas when needed, and the desktop background menu label was shortened to "Background". A new --color-modal-bg ZUI token gives modals a jet-black dark-mode background editable per-mode in Settings > Appearance, and the Button dim semantics were inverted so rest is full opacity and hover dims (with the titlebar Update pill opting out for full accent saturation). (`90c31ed`, `5c24a16`, `d0ce2d5`, `ba64c3d`, `a16bc58`, `dc169b9`)
- Reliability and polish around chat and agents: the server now recognizes a renamed CEO via its system-prompt prefix to stop minting duplicate "CEO" agents on login; sidebar rows fall back to "New Agent" when a name is blank; modal/dialog wrappers no longer paint a stray focus ring on Shift; the bottom-bar environment slot stays width-stable while agent metadata loads; user scroll-up intent now overrides chat auto-follow; and the empty-state prompt suggestions were redesigned as a 2x2 grid of icon chips with a slower 6s input-bar pulse. (`2da2e55`, `279ecdb`, `4f87ed6`, `426e8cb`, `5828b1b`, `c6cdeab`, `3edae9d`, `163267c`, `4cf0bd6`, `9862578`, `8d9acaf`)
- Feedback got two upgrades: new submissions are tagged with the active app version (rendered as a vX.Y.Z chip on each card via the existing activity_events metadata, so no schema migration was needed), and the sidekick now splits into Notes-style Details and Comments tabs driven by a sidekickTab slice on the feedback store. Project settings also gained the create-default / create-custom / link-existing Orbit repo flow from the new-project path, with the server's update_project handler calling orbit.ensure_repo when a brand-new owner+repo is attached. (`d0d49f8`, `b08b8d7`, `73176b7`)
- Release CI fix: dropped the unsupported --no-default-features and --features flags from the cargo packager invocation in desktop-validate, release-nightly, and release-stable workflows — packaging picks up stable-channel via Cargo.toml's before-packaging-command instead, unblocking nightly builds. (`a457cab`)

## Highlights

- Native browser context menu replaced with in-app menus
- Chat 3D mode rebuilt as a two-step image-then-model pipeline with embedded GLB viewer
- Dev and stable channels can now run side-by-side
- Windows top-edge resize hit area widened
- S3 presigned upload path added for chat attachments

