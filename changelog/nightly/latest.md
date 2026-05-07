# Fresh-canvas chats, live session titles, and a stable-channel updater fix

- Date: `2026-05-07`
- Channel: `nightly`
- Version: `0.1.0-nightly.476.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.476.1

Today's nightly is a deep overhaul of how new chats are created, listed, and titled across the agents and projects shells — plus a critical release-channel fix so future desktop builds can no longer ship without a working updater. Most of the work tightens the "+" new-chat flow end-to-end: empty orphan sessions are filtered, agent identity now actually reaches the model, optimistic rows behave correctly, and ChatGPT-style titles arrive live over the WebSocket bus.

## 5:47 PM — New-chat lane and sidekick rebuild for the agents shell

A long evening thread reshaped how the "+" new-chat button, session switching, and chat input behave across the agents and projects shells, eliminating stale transcripts, duplicate rows, and unmount churn.

- Empty orphan sessions are now filtered server-side from both project and agent session list endpoints via a fan-out events probe, so the sidekick no longer shows unclickable "New chat" rows from failed first turns or pre-lazy-+ legacy data. (`c16c910`)
- Switching sessions in the agents shell no longer remounts the chat input bar or assistant bubble: prop identities are stabilized per streamKey via refs, and the message list aliases ids tail-first so the prior assistant survives appending a new user message. (`81d8b6f`, `8e0129c`, `d354bd2`, `d957b25`)
- Cross-session clicks now reset the shared stream slot at the resolver level so the first click loads the right session, transcripts are scoped by history key to avoid bleeding same-agent history, and reclicking a selected agent preserves its session. (`2c795b8`, `b1a41d8`, `5a427a4`, `13c2c1b`)
- The "+" new-chat button now reliably delivers a fresh canvas: the lane is cleared without locking on a placeholder, an optimistic "New chat" row appears in the sidekick, and the first sent message promotes it through the persisted session list once the server assigns a real id. (`c3aeb20`, `fd7a552`, `186c9ae`, `6c7012d`, `bbee79c`, `f118ae8`)
- Backend fixes round out the flow: legacy null-org agents now self-heal their project binding so the first chat no longer 424s, the system prompt finally carries agent name, role, personality, and skills into chat turns, and the selected sidekick row uses the same active-item treatment as the agent list. (`6a7ded1`, `9a33549`, `9480f8a`, `c826bd6`, `e8d54fc`)

## 10:30 PM — Content-agnostic prompt for session summaries

The Haiku summarizer no longer assumes every chat is an "agent coding session," preventing refusal text from being persisted as a session title.

- Rewrote the summarizer system prompt so non-coding or trivial turns no longer produce refusals like "I don't have any agent coding session to summarize" that were getting saved as the sidekick title. (`aa14044`)

## 10:42 PM — Live ChatGPT-style titles and authoritative agent bindings

First-message session titles now generate in the background and stream into the sidekick over the WebSocket bus, while the Chats tab pulls bindings from the server so cross-org agents finally show their real history.

- Sending the first message immediately drops an optimistic "New chat" row into both the agents-app and projects-app sidekicks, then swaps its synthetic id for the real session id once SessionReady arrives — no more waiting on the SSE round-trip plus refetch. (`a579da2`)
- A new on-send title task generates a short 2–5 word noun-phrase title via Haiku the moment the first prompt is persisted, publishes a session_summary_updated event over the WS bus, and the sidekick row label flips from "New chat" to the real title before the assistant finishes streaming. (`44738c8`, `0d2fe13`)
- Agent project bindings are now fetched from GET /api/agents/:id/projects instead of being derived from the active-org sidebar, so remote agents like Glenn and Machina with cross-org Home-project bindings finally surface their prior chats instead of showing "No sessions yet". (`198f5f2`)
- Pressing "+" now focuses the chat input on desktop so the cursor is ready for the next prompt, and the prior assistant bubble stays aliased across the same-render send-and-swap so it no longer briefly remounts. (`e3fcec1`, `91c47d4`)
- Optimistic title patching now goes through replaceSessionId instead of bumping the version, eliminating the duplicate-row race when on-send titles landed before SessionReady. (`fff04e7`)
- Added [attach]-prefixed instrumentation across the desktop chat input intake (paste / drag-drop / file picker) and hardened FileReader paths with onerror handlers so a failing read no longer hangs the entire attachment promise chain silently. (`95f0d0a`)

## 12:01 AM — Title events stop cross-contaminating concurrent new chats

Late-arriving title events for one new chat no longer stamp the placeholder for a different in-flight new chat.

- setSessionSummary now stashes summaries in a pendingSummariesById map keyed on the real session id and only attaches them during replaceSessionId, fixing a race where a second "+" send before Title-1 finished could overwrite the second placeholder with the first chat's title. (`53ab98f`)

## 12:32 AM — Desktop default flipped to stable-channel so the updater can't ship dead

After a recent two-job pipeline silently shipped dev-channel binaries with the in-app updater disabled, the cargo default for desktop and server is now stable-channel so the failure mode is fail-closed.

- Plain `cargo build -p aura-os-desktop` now produces a stable, updater-enabled binary; if a future workflow change drops the explicit --features stable-channel flag, the result is still a working stable build instead of a silently-broken dev one. Dev runner scripts keep their explicit dev-channel flag so local development is unaffected. (`e86897a`)

## 1:58 AM — Attachment thumbnails stay visible after upload

A late fix moved attachment update logic into the useFileAttachments hook so thumbnails no longer disappear from the chat input bar.

- Consolidated attachment update logic inside the useFileAttachments hook on both desktop and mobile chat input bars, fixing a regression where the thumbnail preview would disappear after a file was added. (`7f5f0af`)

## Highlights

- New-chat (+) flow rebuilt end-to-end across agents and projects shells
- Live ChatGPT-style session titles stream into the sidekick
- Agent personality and skills now reach chat turns
- Desktop builds default to stable-channel so the updater can't ship dead
- Empty orphan sessions filtered server-side; bindings sourced from the server

