# Native desktop polish, chat 3D pipeline, and S3 attachment uploads

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.472.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.472.1

A dense nightly that reshapes how AURA feels as a desktop app — taking over the right-click menu, fixing Windows top-edge resize, and splitting dev from stable builds — while rebuilding chat 3D mode end-to-end and wiring image attachments through S3 presigned uploads. Feedback, agent sessions, and a handful of UI papercuts also got meaningful attention.

## 8:16 PM — AURA takes over the right-click menu

The Chromium/WebView2 native context menu no longer leaks through AURA's chrome, replaced by an in-app editing menu where it matters.

- Right-clicking empty AURA chrome no longer pops the WebView2/Chromium menu (Back, Refresh, Inspect, Save as…); a single document-level listener defers to in-app handlers like DesktopContextMenu and otherwise cancels the native menu, restoring the desktop OS feel. (`52cdd47`)
- Inside inputs, textareas, and contenteditable fields, right-click now shows a compact in-app Cut / Copy / Paste / Select All so text editing keeps working without ceding control of the chrome. (`52cdd47`)

## 8:38 PM — Forgiving top-edge window resize on Windows

Grabbing the top edge of the borderless main window no longer requires pixel-perfect aim.

- A Win32 subclass on the main HWND now reports HTTOP/HTTOPLEFT/HTTOPRIGHT across a 10‑logical‑px band along the top edge instead of tao's default ~4px, so resize from the top works reliably alongside the floating titlebar pill. The subclass becomes a no-op when maximized, re-reads DPI per hit-test for mixed-DPI setups, and leaves titlebar drag, side resize, and Chromium app-region behavior untouched. (`bc327be`)

## 8:43 PM — Modals open at their final size instead of janking

A new shared hook delays opening async-loading modals until their data is ready, eliminating the post-open relayout flicker.

- Introduced useDeferredModalOpen, which keeps the modal closed and disables its trigger until a prepare() promise resolves (with a 3000ms failsafe), then opens at the final size. Stale resolutions from earlier open cycles are ignored via an internal cycle token. (`8cc4d0d`)
- Applied to three high-visibility surfaces: the Delete Agent confirm modal (cascade label shortened to "Delete (N projects)" so width is stable), the marketplace Hire project picker (no more in-modal spinner), and the Tier subscription modal (now reads from the billing store instead of fetching on open). (`8cc4d0d`)

## 8:45 PM — Dev and stable AURA can run side-by-side

A new build-time channel selector keeps a cargo-built dev AURA from colliding with an installed stable AURA on the same machine.

