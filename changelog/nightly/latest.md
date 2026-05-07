# Native chrome polish, editable chat sessions, and a real Stable channel

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.473.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.473.1

A dense day for AURA: right-click finally feels native across the desktop, the chat sidekick gets a unified, editable session list with summarized titles, 3D chat lands as a true two-step image-then-model pipeline, and the release pipeline is rewired so installers actually ship the Stable channel binary. Plenty of Windows-specific polish too, from a wider top-edge resize zone to an embedded app icon.

## 8:16 PM — Right-click on AURA chrome stops opening the WebView2 menu

A document-level override replaces Chromium's native context menu with in-app behavior, restoring the desktop-OS feel.

- Right-clicking empty AURA chrome no longer surfaces the WebView2 Back/Refresh/Inspect menu; in-app handlers like DesktopContextMenu and NotesEntryContextMenu are still respected via defaultPrevented. (`52cdd47`)
- Inside inputs, textareas, and contenteditable fields, right-click now opens a compact in-app Cut / Copy / Paste / Select All menu so editing keeps working without the native chrome. (`52cdd47`)

## 8:38 PM — Easier top-edge window resizing on Windows

A Win32 subclass widens the resize hit zone along the top of the borderless main window so grabbing it no longer requires pixel-perfect aim.

- On Windows, the main window now reports HTTOP/HTTOPLEFT/HTTOPRIGHT across a 10-logical-pixel band along the top edge, leaving titlebar drag, side resizes, and Chromium app-region behavior untouched. (`bc327be`)
- The hit-test re-reads DPI on every event and becomes a no-op while the window is maximized, so behavior stays correct across mixed-DPI monitor setups. (`bc327be`)

## 8:43 PM — Modals wait for their data before opening

A new useDeferredModalOpen hook removes the jank where Delete Agent, Hire, and Tier modals would open empty and then reflow as data loaded.

- DeleteAgentConfirmModal, HireProjectPickerModal, and TierSubscriptionModal now keep their trigger button briefly disabled while data loads and only open once content is ready, with a 3000ms failsafe so the modal can't get stuck closed. (`8cc4d0d`)
- The cascade label on Delete Agent is shortened from 'Delete and remove from N projects' to 'Delete (N projects)' so the button width stays stable regardless of binding count. (`8cc4d0d`)

## 8:45 PM — Dev and stable AURA can now coexist on one machine

A new build-time channel selector gives the dev build its own data dir, ports, single-instance lock, and window identity so it no longer collides with an installed AURA.

- aura-os-core gains a Channel enum that drives every per-channel identifier — data dir (aura vs aura-dev), skills home, Windows mutex, window/menu title, embedded server port (19847/19848), standalone server (3100/3101), harness sidecar (19080/19081), and updater enablement. (`718a47c`)
- cargo run and the scripts/dev runners default to the dev channel, while release-stable and release-nightly workflows build with --no-default-features --features stable-channel so packaged installers stay on the stable identity. (`718a47c`)
- The in-app updater is disabled in dev builds so a cargo-built shell can never silently replace the installed Stable binary. (`718a47c`)

## 9:04 PM — 3D chat mode returns with an image-first flow

The 3D pill is back in the chat mode selector, wired to generate an image first and then convert it, mirroring the standalone AURA 3D app.

- The chat input derives its 3D source from the most recent successful generate_image tool result, surfaces it as a 'Source for 3D' thumbnail, and dispatches the request via generate3dStream's URL form; manual image attachments stay disabled until the proxy decode-and-forward path is fixed. (`15aa431`)
- The AURA 3D app's Image tab no longer appends the product-photography STYLE_LOCK_SUFFIX to user prompts, so image generation now behaves consistently with /image and /3d. (`5897137`)

## 9:26 PM — Editable chat sessions, native context menus, and Stable-channel installers

The evening's long batch reshapes the chat session model, finishes the native-feel context menu work, lands S3 image uploads, and fixes a string of Windows desktop and release-pipeline bugs.

