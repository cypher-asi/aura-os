# Conversation lifecycle tools and a smarter chat composer

- Date: `2026-08-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.819.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.819.1

Today's nightly is a heavy sessions release: conversations gain archive, rename, pin, and snooze controls end-to-end, the chat composer learns to save drafts and stash prompts, and agents get first-class tools to spin up projects and hand off work. A preview routing fix also keeps local workspaces from being pushed through the remote tunnel.

## 7:06 PM — Conversation lifecycle: archive, rename, pin, and snooze

The session list gained a full lifecycle toolkit backed by server-side state, so organizing chats now follows users across Aura clients.

- Conversations can be archived and restored from the sessions list and Sidekick context menu, moving them out of the active date buckets without deleting the transcript; the status is server-backed so it syncs across clients. (`282eab4`)
- Sessions now have editable titles with an inline rename flow, validated up to 120 characters and persisted through a new PUT endpoint on the agents API. (`0abff91`)
- Users can pin conversations to the top of the list, with pin state persisted per session and surfaced in both the chat left panel and the agent info Chats tab. (`8cf6fb2`)
- New snooze action temporarily hides a conversation until a chosen future time (or wakes it immediately), with server-side validation rejecting past timestamps and missing wake targets. (`8115727`)
- Chat composer now persists unfinished drafts, guards oversized prompts with an inline 'Remove N characters to send' hint that keeps the textarea editable while disabling send, and adds a global prompt shelf saved via Cmd+S on desktop and a dedicated button on mobile. (`6e9c37c`, `352081d`, `694f205`)
- Preview builds now prefer local workspace routing when the client can reach it, keeping local sessions off the remote tunnel while still honoring explicitly selected remote instances for remote-only clients. (`7c0c1fd`)

## 11:31 PM — Agent tools for project creation and handoff

Agents with write-all-projects capability now expose native tools to create an Aura project from a chat and hand the conversation off into a project-scoped session.

- Added a capability-gated create_project tool that spins up an Aura project from the current chat, binds the agent to it, and by default copies the conversation into a project-scoped session, returning project, agent instance, session, and route identifiers for the agent to continue from. (`39fd6c5`)
- Chat streams now propagate the source session id into installed-tool context so project-lifecycle tools can trace and hand off from the originating conversation. (`39fd6c5`)
- Introduced a dedicated project_access handler module and API tests covering the new agent-driven project endpoints. (`39fd6c5`)

## Highlights

- Archive, rename, pin, and snooze for conversations
- Persistent drafts and a global prompt shelf in chat
- Oversized prompts blocked without locking the editor
- Agents can now create projects and hand off sessions

