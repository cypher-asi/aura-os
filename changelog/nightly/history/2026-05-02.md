# Steadier chat transcripts and a recoverable Windows updater

- Date: `2026-05-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.433.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.433.1

Today's nightly is a deep stabilization pass on the chat surface — taking aim at the mid-turn blink, transcript flashes, and CEO-chat regressions — paired with meaningful reliability work on the Windows auto-updater and remote agent streaming.

## 2:37 PM — Remote org identity and Windows updater diagnostics

Two reliability fixes: remote chat sessions now carry the right org context, and Windows updates surface logs and relaunch instead of silently quitting.

- Remote harness chat sessions now derive their X-Aura-Org-Id from the project when agent metadata is incomplete, so server-side org context is preserved across remote turns. (`9bbe1ae`)
- Windows auto-update is no longer a black box: the NSIS installer handoff now writes a per-version log to the updater stage directory, and a single-instance retry loop keyed off AURA_UPDATE_RELAUNCH waits out the old process so Aura comes back up cleanly post-install. (`b7d6168`)

## 2:55 PM — Stall detection for remote chat streams

Server-side watchdogs and explicit error broadcasts ensure remote chats fail visibly when the harness goes silent instead of sitting on a connecting spinner.

- Swarm session startup now waits for an explicit session_ready signal before considering the remote agent live, eliminating a class of races where chats appeared connected but had no upstream. (`33ad453`)
- A new turn watchdog broadcasts a synthetic terminal error if the remote runtime emits no events within 30s, or if the turn exceeds the 5-minute ceiling — so SSE keep-alives can no longer mask a stalled stream. Unsupported websocket frames now also surface as explicit errors. (`33ad453`)

## 2:56 PM — Updater install moved off the Tokio runtime thread

Desktop installs now run on a dedicated OS thread, and the local update smoke script is more tolerant of empty PE metadata.

- User-approved updater installs now run on a named OS thread, so the tao event loop no longer needs a live Tokio reactor at install time — removing a deadlock vector in the Windows update path. (`9e66500`)
- The desktop auto-update smoke script falls back to the NSIS DisplayVersion registry value when PE metadata is empty, making local update verification work against more installer builds. (`9e66500`)

## 2:59 PM — Stable assistant tails, sidebar previews, and CEO role handling

A broad polish pass on chat and agent UI: streaming bubbles stop remounting, sidebar previews stop thrashing, and CEO identity is no longer inferred from permissions.

- The trailing assistant bubble now stays mounted as streaming text grows and as persisted history catches up, eliminating the end-of-turn flash in both project chats and standalone agent chats. (`0dbf968`, `db539c0`)
- Agent sidebar previews stay stable across history-store updates, and switching between standalone agents once again hands focus back to the chat composer when the target thread is ready. (`a33f494`, `983b01e`)
- The remote agent environment status card is now portaled out of the chat input's stacking context and pinned via fixed positioning, so it can hover above the streaming/thinking indicator without losing hover interactions. (`45cb631`)
- CEO identity is now resolved by the explicit bootstrap agent id rather than by matching the full-access permissions preset, so privileged non-CEO agents keep their own role and the bootstrap CEO is still deduped correctly. Hibernating swarm agents are also woken up reliably for new turns. (`5283d2f`, `9274780`)

## 5:07 PM — Windows updater relaunch argument aligned with cargo-packager

A small but load-bearing fix that lets the staged NSIS installer actually relaunch Aura after shutdown.

- The custom NSIS handoff now passes the relaunch argument expected by cargo-packager-updater, so the staged installer runs to completion and reopens Aura instead of leaving the user on a closed window. (`0df9e8e`)

## 5:16 PM — End of the CEO transcript blink

A coordinated front-end and server fix closes out the long-standing mid-turn transcript disappearance in CEO and standalone agent chats.

- Empty terminal assistant rows are now reconstructed from persisted text and thinking deltas on reload, so cross-agent replies survive a refresh even when the persistence pipeline lagged on the original turn. (`9cb703f`)
- ChatPanel now latches its cold-load reveal so a transient historyResolved=false flip mid-turn can no longer re-hide the entire transcript, ending the full-transcript flash users were seeing during long replies. (`48d2a33`)
- The standalone agent route view and the floating desktop agent window now share a single useStandaloneAgentChat hook, and useConversationSnapshot caches the last non-empty merged snapshot per streamKey — together eliminating the one-to-two-frame empty render that caused the CEO transcript to blink mid-turn. (`7e63962`)

## Highlights

- CEO transcript blink fixed end-to-end
- Stalled remote chats now fail loudly instead of hanging on 'connecting'
- Windows updater handoff is observable and reliably relaunches Aura
- Standalone agent route and floating window now share one chat wiring

