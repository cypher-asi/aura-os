# Steadier chat streams and a survivable Windows updater

- Date: `2026-05-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.432.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.432.1

Today's nightly tightens the seams where chat meets persistence and where Windows desktop hands off to its own installer. Streaming replies stop blinking when history catches up, stalled remote sessions surface real errors instead of a frozen "connecting" state, and the Windows updater now leaves a paper trail and reliably relaunches Aura after install.

## 2:37 PM — Org identity for remote chat and a debuggable Windows updater handoff

Two reliability fixes landed back to back: remote harness sessions now carry the right org header, and the Windows updater stops disappearing silently after install.

- Remote harness chat sessions now populate the X-Aura-Org-Id context from the project when agent metadata is incomplete, so server-side requests no longer drop their org identity. (`9bbe1ae`)
- On Windows, the NSIS installer handoff now writes a per-version log and the desktop app retries its single-instance acquisition during an update relaunch, so updates that previously quit without diagnostics now leave evidence and come back up cleanly. (`b7d6168`)

## 2:55 PM — Remote chat surfaces stalls instead of hanging on "connecting"

Swarm session startup and the WebSocket bridge now treat silence and bad frames as real errors, so the UI can stop showing an indefinite connecting state.

- Swarm session startup waits for an explicit session_ready signal and a new turn watchdog broadcasts a synthetic terminal error if the remote runtime emits no events within 30s or runs past the 5-minute turn cap. (`33ad453`)
- The WebSocket bridge now rejects unsupported frame types as terminal errors instead of letting the SSE keep-alive mask a dead stream, so chat fails fast with a real message. (`33ad453`)

## 2:56 PM — Updater installs move off the Tokio runtime thread

The Windows install path is reworked so it doesn't deadlock the desktop event loop, and the local smoke script can verify NSIS builds.

- User-approved installs now run on a named OS thread, so the tao event loop no longer needs a Tokio reactor to drive the updater handoff. (`9e66500`)
- The desktop auto-update smoke script falls back to NSIS DisplayVersion when PE metadata is empty, keeping local Windows release verification working end to end. (`9e66500`)

## 2:59 PM — Chat tail stability, sidebar previews, and an explicit CEO identity

A long thread of interface fixes removes the flicker at the end of streamed replies, keeps the agent sidebar quiet, and stops treating any full-access agent as the bootstrap CEO.

- The streaming assistant tail is now preserved until persisted history semantically catches up, so end-of-turn replies stop remounting or briefly reverting to stale content in both the chat and standalone agent views. (`0dbf968`, `db539c0`)
- Switching standalone agents now refocuses the chat composer via the shared desktop autofocus path, and the agent sidebar reads previews from a dedicated cache so rows don't churn as history entries get evicted. (`a33f494`, `983b01e`)
- The agent environment status card is now portaled out of the chat input's stacking context, so hovering remote status no longer renders behind the thinking indicator. (`45cb631`)
- CEO bootstrap now matches on the persisted bootstrap agent id instead of the full-access permission preset, so privileged non-CEO agents keep their own role and the swarm harness wakes hibernating agents reliably. (`5283d2f`, `9274780`)

## 5:07 PM — Windows updater relaunch flag wired through cargo-packager-updater

A small follow-up aligns the custom NSIS handoff with the updater library so the staged installer can actually relaunch Aura after shutdown.

- The Windows updater now passes the relaunch argument that cargo-packager-updater expects, completing the install-then-relaunch path on Windows. (`0df9e8e`)

## 5:16 PM — Cross-agent reloads recover empty terminal assistant rows

A late-day fix closes the last blink regression by reconstructing assistant content from persisted deltas when the terminal event lands without displayable text.

- Server-side history reconstruction now rebuilds completed assistant messages from text and thinking deltas when assistant_message_end was persisted without content, so cross-agent replies survive reloads. (`9cb703f`)
- The chat message list restores its dedicated streaming bubble path and skips no-op history rewrites, eliminating the residual flash when persisted history replaces the live tail. (`9cb703f`)

## Highlights

- Chat tail no longer flashes when history syncs
- Stalled remote agents now fail loudly instead of hanging
- Windows updater logs its handoff and relaunches cleanly
- Sidebar previews and CEO identity made stable

