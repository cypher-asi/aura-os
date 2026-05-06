# Native-feeling chrome, a reborn 3D chat flow, and side-by-side dev builds

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.468.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.468.1

Today's nightly reshapes how AURA feels as a desktop app — right-click menus, resize edges, and modal openings all behave more like native chrome — while chat picks up a proper image-to-3D pipeline, clickable session history, and a "+" for starting a fresh conversation. Under the hood, dev and stable builds can now coexist on the same machine without stepping on each other.

## 8:16 PM — In-app context menu replaces the WebView2 native menu

Right-clicking AURA chrome no longer leaks the Chromium Back/Refresh/Inspect menu; editable fields get a tailored Cut/Copy/Paste/Select All instead.

- A document-level handler suppresses the native WebView2/Chromium context menu across AURA chrome while still deferring to in-app menus (DesktopContextMenu, NotesEntryContextMenu, ProcessCanvas) that call preventDefault. (`52cdd47`)
- Inside inputs, textareas, and contenteditable regions, right-click now opens a compact in-app Cut / Copy / Paste / Select All menu so editing keyboards still work without giving up control of the chrome. (`52cdd47`)

## 8:38 PM — Easier top-edge window resize on Windows

The borderless main window now exposes a generous resize band along the top edge so dragging to resize no longer requires pixel-perfect aim.

- A Win32 subclass on the main HWND reports HTTOP/HTTOPLEFT/HTTOPRIGHT for any cursor inside a 10-logical-px band along the top edge, replacing tao's default ~4px frame and fixing the conflict with the floating titlebar pill. (`bc327be`)
- The hit-test becomes a no-op while maximized, re-reads DPI on every call for mixed-DPI setups, and falls through to DefSubclassProc so titlebar drag, side resize, and Chromium app-region behavior are unchanged. (`bc327be`)

## 8:43 PM — Modals open at their final size instead of jumping

A new shared hook holds modals closed until their async data is ready, eliminating the flicker on agent delete, marketplace hire, and tier upgrade.

- Introduced useDeferredModalOpen, which runs a prepare() step (cascade refresh, projects refresh, billing fetch), keeps the trigger disabled until it resolves, and only then opens the modal — with a 3000ms failsafe and stale-cycle guard. (`8cc4d0d`)
- Applied to DeleteAgentConfirmModal, HireProjectPickerModal, and TierSubscriptionModal so each opens once at its final width with stable copy; the cascade button label was also shortened to 'Delete (N projects)' so width no longer depends on binding count. (`8cc4d0d`)

## 8:45 PM — Dev and stable AURA can now coexist on one machine

A build-time channel selector gives dev builds their own data dir, ports, single-instance lock, and disabled updater so a cargo-run AURA never collides with the installed stable app.

- Added a Channel enum in aura-os-core as the single source of truth for per-channel identity: data dir (aura vs aura-dev), skills home, Windows mutex, window/menu title, embedded server port (19847/19848), standalone server port (3100/3101), harness sidecar port (19080/19081), and default harness URL port (8080/8081). (`718a47c`)
- The updater is compiled out in dev so a cargo-built shell can never silently replace itself with the stable installer, and the desktop crate disables default features on its core/server deps so stable packaging can't transitively pull in dev-channel. (`718a47c`)
- CI release workflows (desktop-validate, release-nightly, release-stable) and dev runner scripts were rewired so packaged builds use stable-channel while npm run dev / cargo run default to dev-channel on isolated ports (Vite 5174, mobile backend 3101). (`718a47c`)

## 9:04 PM — 3D chat mode returns with an image-first pipeline

The 3D pill is back in the chat mode selector, wired to derive its source image from the latest in-thread generation, and AURA 3D's image tab stops silently style-locking prompts.

- Re-enabled the 3D mode pill and rewired chat so 3D requests pull their source from the most recent successful generate_image tool result, surfaced as a 'Source for 3D' thumbnail above the textarea; the resolved-send pipeline carries sourceImageUrl through both live and queue-replay paths. (`15aa431`)
- Stopped appending the product-photography STYLE_LOCK_SUFFIX to user prompts in the AURA 3D app's Image tab so image generation behaves consistently with chat /image and /3d; stripStyleLock still cleans the suffix off legacy artifacts. (`5897137`)

