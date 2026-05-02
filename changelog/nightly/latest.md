# Steadier remote chat and a more honest Windows updater

- Date: `2026-05-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.431.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.431.1

Today's nightly tightens the seams across remote chat and the desktop updater: stalled harness sessions now fail loudly instead of hanging on "connecting", Windows updates leave a paper trail and reliably relaunch, and a cluster of interface fixes keeps streamed agent replies, sidebar previews, and the chat composer from flickering or losing focus.

## 2:37 PM — Remote chat sessions keep their org identity

Server-side fix so harness-backed chat sessions always carry the org context the remote runtime needs.

- Chat sessions now backfill the X-Aura-Org-Id header from the project when agent metadata is missing it, so remote harness sessions no longer drop org context mid-handshake. (`9bbe1ae`)

## 2:40 PM — Observable Windows updater handoff

The NSIS updater path on Windows now leaves diagnostics behind and brings Aura back up after install.

- Windows updates capture a per-version handoff log under the updater stage directory and run a relaunch script that brings Aura back after the NSIS installer exits, ending the silent-quit failure mode. (`b7d6168`)
- The single-instance guard now waits up to 15s when AURA_UPDATE_RELAUNCH is set, so the relaunched process doesn't race the old one for the mutex. (`b7d6168`)

## 2:55 PM — Stalled remote streams fail fast

Swarm-backed chat now surfaces explicit errors instead of leaving the UI stuck on the connecting state.

- Swarm session startup now waits for an explicit session_ready signal and a new turn watchdog broadcasts a terminal error if the remote runtime emits no events within 30s (or stays open past the 5-minute turn cap). (`33ad453`)
- Unsupported websocket frames from the harness are now translated into stream errors over the SSE channel, so chat unblocks instead of hanging behind keep-alives. (`33ad453`)

## 2:56 PM — Updater install moves off the Tokio runtime

Desktop install kickoff and the Windows smoke check both got more robust against environment quirks.

- User-approved updater installs now run on a dedicated aura-update-install OS thread, removing the requirement that the tao event loop carry a Tokio reactor at install time. (`9e66500`)
- The Windows auto-update smoke script falls back to the NSIS DisplayVersion in the uninstall registry when PE ProductVersion/FileVersion are blank, so version checks stop failing on stripped installer metadata. (`9e66500`)

## 2:59 PM — End-of-turn flicker and sidebar preview churn

Two interface fixes stop the chat tail and agent sidebar from visibly resetting on routine updates.

- The trailing assistant bubble in chat no longer remounts when persisted history replaces the streaming placeholder, eliminating the end-of-turn flash. (`0dbf968`)
- Agent sidebar previews now read from a dedicated bounded preview cache (up to 100 entries) instead of the evictable history store, so last-message snippets stay put even after history entries are pruned. (`a33f494`)

## 3:10 PM — Agent chat polish and CEO identity correctness

An afternoon cluster of agent-chat fixes covering focus, layering, post-stream stability, hibernating swarm wake-ups, and a correctness fix for CEO deduplication.

- Switching standalone agents now restores the desktop autofocus path so the composer is ready as soon as the new thread loads, and the agent environment status card is portaled out of the chat-input stacking context so it can hover above the thinking indicator. (`983b01e`, `45cb631`)
- Agent chats now preserve the streamed assistant tail until persisted history semantically catches up, so finished replies stop blinking or briefly reverting to stale content. (`db539c0`)
- The swarm harness now wakes hibernating agents on demand instead of leaving them idle when a turn arrives. (`9274780`)
- CEO bootstrap dedupe is now keyed on the persisted bootstrap agent id rather than the full-access permission preset, so ordinary privileged agents are no longer mistaken for the CEO and silently merged. (`5283d2f`)

## Highlights

- Remote chat fails fast when the harness goes silent
- Windows updater handoff is now logged and relaunches Aura
- Streamed assistant replies no longer flash at end of turn
- CEO agent identity is anchored to a real id, not permission shape

