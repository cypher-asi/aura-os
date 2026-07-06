# Fresh chat sessions land on a stable route

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.733.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.733.1

Today's nightly is a focused fix for the chat app's "fresh chat" flow: new conversations now bind to their session correctly, swap the temporary fresh URL for the canonical session route once the backend catches up, and share links pick up the right project and instance from the URL.

## 3:10 AM — Fresh chat route adopts the real session after first send

The chat app's fresh-canvas flow now correctly arms a new session, swaps the ephemeral fresh URL for the persisted session route, and hands share actions the right project and instance context.

- Fresh chats now stay in the pending-canvas state until a real session exists and pass a stable freshCanvasKey through to the chat hook, so the next send is reliably armed as a new session instead of being dropped or misbound. (`378f600`)
- Once a fresh chat's first send materializes in the session list, ChatAppRoute rewrites the URL in place — dropping the fresh= param and filling in session, project, instance, and agent — so refreshes and back-navigation land on the persisted conversation instead of a blank canvas. (`164f2d2`)
- Message share links now read project and instance from the current chat route (including /projects/:id/agents/:id paths) rather than relying solely on the stream key, fixing share-link creation for agent-scoped streams. (`8a544bb`)

## Highlights

- Fresh chat sessions bind reliably on first send
- Chat URL swaps to the canonical session route after send
- Share links resolve project and instance from the active route

