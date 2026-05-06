# Native desktop chrome, a rebuilt 3D chat flow, and dev/stable channel split

- Date: `2026-05-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.466.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.466.1

Today's nightly reshapes how AURA feels as a desktop app — taking back the right-click menu, fixing a long-standing Windows resize annoyance — and lands a major rework of chat's 3D mode into an in-bar two-step pipeline. Underneath, the project also gained side-by-side dev and stable build channels so contributors can run a cargo build of AURA next to their installed copy without collisions.

## 8:16 PM — Desktop chrome reclaims right-click and the Windows top resize edge

Two foundational desktop polish fixes: AURA now owns the right-click menu instead of WebView2, and the borderless window's top resize zone no longer demands pixel-perfect aim.

- Right-clicking empty AURA chrome no longer pops the WebView2/Chromium menu (Back, Refresh, Inspect, …); a document-level override defers to in-app menus where present and otherwise replaces the native menu with a compact in-app Cut / Copy / Paste / Select All inside text fields. (`52cdd47`)
- On Windows, a Win32 WM_NCHITTEST subclass widens the top resize hit zone from the OS default ~4 px to a 10 logical-px band, so grabbing the top edge of the borderless window works reliably without fighting the floating titlebar pill — and stays correct across mixed-DPI monitors and while maximized. (`bc327be`)

## 8:43 PM — Confirm and subscription modals stop flickering on open

A new shared deferred-open hook eliminates the jank where modals popped up and then visibly reshaped as their async data arrived.

- useDeferredModalOpen now keeps Delete-Agent, marketplace Hire, and Tier subscription modals closed (with their trigger button briefly disabled) until cascade bindings, project lists, or billing data resolve, so each modal opens once at its final size and copy — with a 3000ms failsafe and stale-cycle guards. (`8cc4d0d`)
- Delete-agent's footer label is shortened to "Delete (N projects)" so its width stays stable regardless of how many bindings the agent has. (`8cc4d0d`)

## 8:45 PM — Dev and stable AURA can now run side-by-side

A new build-time channel selector lets a cargo-built dev AURA coexist with an installed stable AURA on the same machine without colliding on data, ports, or single-instance locks.

- A new Channel enum in aura-os-core is the single source of truth for per-channel identifiers — data dir (aura vs aura-dev), skills home, Windows single-instance mutex, window/menu title, embedded server (19847/19848), standalone server (3100/3101), harness sidecar (19080/19081), default harness URL port, and updater enablement (off in dev so a cargo build can never silently swap itself for the stable installer). (`718a47c`)
- cargo run and the scripts/dev runners default to dev-channel via cargo's default feature; release pipelines (desktop-validate, release-nightly, release-stable) build with stable-channel, and the desktop crate disables default features on its core/server deps so a packaging build can't pull dev-channel in transitively. (`718a47c`)
- Dev script ports moved to dev-channel defaults (Vite 5174, mobile backend 3101) so npm run dev no longer binds on top of an installed stable AURA. (`718a47c`)

## 9:04 PM — 3D chat mode returns with an image-first send flow

The 3D pill is back in the chat mode selector, wired to the same generate-image-then-convert path the standalone AURA 3D app uses.

- Chat 3D mode derives its source from the most recent successful generate_image tool result in the thread, surfaces it as a "Source for 3D" thumbnail above the textarea, and blocks Send with a switch-to-Image hint until one exists; the request dispatches via generate3dStream's URL form across both live and queue-replay paths. Manual image attachments stay disabled until the proxy decode-and-forward route is fixed. (`15aa431`)
- The AURA 3D app's Image tab no longer appends the product-photography STYLE_LOCK_SUFFIX to user prompts, so its image generation behaves consistently with /image and /3d (the constant is retained so stripStyleLock can still clean legacy artifacts). (`5897137`)

## 9:26 PM — Renamed CEO agents no longer get duplicated on login

The bootstrap CEO matcher learned a third identity signal so renaming the CEO no longer causes a duplicate to be minted at the next login.

- looks_like_ceo now also matches the canonical CEO system_prompt prefix ("You are the CEO SuperAgent"), extracted into a shared constant kept in lock-step with the template. CEOs created before the local stamping fix now get correctly recognized after a rename, so dedupe_ceo_agents picks the renamed agent as canonical and the freshly-minted duplicate is best-effort deleted on the next setup pass. (`2da2e55`)

## 9:57 PM — Chat 3D becomes an in-bar two-step pipeline, plus a CI packager fix

Following the earlier 3D revival, this batch reworks the flow into a removable pinned source thumb with an explicit image_step / model_step split, adds a copy menu for selected non-editable text, and unblocks the release pipeline.

- Chat 3D mode now runs as an in-bar two-step pipeline: a removable pinned source thumb owned by chat-ui-store replaces the "generate an image first" gate, the wire variant splits into image_step / model_step branches across resolve-send, useChatStream, and useAgentChatStream, and one-shot seeding from thread history preserves the cross-mode shortcut. (`2b78e87`, `d5a5270`)
- STYLE_LOCK_SUFFIX is dropped from chat 3D image prompts (and relocated to interface/src/constants/generation.ts), so chat 3D's image step generates verbatim from the user prompt like every other entry point. (`2b78e87`, `ffd4da5`)
- Right-clicking a text selection in chat or LLM markdown output — previously suppressed to nothing after the native-menu override — now surfaces a Copy-only menu, while editable fields and empty non-editable areas keep their existing behavior. (`90c31ed`)
- Release Infrastructure: the desktop-validate, release-nightly, and release-stable workflows stopped passing --no-default-features / --features to cargo packager (which 0.11.8's CLI rejects); the stable-channel feature is already applied via before-packaging-command, so CI is unblocked. (`a457cab`)

## Highlights

- Native browser context menu replaced with in-app Cut/Copy/Paste
- Windows top-edge resize is finally easy to grab
- Chat 3D mode rebuilt as an in-bar image→model pipeline
- Dev and stable build channels can now coexist on one machine

