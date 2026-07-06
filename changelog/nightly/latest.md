# Fresh-chat routing, session hydration, and public chat polish

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.741.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.741.1

Today's nightly centered on making chat routes durable across fresh sends, taskbar returns, and reloads, with a parallel pass of polish on the public chat experience and a small but important fix to how the macOS desktop window comes up on launch.

## 3:10 AM — Fresh chat canvases bind to real sessions after first send

Reworked how the chat app treats a fresh canvas so the first send reliably materializes into a persisted session and the URL follows along.

- Fixed the fresh-canvas state so any URL without a session id is treated as pending, and the fresh key is threaded through so a new send is correctly armed as a new session instead of getting bound to a stale one. (`378f600`)
- After the first send lands, the chat route now swaps the throwaway fresh=... param for a canonical project/instance/session/agent URL, and share links read from that canonical route so copied links point at the real session. (`8a544bb`, `164f2d2`)

## 4:46 AM — macOS desktop window visible on launch

The desktop app now shows its main window on launch on macOS, while keeping the headless behavior CI depends on.

- The macOS desktop build now presents the main window on launch instead of starting hidden, so first-run and relaunch actually surface the app. (`2665200`)
- CI runs still launch the desktop hidden by detecting standard CI environment variables, so the visible-on-launch change doesn't destabilize automated desktop tests. (`c9d2b5c`, `a3ca860`)

## 5:47 AM — Taskbar remembers your last chat, and web session lists stop breaking on bad data

The chat taskbar entry now returns you to the exact session you were last in, session list hydration is hardened against malformed data, and the mobile public chat shell got a real touch-target and safe-area pass.

- Clicking the chat app from the nav rail now restores the last concrete session route (project, instance, session, agent) instead of dropping you on a blank canvas, with legacy session-only links upgraded to share-capable URLs. (`5f2505a`)
- Tightened the rule for remembering a route so no-agent session URLs are only persisted once the session's real owner has loaded, preventing a bad agent from being written into the remembered route. (`debe58e`)
- Hardened the web sessions list against polluted or non-array session payloads (renders an empty state instead of throwing) and canonicalized the legacy Render API origin to api.aura.ai on production web so stale stored hosts self-heal. (`17db544`)
- Polished the mobile public chat shell: 60px header, 48px menu/close/delete buttons with touch-action manipulation, proper safe-area padding, and new copy for the free-message limit state. (`3329590`)

## 10:38 AM — Free-message limit gate for public chat

Public chat now has a first-class limit-reached state on both web and mobile, with dedicated copy and clear log-in / sign-up actions instead of a generic send error.

- Added a shared limit-error detector and a styled limit notice in the public chat input bar, with pill-shaped primary and secondary actions prompting users to log in or sign up to continue. (`be5b4cc`)
- On the mobile public chat view, hitting the limit now snaps the turn count to the configured limit and clears the transient send error, so the UI transitions cleanly into the limit-reached state instead of showing a failure toast. (`be5b4cc`)
- Added localized strings for the limit title, body, and input placeholder ("Free chat limit reached" / "Log in to keep chatting") so the gate reads as an onboarding prompt rather than an error. (`be5b4cc`)

## Highlights

- Fresh chat routes now upgrade to real session URLs after the first send
- Taskbar returns reopen the exact chat you were in
- Public chat gains a proper free-message limit gate on mobile and web
- macOS desktop window now shows on launch outside of CI

