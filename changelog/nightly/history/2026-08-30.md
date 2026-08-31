# Conversation management gets a major upgrade

- Date: `2026-08-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.818.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.818.1

Tonight's nightly is a heavy chat and sessions release: conversations can now be renamed, pinned, snoozed, and archived, while the composer gains draft persistence, oversized-prompt guardrails, and a reusable prompt shelf. A preview-mode routing fix also keeps local sessions from leaking onto the remote tunnel.

## 7:06 PM — Sessions list gains archive, rename, pin, and snooze

A four-part expansion of conversation management adds server-backed lifecycle actions across the sessions list, with matching API routes, storage fields, and UI affordances in both the chat left panel and the agent Chats tab.

- Conversations can now be archived and restored from the sessions list, backed by new server endpoints and a dedicated archived status so the choice syncs across Aura clients rather than being a local view toggle. (`282eab4`)
- Session titles are now user-editable, replacing the auto-generated summary with an inline rename flow (validated up to 120 characters) that flows through a new PUT rename endpoint. (`0abff91`)
- Important conversations can be pinned to the top of the list, with a persisted pinned_at field on sessions and a new pin toggle in the sessions list and sidekick context menu. (`8cf6fb2`)
- New conversation snooze hides a session until a chosen future timestamp — or lets you wake it immediately — with server-side validation rejecting past wake times. (`8115727`)
- Composer upgrades round out the batch: unfinished chat drafts now persist to localStorage and survive restarts, oversized prompts show an inline "Remove N characters" hint while keeping the draft editable, and a new global prompt shelf (Cmd+S on desktop, dialog on mobile) lets users stash and restore prompts across chats. (`6e9c37c`, `352081d`, `694f205`)
- Fixed a preview-mode routing bug so the Sidekick terminal prefers the local workspace when the client can reach it, keeping local sessions off the remote tunnel for non-remote-only clients. (`7c0c1fd`)

## Highlights

- Archive, rename, pin, and snooze conversations
- Chat drafts now survive restarts
- New global prompt shelf with Cmd+S
- Oversized prompts blocked without losing the draft

