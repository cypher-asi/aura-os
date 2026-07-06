# Fresh chat routes stick, and macOS windows finally show up on launch

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.739.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.739.1

Today's nightly focused on making chat sessions feel durable across navigation and getting the macOS desktop app to actually appear when you open it. Fresh canvases now graduate cleanly into real session URLs, the taskbar remembers where you were, and session hydration no longer trips on unexpected data shapes.

## 3:10 AM — Fresh chat canvases graduate into real session URLs

E arly-mo rning wo rk gav e f res h ch at ro ut e s a re li ab l e h an do ff into a con crete se ssi on U RL o nce the first send lan ds.

- No w tr eats an y bl ank chat as a pen ding fresh canv as and threads a `freshCanvasKey` through so the next send can be armed as a new session. (`378f600`)

## Highlights

- Fresh chat canvases upgrade to real session URLs after first send
- Taskbar returns land back on your last real chat session
- macOS desktop window is visible on launch again, CI still headless
- Session list survives malformed data and canonicalizes the production API host

