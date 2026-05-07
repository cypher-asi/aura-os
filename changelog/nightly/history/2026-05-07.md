# Fresh-canvas chats, live titles, and an updater safety net

- Date: `2026-05-07`
- Channel: `nightly`
- Version: `0.1.0-nightly.475.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.475.1

Today's nightly is a deep pass on the agents-shell chat experience: the "+" new-chat button now behaves like a real fresh canvas, sessions get ChatGPT-style titles the moment you send your first message, and a string of session-list and binding fixes make the sidekick honest about what's actually persisted. The day closes with a critical release-channel safeguard so a workflow regression can't silently ship a broken updater again.

## 5:47 PM — New-chat lane and session-switch reliability in the agents shell

A long thread of fixes makes session navigation, the "+" button, and the chat input bar behave predictably across the agents-app sidekick.

- The chats sidekick no longer surfaces orphan "New chat" rows that did nothing on click: list endpoints now probe each session for at least one event and drop empty ones, with fail-open behavior so a transient storage hiccup never erases a real chat. (`c16c910`)
- Clicking "+" in the agents shell now reliably clears the lane, surfaces an optimistic "New chat" placeholder in the sidekick, and routes the first send into a fresh persisted session instead of getting pinned on a blank placeholder or inheriting the previous session's transcript. (`c3aeb20`, `fd7a552`, `2c795b8`)
- Switching between sessions no longer remounts the chat input bar or loses the prior assistant bubble: props are held stable per stream key, transcripts are scoped by session key, and id-aliasing keeps the previous turn mounted across the placeholder-to-persisted swap. (`8e0129c`, `81d8b6f`, `b1a41d8`, `d354bd2`, `d957b25`)
- Agent personality, role, and skills edited in the UI now actually shape chat replies: an identity preamble is composed server-side and prepended to the system prompt on both interactive chat routes. Legacy null-org agents also self-heal on first chat so they no longer 424 with "not bound to any project". (`9a33549`, `6a7ded1`)
- Smaller polish: selected sidekick rows now match the selected agent row's neutral overlay treatment, image-mode upload sending is gated correctly, and fresh-chat transcript resets are covered by tests. (`9480f8a`, `c826bd6`, `f118ae8`)

## 9:46 PM — Letting persisted sessions drive the sidekick row

A follow-up pass simplifies the new-chat flow so the server-assigned session id is the single source of truth for sidekick rows.

- The "+" action now resets only local chat state and lets the first sent message create the real sidekick row through the persisted session list, removing a large swath of optimistic-placeholder plumbing in favor of a cleaner promotion path. (`6c7012d`, `bbee79c`)
- First-turn sessions become durable, clickable, and titled without a fragile refresh race: pending rows are promoted as soon as the server assigns a session id, and early summary attempts are retried when the first response comes back empty. (`186c9ae`)
- Reclicking the currently selected agent in the agent list now preserves the active session instead of resetting it, and standalone-agent target narrowing was corrected. (`5a427a4`, `13c2c1b`)

## 10:30 PM — Content-agnostic session summaries

The Haiku summarizer no longer assumes every chat is a coding session, so trivial or non-coding turns stop producing refusal-prose titles in the sidekick.

- Replaced the "agent coding session" framing in the summarizer's system prompt so non-coding chats no longer get persisted titles like "I don't have any agent coding session to summarize". (`aa14044`)

## 10:42 PM — ChatGPT-style titles that land while the first reply streams

New chats now get short, human-readable titles generated from the first prompt and pushed live to the sidekick, with a tighter optimistic-row lifecycle around it.

- On the first persisted user message, the server kicks off a Haiku title generator in parallel with the assistant turn and publishes a session_summary_updated event over the WebSocket bus, so the sidekick label flips from "New chat" to a 2–5 word noun phrase before the assistant finishes streaming. The legacy /summarize endpoint is retained for backfill. (`44738c8`, `0d2fe13`)
- After clicking "+" and sending the first message, an optimistic "New chat" row now appears in both the agents-app and projects-app sidekicks immediately and is swapped for the real session id when SessionReady arrives, instead of waiting for an SSE round-trip plus refetch. (`a579da2`, `fff04e7`)
- Agent bindings are now sourced from the authoritative GET /api/agents/:id/projects endpoint instead of the active-org sidebar, so older remote agents (e.g. Glenn, Machina) bound to a per-org Home project finally show their real prior chats instead of "No sessions yet". (`198f5f2`)
- Smaller chat-input polish: pressing "+" now focuses the input on desktop so the fresh canvas is immediately ready to type into, the prior assistant bubble survives an in-flight Send without a remount flash, and silent paste/drag-drop/picker attachment failures are now instrumented end-to-end with hardened FileReader error paths. (`e3fcec1`, `91c47d4`, `95f0d0a`)

## 12:01 AM — Concurrent new-chat title isolation

Title events for one new chat can no longer stamp an unrelated optimistic row when the user fires off a second "+" before the first title finishes.

- setSessionSummary now stashes early-arriving titles in a pendingSummariesById map keyed on the real session id rather than patching whatever optimistic row happens to be in the surface, eliminating the duplicate-row + wrong-title state that appeared when two new chats were created in quick succession. Pending entries are also cleared on session removal. (`53ab98f`)

## 12:32 AM — Desktop release channel fails closed to stable

A critical safeguard so a workflow regression can never again silently ship dev-channel desktop builds with the in-app updater disabled.

- Flipped the cargo default for aura-os-desktop and aura-os-server from dev-channel to stable-channel so a plain cargo build now produces a stable binary with the updater enabled. Dev runner scripts on Mac, Windows, and Linux explicitly opt back into dev-channel, and release workflows keep their stable-channel flag as belt-and-suspenders. (`e86897a`)

## Highlights

- + new chat now delivers a true fresh canvas
- First message auto-generates a short session title
- Empty/orphan sessions filtered server-side
- Desktop release defaults to stable channel

