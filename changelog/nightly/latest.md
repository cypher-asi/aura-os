# Fresh chat sessions settle cleanly and Mac desktop shows on launch

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.736.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.736.1

Today's nightly tightens how new chat sessions transition from a fresh canvas into a real, shareable route, and restores an immediately visible window when Aura launches on macOS while keeping headless CI runs invisible.

## 3:10 AM — Fresh chat canvases adopt their real session route after first send

The chat app now holds a fresh canvas until a session actually materializes, then rewrites the URL to the persisted session so navigation, sharing, and reloads all point at the real chat.

- Fresh chat routes now correctly stay in the pending canvas state until a session exists, and pass a stable freshCanvasKey so the next send is armed exactly once as a new session instead of misbinding to a stale one. (`378f600`)
- Once the first message in a fresh chat produces a real session, the URL is replaced in-place with the persisted project, instance, session, and agent params, dropping the transient fresh=… marker so reloads and back-navigation land on the actual conversation. (`8a544bb`, `164f2d2`)
- Copy-share-link on a message now reads project and instance from the active chat route (query params or /projects/:id/agents/:id path) instead of only the stream key, so shares from an agent-scoped stream resolve to the correct session. (`8a544bb`)

## 4:46 AM — macOS launches with a visible window, CI stays headless

The desktop app now shows its main window on launch for macOS users while automatically staying hidden in CI environments, including standard CI runners.

- On macOS the main window is now created visible at launch instead of starting hidden, so users see Aura immediately after opening the app; Windows and Linux continue to defer visibility as before. (`2665200`)
- CI runs keep the desktop window hidden by gating macOS visibility behind ci_mode_enabled(), and that check now also honors the standard CI environment variable in addition to AURA_DESKTOP_CI, so generic CI providers automatically get the headless launch path. (`c9d2b5c`, `a3ca860`)

## Highlights

- Fresh chats now adopt their real session route after the first send
- Share links resolve correctly from the active chat route
- macOS desktop window is visible on launch, hidden under CI