- Added a Channel enum in aura-os-core as the single source of truth for per-channel identifiers — data dir (aura vs aura-dev), skills home, Windows single-instance mutex, window/menu title, embedded desktop server port (19847/19848), standalone server port (3100/3101), harness sidecar port (19080/19081), default harness URL port, and updater enablement (off in dev so cargo builds can never silently replace the installed stable shell). (`718a47c`)
- cargo run and the scripts/dev/* runners default to dev-channel via cargo's default feature; the release-stable, release-nightly, and desktop-validate workflows build with --no-default-features --features stable-channel, and the desktop crate disables default features on its core/server deps so a packaging build can't pull in dev-channel transitively. Dev script ports also moved off stable defaults (Vite 5174, mobile backend 3101). (`718a47c`)

## 9:04 PM — Chat 3D mode returns with an image-first flow

The 3D pill is back in the chat mode selector, wired to the same image-then-3D path as the standalone AURA 3D app.

- Re-enabled 3D chat mode and rewired it so the only valid path is generate an image first, then convert it to 3D. The input bar derives its source from the most recent successful generate_image tool result, surfaces it as a "Source for 3D" thumbnail above the textarea, blocks Send with a switch-to-Image hint until one exists, and dispatches via generate3dStream's URL form with sourceImageUrl carried through both live and queue-replay paths. (`15aa431`)
- Stopped appending the product-photography STYLE_LOCK_SUFFIX to user prompts in the AURA 3D app's Image tab so it now matches /image and /3d behavior; stripStyleLock is retained to clean the suffix off legacy artifacts. (`5897137`)

## 9:26 PM — Chat 3D pipeline, S3 attachment uploads, sessions sidekick, and theme work

The day's longest stretch reshaped chat 3D mode into a real two-step pipeline, moved image attachments to S3 presigned uploads, made the agent Chats sidekick clickable, and landed a wave of theming and reliability fixes.

- Reworked chat 3D as an in-bar two-step image→model pipeline: a removable pinned source thumb (now inline in the input row's start slot) replaces the "generate an image first" gate, the wire variant splits into image_step / model_step, image-only sends are allowed, and Model3DBlock now embeds a lazy-loaded WebGLViewer with a download link instead of a bare GLB link. Auto-expanded generate_3d_model so freshly generated models render their viewer on first paint. (`2b78e87`, `d5a5270`, `ffd4da5`, `69f1276`, `73fd9f9`)
- Image attachments now flow through S3: a new presign proxy endpoint and upload_routes() on the server, a frontend upload API, and a MessageAttachment.source_url field on the protocol. The chat input wires presigned uploads in, blocks Send while uploads are in progress, dims uploading thumbnails, and renders uploaded images from the S3 URL in message bubbles. Includes follow-up fixes for stale ref closures and threading source_url through history and stream paths. (`acf466a`, `8492dee`, `a15dc03`, `b28b211`, `3b95dde`, `49df699`, `9725ce4`, `0070fe2`, `ea6f43f`, `c46a262`)
- The agent Chats sidekick is now usable: rows are clickable and open the historical transcript, untitled sessions get an immediate Haiku title attempt (the lagging token-count gate is gone) and stay hidden until they have a real label, a new "+" button on the input mode row starts a fresh session distinct from the soft reset, and a sessions-list version counter auto-refreshes the sidekick when sessions are created elsewhere. Clicks from the agents app stay inside the agents shell instead of jumping to the projects shell. (`42c97f6`, `ee49740`, `309f35b`, `9cdc19b`)
- Extended the right-click override with a Copy action for non-editable text selections in chat/markdown output and a Copy Image action that re-encodes to PNG via canvas when needed, and shortened the desktop background label to "Background". (`90c31ed`, `5c24a16`, `d0ce2d5`)
- Theme and chrome polish: a new --color-modal-bg ZUI token paints modals jet-black in dark mode (with a paired Dark+Light editor in Settings → Appearance → Custom colors), the base Button now sits at full opacity at rest and dims on hover, and the titlebar Update pill renders at full accent saturation again. Focus-visible rings no longer paint around modal/dialog wrappers when Chromium flips into keyboard-modality. (`ba64c3d`, `a16bc58`, `dc169b9`, `4f87ed6`)
- New chat empty-state suggestions render as a 2x2 segmented row of icon-prefixed chips with proper gaps, the input bar's empty-state border pulse slowed from 2s to 6s, the bottom-bar Local/Remote slot stays width-stable while agent metadata loads, image-attachment strips got breathing room, mode-row labels are no longer text-selectable, and sidebar agent rows fall back to "New Agent" when names are missing. (`c6cdeab`, `3edae9d`, `163267c`, `426e8cb`, `8d9acaf`, `4cf0bd6`, `9862578`, `279ecdb`)
- Chat scrolling now respects user intent: explicit upward wheel/touch/keyboard scroll is detected in useScrollAnchorV2 and gates both the streaming tail-pin layout effect and the 6-second post-stream image pin, so reading older messages mid-stream isn't yanked back to the bottom. (`5828b1b`)
- Feedback got a Notes-style sidekick split into Details and Comments tabs (driven by a sidekickTab slice on the feedback store), and every new submission is now tagged with the active app version — surfaced as "Tagged with version X" in the modal and a vX.Y.Z chip on each card — riding the existing activity_events metadata blob with no schema migration. (`b08b8d7`, `d0d49f8`)
- Project Settings can now attach an Orbit repo from the edit modal — reusing OrbitRepoSection from the new-project flow — and update_project on the server calls orbit.ensure_repo when a request attaches a brand-new owner+repo so the repo actually gets provisioned. (`73176b7`)
- Bootstrap CEO recognition now matches on the canonical system_prompt prefix in addition to the local stamp and exact name+role, so renamed CEOs from before the stamping fix no longer cause a duplicate "CEO" agent to be minted on next login. (`2da2e55`)
- Release pipeline fix: dropped --no-default-features and --features from the cargo packager invocation in desktop-validate, release-nightly, and release-stable workflows; cargo-packager 0.11.8's CLI rejected those as cargo-build flags, and the stable-channel feature is already wired via before-packaging-command, unblocking CI. (`a457cab`)

## Highlights

- AURA now owns the right-click menu across the app
- Chat 3D mode shipped as a real two-step image→model pipeline with inline GLB viewer
- Dev and stable AURA builds can finally run side-by-side
- Image attachments now upload to S3 via presigned URLs
- Windows top-edge resize is forgiving again