- The agents and projects sidekicks now share one SessionsList: rows are clickable, default to the most recent session, get Haiku-summarized titles (with markdown stripped from the labels), and surface real server errors when right-click delete fails. State is consolidated into a single useSessionsListStore, fixing a 'Maximum update depth exceeded' crash that had blocked agent chat from loading at all. (`42c97f6`, `ee49740`, `309f35b`, `ced57ed`, `a3978b5`, `1aa47dd`, `fca8f39`)
- Historical sessions are now live, editable threads instead of read-only banners: a server-side session_id pin validates against the agent's session list, the URL becomes the source of truth via SessionReady, and the chat input '+' button starts a fresh session by clearing the URL. Several follow-ups stop the stream slot from flashing or wiping itself across session navigations and during agent switches. (`ea9c8e6`, `3cde64e`, `d15c267`, `fe37f65`, `c005adc`)
- Chat 3D is reworked into an in-bar two-step image-then-model pipeline: the source thumb moves inline with a removable pin, image-only sends now dispatch the 3D model step, and finished models render as a standalone WebGLViewer with a download link instead of a collapsed Block. The chat-only style-lock suffix is later removed entirely. (`2b78e87`, `d5a5270`, `ffd4da5`, `69f1276`, `73fd9f9`, `1cf3dcc`)
- The native-feel context menu work expands: right-clicking selected text in markdown output now offers Copy, right-clicking an image offers Copy Image (re-encoding to PNG via canvas when needed), and the desktop background entry is shortened to 'Background'. (`90c31ed`, `5c24a16`, `d0ce2d5`)
- Image attachments now upload to S3 via a new presign proxy endpoint: the chat input blocks send while uploads are in flight, dims uploading thumbnails, and message bubbles render images directly from their S3 source_url through both the live stream and history paths. (`acf466a`, `8492dee`, `a15dc03`, `b28b211`, `3b95dde`, `49df699`, `9725ce4`, `0070fe2`, `ea6f43f`, `c46a262`)
- Released installers finally ship as Stable: the build-app job now compiles aura-os-desktop with --no-default-features --features stable-channel, fixing 'AURA Dev' titles, the wrong data dir, dev ports, and a silently-disabled updater in shipped builds. An earlier flag mistake on cargo packager itself is also corrected. (`6122ad6`, `a457cab`)
- On Windows, the AURA orb icon is embedded into the .exe's PE resources via winresource so Start Menu, File Explorer, taskbar pin, and Alt+Tab fallbacks stop showing the generic executable glyph; ProductName/FileDescription metadata is set too. (`908d9d9`)
- The top-edge resize zone is widened to 14 logical pixels and now actually fires over the WebView2 child via a JS bridge that paints n-resize and IPCs into a new WinCmd::Resize that calls tao's drag_resize_window — the original Win32 subclass alone couldn't reach the WebView's client area. (`eef2a67`, `44c42f3`)
- Chat scrolling now respects user intent: an explicit upward scroll suspends auto-follow until the user reaches the very bottom again, so streaming output and the post-stream image pin can no longer yank the viewport back down mid-read. (`5828b1b`, `da50757`)
- The feedback app gets a Notes-style sidekick split into Details and Comments tabs, and every new submission is auto-tagged with the active app version (rendered as a small vX.Y.Z chip on each card) so support can correlate reports with the exact build. (`b08b8d7`, `d0d49f8`)
- A duplicate 'CEO' agent could appear after renaming the bootstrap CEO and re-logging in; the matcher now also recognizes the canonical 'You are the CEO SuperAgent' system-prompt prefix so renamed CEOs survive dedupe. (`2da2e55`)
- Smaller interface polish: a jet-black modal background token with per-mode override in Settings > Appearance, inverted ZUI button dim so rest is full opacity and hover fades, the titlebar Update pill at full accent saturation, a 'New Agent' fallback for nameless sidebar rows, suppressed focus rings on dialog wrappers, redesigned empty-state prompt suggestions with a slower input pulse, a stable bottom-bar environment slot during agent switches, attaching an Orbit repo from the project settings modal, mode pills that no longer steal focus from the textarea, terminal palette that follows theme toggles in real time and matches the surrounding pane, and breathing room around chat image attachments. (`ba64c3d`, `a16bc58`, `dc169b9`, `279ecdb`, `4f87ed6`, `c6cdeab`, `3edae9d`, `163267c`, `426e8cb`, `73176b7`, `4cf0bd6`, `9862578`, `9cdc19b`, `2c907e1`, `7c6ebf1`, `adb8a33`, `8d9acaf`)

## Highlights

- Native browser context menu replaced with in-app menus across editable text, selections, and images
- Chat sessions are now editable, summarized, and unified between the agents and projects sidekicks
- 3D chat mode rebuilt as an in-bar image-then-model pipeline with embedded GLB viewer
- Stable installers now actually ship the stable-channel binary, with proper Windows icons embedded
- New dev/stable channel split lets a cargo-built AURA run alongside the installed app

