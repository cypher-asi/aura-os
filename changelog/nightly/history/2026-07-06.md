# Chat routing that survives fresh sends, taskbar returns, and mobile onboarding

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.740.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.740.1

Today's nightly is a deep pass on chat session routing: fresh canvases now correctly promote themselves into real session URLs, the taskbar remembers where you left a conversation, and web session hydration is far more resilient. Mobile public chat also picks up polished onboarding, and the macOS desktop shell finally shows its window on launch outside of CI.

## 3:10 AM — Fresh chat canvas promotes to a real session route

Reworked how fresh chat canvases bind to a session so the first send transitions cleanly into a persisted, shareable route.

- Fresh chat canvases now consistently mark the next send as a new session and carry a stable freshCanvasKey through the chat hook, fixing binding issues where a fresh canvas could silently reuse or drop session state. (`378f600`)
- After the first send on a fresh canvas, the route now swaps itself in place to the concrete session — populating project, instance, session, and agent params via replace navigation once the new session materializes in the sessions list. (`8a544bb`, `164f2d2`)
- Message share links now read canonical project and instance params from the URL (including /projects/:id/agents/:instance paths) instead of guessing from the stream key, so copy-share works correctly on agent-scoped chat routes. (`8a544bb`)

## 4:46 AM — macOS desktop window visible on launch, hidden under CI

The desktop shell now shows its main window on macOS startup for real users, while keeping it hidden during automated CI runs.

- On macOS, the main desktop window now starts visible instead of relying on a later reveal, so launching AURA surfaces the app immediately. (`2665200`)
- Initial window visibility is now gated on a CI-mode check, so automated environments keep the window hidden while user launches show it — with detection updated to recognize standard CI environment signals. (`c9d2b5c`, `a3ca860`)

## 5:47 AM — Taskbar recall, safer session hydration, and mobile public chat polish

The chat app now remembers concrete session routes for taskbar returns, guards web session hydration against bad data and legacy hosts, and refreshes the mobile public chat shell.

- The taskbar entry for Chat now returns you to your last real session: ChatAppRoute persists the current project, instance, session, and agent as the remembered route, deriving missing params from the session list for legacy session-only links and skipping fresh canvases. (`5f2505a`)
- Remembered chat routes now require a resolved agent owner before being stored, preventing the taskbar from latching onto a half-loaded session URL that has no known agent. (`debe58e`)
- Web session hydration is hardened: the sessions list renders a clean empty state instead of throwing when it receives non-array data, and host-config now canonicalizes the legacy Render API origin to https://api.aura.ai on production web even when a stale value is stored locally. (`17db544`)
- Mobile public chat onboarding gets a native-feeling refresh: 60px top bars with safe-area padding, 48px touch targets on menu, close, and delete buttons, and a new free-message limit state with title, body, and composer placeholder prompting login. (`3329590`)

## Highlights

- Fresh chat canvases adopt the real session route after first send
- Taskbar remembers your last real chat session
- Hardened web session hydration against bad data and legacy hosts
- Mobile public chat gets a free-message limit and larger touch targets
- macOS desktop window now visible on launch, hidden in CI

