# Fresh-chat routing gets durable, and macOS launches visibly again

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.738.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.738.1

Today's nightly centers on making chat routes behave predictably across sends, reloads, and taskbar returns, plus a fix that restores the macOS desktop window on launch while keeping CI runs headless.

## 3:10 AM — Fresh chat canvases promote to real session routes after first send

The chat app now tracks a fresh canvas through its first send and rewrites the URL to the concrete session once it materializes, so refreshes and share links land on the right conversation.

- Fresh chat routes now stay pinned as pending until a session actually exists, and a stable freshCanvasKey is threaded through so the next send is armed as a new session exactly once per canvas. (`378f600`)
- After the first send in a fresh canvas, the route is rewritten in place to /chat?session=…&project=…&instance=…&agent=… once the new session appears in the sessions list, replacing the transient fresh=… URL without a navigation. (`164f2d2`)
- Share link generation now reads project and agent-instance context from the canonical chat URL (or /projects/:id/agents/:id path) instead of only the stream key, so 'Copy share link' produces valid links even for agent-scoped sessions opened from chat. (`8a544bb`)

## 4:46 AM — macOS desktop window shows on launch, CI stays headless

The desktop app once again presents its window immediately on macOS while remaining invisible in automated environments, now driven by a broader CI detection.

- The macOS build once again shows the main window on launch instead of coming up hidden; other platforms retain their existing startup behavior. (`2665200`)
- Initial window visibility on macOS is now gated by CI mode, so headless CI runs keep the window hidden while normal user launches present it immediately. (`c9d2b5c`)
- CI detection for the desktop launcher now honors the standard CI environment variable in addition to AURA_DESKTOP_CI, so third-party runners are recognized without extra configuration. (`a3ca860`)

## 5:47 AM — Taskbar remembers your last real chat session

The chat taskbar entry now returns you to your most recent concrete conversation, with safeguards so fresh canvases and half-loaded sessions are never remembered.

- Concrete chat session routes are now persisted as the 'last chat route' so returning to chat from the app nav rail reopens the specific session, project, instance, and agent you were in — including deriving a share-capable route from legacy session-only links. (`5f2505a`)
- Fresh canvases (fresh=… URLs) are explicitly excluded from being remembered, so the taskbar never sends users back into an empty chat. (`5f2505a`)
- A no-agent session URL is only remembered once its owning agent is known — resolved via the sessions list or the agent-by-instance map — and storage now rejects any remembered chat route missing project, instance, or agent, preventing broken taskbar returns. (`debe58e`)

## Highlights

- Fresh chats now promote to real session URLs after the first send
- Taskbar re-entry returns you to your last real chat conversation
- macOS desktop window is visible on launch again, CI stays headless

