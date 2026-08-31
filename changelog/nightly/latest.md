# Conversation management gets first-class controls

- Date: `2026-08-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.817.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.817.1

Tonight's nightly rebuilds the chat sidebar around durable conversation management—archive, rename, and pin—while the composer picks up persistent drafts, an oversize-prompt guard, and a new global prompt shelf. A preview-only routing fix keeps local sessions from leaking onto the remote tunnel.

## 7:06 PM — Archive, rename, and pin land in the sessions list

The chat sidebar gains a full set of server-backed lifecycle controls so users can curate their conversation history across clients.

- Conversations can now be archived and restored from the sessions list, with the archived state stored server-side so the choice follows users across Aura clients; the same change also tightens authenticated storage request URLs. (`282eab4`)
- Sessions are renameable inline—user-authored titles replace the generated summary label and are validated up to 120 characters on the server. (`0abff91`)
- Important conversations can be pinned to the top of the list via a new pin endpoint and `pinned_at` field flowing through core, storage, and the sidebar UI. (`8cf6fb2`)
- Composer drafts now persist to localStorage per stream key and rehydrate on init, so refreshing or reopening Aura no longer discards an unfinished prompt; a migration hook moves fresh-canvas drafts onto their assigned session key. (`6e9c37c`)
- A new global prompt shelf lets users stash the current prompt with Cmd/Ctrl+S from the desktop composer and reopen saved prompts from a dedicated shelf on both desktop and mobile. (`694f205`)
- Oversized prompts now show an inline "Remove N characters to send" hint and disable the send button while keeping the textarea editable on both desktop and mobile. (`352081d`)
- Preview builds no longer force Sidekick sessions through the remote tunnel: terminal routing now prefers the local workspace unless the client is remote-only, and a stale vite preview config was dropped. (`7c0c1fd`)

## Highlights

- Archive, rename, and pin conversations from the sessions list
- Global prompt shelf with Cmd+S to stash drafts
- Unfinished chat drafts survive restarts
- Oversize prompts are blocked without locking the editor