## 9:26 PM — Chat 3D pipeline, clickable sessions, and a wave of UI polish

A long evening of interface work: chat 3D became a true two-step in-bar pipeline with an inline GLB viewer, chat sessions got titles and click-to-open, feedback gained a Details/Comments split, plus dozens of smaller fixes across context menus, theming, and release tooling.

- Reworked chat 3D as an in-bar two-step image→model pipeline with a removable pinned source thumb owned by chat-ui-store, then moved that thumb inline into the input row, allowed image-only sends to dispatch the model step, and replaced Model3DBlock's download link with an embedded lazy-loaded WebGLViewer plus auto-expand for generated 3D blocks. (`2b78e87`, `d5a5270`, `ffd4da5`, `69f1276`, `73fd9f9`)
- Agent Chats sidekick now auto-summarizes session titles via Haiku regardless of token-count gating, hides truly untitled rows, and rows are clickable — opening the historical transcript while staying inside the current app shell (agents stays in agents). A new '+' button on the chat input mode row starts a fresh session, scoped via a live-session store so the visible transcript belongs to the current SessionReady. (`42c97f6`, `ee49740`, `309f35b`, `9cdc19b`)
- Extended the new in-app context menu with a Copy entry for non-editable text selections in chat/markdown output and an image branch with Copy Image (re-encoding non-PNG sources to PNG via canvas, with a CORS fallback) so right-click works everywhere it should. (`90c31ed`, `5c24a16`)
- Feedback got a Notes-style sidekick split into Details and Comments tabs (driven by a sidekickTab slice on the feedback store), and every new submission is now tagged with the active app version — surfaced in the modal and as a vX.Y.Z chip on each feed card — via the existing metadata blob with no schema changes. (`b08b8d7`, `d0d49f8`)
- Theming and chrome polish: a new --color-modal-bg token gives modals a jet-black background in dark mode (with a paired Dark+Light editor in Settings → Appearance), the zui Button dim now sits at full opacity at rest and dims on hover, the titlebar Update pill renders at full accent saturation, and dialog wrappers no longer paint a stray focus ring on Shift/Tab. (`ba64c3d`, `a16bc58`, `dc169b9`, `4f87ed6`)
- Chat reading and composing improvements: explicit upward scroll intent now overrides streaming auto-follow and the post-stream image pin so the user's reading position holds, the empty-state suggestion chips were redesigned as a 2x2 segmented grid with a slower 6s input pulse, the bottom-bar environment slot stays width-stable while agent metadata loads, image attachments get breathing room, and the MODE row no longer text-selects on drag. (`5828b1b`, `c6cdeab`, `3edae9d`, `163267c`, `426e8cb`, `8d9acaf`, `4cf0bd6`, `9862578`, `d0ce2d5`)
- Project settings can now attach an Orbit repo from the edit modal (reusing OrbitRepoSection from the new-project flow) with the server's update_project handler calling orbit.ensure_repo when a brand-new owner+repo is supplied, and sidebar agent rows fall back to a 'New Agent' label so blank-named agents still have a recognizable identifier. (`73176b7`, `279ecdb`)
- Server-side, renamed CEO agents (e.g. 'CEO' → 'Maia') are now recognized via a canonical system_prompt prefix so post-rename logins no longer mint duplicate 'CEO' agents that the dedupe step couldn't reconcile. (`2da2e55`)
- Release pipeline fix: cargo packager 0.11.8 doesn't accept --no-default-features/--features, which was breaking CI; those flags are now applied via before-packaging-command in the desktop crate's Cargo.toml so packaged builds still pin to stable-channel. (`a457cab`)

## Highlights

- Native browser context menu replaced with in-app menus across editable, text, and image targets
- Chat 3D mode reborn as a two-step image→model flow with an embedded GLB viewer
- Dev and stable AURA builds run side-by-side with isolated data dirs and ports
- Windows top-edge resize is finally easy to grab
- Agent chat sessions are now clickable, auto-titled, and a '+' starts a fresh chat

