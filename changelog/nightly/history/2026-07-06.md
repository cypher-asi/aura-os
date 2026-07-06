# Fresh chat sessions bind cleanly to their route

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.732.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.732.1

A focused nightly centered on getting fresh chat sessions right: the chat app now correctly arms a new session when you open a blank canvas, and share links pick up the real project, agent, and session from the current route instead of guessing.

## 3:10 AM — Fresh chat routes and share links bind to the right session

Two early-morning changes tightened how the chat app enters a new session and how message actions resolve share context from the URL.

- Opening a fresh chat canvas now consistently marks the next send as a new session, using a stable fresh-canvas key so re-renders don't re-arm the transition and switching keys correctly starts another new session. (`378f600`, `8a544bb`)
- Share link creation in MessageActions now reads project, agent instance, and session directly from the current chat route — including agent-scoped stream keys and /projects/:id/agents/:id paths — instead of relying only on the stream key, so copied links point at the right conversation. (`8a544bb`)

## Highlights

- Fresh chat canvases reliably start a new session on first send
- Share links now resolve project, agent, and session from the chat route

