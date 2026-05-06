# Native chrome polish, dual build channels, and a rebuilt 3D chat flow

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.467.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.467.1

A dense nightly that reshaped how AURA feels as a desktop app: the browser context menu is gone in favor of a native-feeling in-app one, Windows users can finally grab the top edge to resize, and modals stop flickering as their data loads. Underneath, AURA now ships as separate dev and stable channels so contributors can run a `cargo` build alongside the installed app, and the chat 3D mode came back as a proper two-step image-then-model pipeline.

## 8:16 PM — Native browser context menu replaced with an in-app menu

Right-clicking AURA chrome no longer surfaces the WebView2/Chromium menu; editable fields get a compact Cut/Copy/Paste/Select All instead.

- A document-level listener now suppresses the native Back/Refresh/Inspect menu across AURA chrome while still deferring to in-app handlers like DesktopContextMenu, NotesEntryContextMenu, and ProcessCanvas via defaultPrevented. (`52cdd47`)
- Inputs, textareas, and contenteditable fields get a purpose-built in-app Cut / Copy / Paste / Select All menu so right-click editing keeps working without ceding the chrome to the browser. (`52cdd47`)

## 8:38 PM — Windows top-edge resize is no longer pixel-perfect

A Win32 WM_NCHITTEST subclass widens the borderless main window's top resize band to 10 logical pixels.

- On Windows, the top of the main window now reports HTTOP/HTTOPLEFT/HTTOPRIGHT across a 10 px band instead of tao's default ~4 px frame, so grabbing the edge to resize stops fighting the floating titlebar pill. (`bc327be`)
- The subclass installs after tao's so it runs first, becomes a no-op while maximized, and re-reads DPI on each hit-test to stay correct on mixed-DPI multi-monitor setups; titlebar drag, side resize, and Chromium app-region behavior are unchanged. (`bc327be`)

## 8:43 PM — Async-loading modals open once at their final size

A new useDeferredModalOpen hook fixes the jank where Delete, Hire, and Tier modals popped open and then resized as data arrived.

- Introduced a shared useDeferredModalOpen hook that runs a prepare() step (cascade refresh, project list fetch, billing subscription) with the trigger disabled, then opens the modal at its final state — with a 3000 ms failsafe and a cycle token that drops stale resolutions. (`8cc4d0d`)
- Wired the pattern into DeleteAgentConfirmModal (AgentList + AgentInfoPanel), the marketplace HireProjectPickerModal, and the TierSubscriptionModal, and shortened the cascade label to "Delete (N projects)" so the footer width stays stable across binding counts. (`8cc4d0d`)

## 8:45 PM — AURA splits into dev and stable build channels

A build-time channel selector lets a `cargo run` dev build coexist with the installed stable AURA without colliding on data dirs, ports, or single-instance locks.

- Added a Channel enum in aura-os-core that drives every per-channel identifier — data dir (`aura` vs `aura-dev`), skills home, Windows single-instance mutex, window/menu title, and the embedded server, standalone server, harness sidecar, and harness URL ports. (`718a47c`)
- The updater is disabled in dev builds so a `cargo run` shell can never silently replace itself with the stable installer, and the desktop crate disables default features on its core/server deps so a packaging build can't pull in dev-channel transitively. (`718a47c`)
- Release pipelines (desktop-validate, release-nightly, release-stable) and verify-desktop.mjs now build with `--no-default-features --features stable-channel`, while `cargo run` and the scripts/dev runners default to dev — Vite moves to 5174 and the mobile backend to 3101 so `npm run dev` doesn't bind on top of an installed AURA. (`718a47c`)

## 9:04 PM — 3D chat mode returns with an image-first pipeline

The 3D pill is back in the chat mode selector, wired to require an existing generated image as the source — and the standalone AURA 3D Image tab now sends prompts verbatim.

- Re-enabled 3D mode in chat: the input bar derives its source from the most recent successful generate_image tool result, surfaces it as a "Source for 3D" thumbnail, blocks Send with a switch-to-Image hint until a source exists, and dispatches via generate3dStream's URL form on both live and queue-replay paths. (`15aa431`)
- The AURA 3D app's Image tab no longer appends the product-photography STYLE_LOCK_SUFFIX, so its prompts behave consistently with /image and /3d; the constant is retained only so stripStyleLock can clean up legacy artifacts. (`5897137`)

## 9:26 PM — Two-step 3D pipeline, theme tokens, and chat empty-state polish

A long evening of interface work: chat 3D became a true in-bar two-step flow, modals went jet-black with per-mode overrides, the right-click menu learned to copy selected text, and a packager CI break was fixed.

- Reworked chat 3D as an in-bar image_step → model_step pipeline: replaced the "generate an image first" gate with a removable pinned source thumb owned by chat-ui-store, split the wire variant in resolve-send and the chat-stream hooks, and later dropped the style-lock suffix from the image step entirely. (`2b78e87`, `d5a5270`, `ffd4da5`)
- The native-menu override now shows a Copy-only menu when right-clicking inside a non-collapsed selection on static markdown or LLM output, so selecting and copying chat replies works again after the native menu was suppressed. (`90c31ed`)
- Modals adopt a new ZUI `--color-modal-bg` token (jet black in dark mode, elevated surface in light) without affecting dropdowns or cards, and Settings → Appearance → Custom colors gained a paired Dark + Light editor backed by an extended setToken(token, value, targetTheme?) API. (`ba64c3d`)
- Inverted ZUI Button dimming so unselected buttons sit at full opacity at rest and fade on hover, and explicitly opted the titlebar Update PillButton out of dimming so it renders at full accent saturation. (`a16bc58`, `dc169b9`)
- Redesigned the empty-chat state: four prompt-suggestion chips now float between the input bar and taskbar as a 2x2 grid with Lucide icons and proper gaps, and the empty-state input bar pulse slowed from 2s to 6s so it breathes instead of blinking. (`c6cdeab`, `3edae9d`, `163267c`)
- Sidebars now fall back to a "New Agent" label via a shared agentDisplayName helper for blank or whitespace-only names, the bottom-bar environment slot reserves space while agent metadata loads so siblings don't shift, the desktop right-click label was shortened to "Background", and dialog/modal wrappers no longer paint a stray focus ring on Shift-keypress. (`279ecdb`, `426e8cb`, `d0ce2d5`, `4f87ed6`, `4cf0bd6`)
- Project Settings can now attach an Orbit repo via the same create-default / create-custom / link-existing choices as the new-project flow, with the server's update_project handler calling orbit.ensure_repo when a fresh owner+repo is supplied. (`73176b7`)
- Server-side, a renamed bootstrap CEO is now recognized via a shared CEO_SYSTEM_PROMPT_PREFIX so post-rename logins stop minting duplicate "CEO" agents when the local stamp is missing. (`2da2e55`)
- Unblocked CI by removing `--no-default-features --features stable-channel` from the `cargo packager` invocations in desktop-validate, release-nightly, and release-stable — packager 0.11.8 rejects those as cargo-build flags, and the channel feature is already applied via the crate's before-packaging-command. (`a457cab`)
- Small AURA 3D fix-up: removed a stray "what" from the image prompt placeholder. (`9862578`)

## Highlights

- Native browser context menu replaced with in-app Cut/Copy/Paste
- Windows top-edge resize hit area widened to 10 px
- Dev and stable channels can now run side-by-side
- 3D chat mode rebuilt as in-bar image-then-3D pipeline
- Async modals open once at final size instead of janking
- Jet-black modal background with per-mode color override

