# Chat composer gets a memory, and conversations gain an archive

- Date: `2026-08-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.815.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.815.1

Tonight's nightly is focused squarely on the chat surface. Drafts now survive restarts, oversized prompts fail gracefully instead of silently, a new prompt shelf lets you park ideas for later, and conversations you're not ready to delete can be archived and restored. A smaller preview-routing fix also keeps local sessions from being pushed onto a remote tunnel.

## 7:06 PM — Chat composer memory, prompt shelf, and conversation archive

A concentrated evening of chat interface work: durable drafts, a length guard, a global prompt shelf, conversation archiving, and a preview-routing fix for local sessions.

- Unfinished chat drafts now survive app restarts — non-empty drafts are mirrored to localStorage per stream key, rehydrated on init, and migrated when a fresh canvas is bound to a real session so nothing typed gets lost on refresh or relaunch. (`6e9c37c`)
- The composer now guards oversized prompts on both desktop and mobile: the textarea stays editable, but Send is disabled and an inline hint tells you exactly how many characters to remove before the message can go out. (`352081d`)
- Introduced a global Prompt Shelf in the chat input bar — press Cmd/Ctrl+S to stash the current prompt (with attachments and slash commands), browse saved entries from a shelf menu on desktop or a dedicated dialog on mobile, and restore or delete them later. (`694f205`)
- Conversations can now be archived and restored instead of only deleted: new server endpoints back an archived status in storage, the sessions list and sidekick context menu expose the action, and restored sessions rejoin the active list as completed until the next turn. (`282eab4`)
- Preview builds no longer route local workspaces through the remote tunnel — SidekickContent now passes a preferLocalWorkspace flag to useTerminalTarget based on client capabilities, while remote-only clients keep their existing routing. (`7c0c1fd`)

## Highlights

- Unfinished chat drafts persist across restarts
- New global prompt shelf with Cmd+S to stash
- Archive and restore for conversations
- Oversized prompts blocked without freezing the editor

