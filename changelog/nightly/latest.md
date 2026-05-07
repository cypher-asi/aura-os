# New chat flow gets a real sidekick, real titles, and a safer updater

- Date: `2026-05-07`
- Channel: `nightly`
- Version: `0.1.0-nightly.479.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.479.1

Today's nightly is dominated by a top-to-bottom rework of how new chats appear in the agents sidekick: empty "New chat" ghosts are gone, the "+" button now lands on a clean canvas, fresh sessions pop into the sidekick on send, and Haiku-generated titles stream in live. The day closes with a critical release-channel safety flip so the desktop updater can never silently ship dead builds again, plus image upload fixes that restore reliable attachment previews and history.

## 5:47 PM — Rebuilt the agents sidekick "+ new chat" experience

An evening-long rework made the agents-shell chat sidekick behave the way users expect: clicking + lands on a real fresh canvas, prior sessions stay clickable, and the input bar no longer churns on every navigation.

- Filtered zero-event orphan sessions out of the project and agent session list endpoints so the sidekick no longer renders unclickable "New chat" ghosts left over from persist races or pre-lazy-+ legacy data, with fail-open probes that preserve real chats during a storage hiccup. (`c16c910`)
- Fixed the agents-shell "+" button so it actually delivers a fresh canvas: the resolver now distinguishes a cold load from an explicit clear, the chat lane wipes the right destination keys instead of inheriting old messages, and clicking between sessions no longer leaves the lane pinned to a blank placeholder or the previous session's events. (`c3aeb20`, `2c795b8`, `fd7a552`, `bbee79c`)
- Stabilized the desktop chat input bar across session switches by holding attachments, commands, and send/new-chat/stop callbacks referentially stable per stream key, so React.memo actually short-circuits and the bar stops re-rendering on every sidekick click. (`8e0129c`, `d957b25`)
- Made first-turn sessions promote and persist cleanly: the assistant bubble stays mounted when a new user message is appended, transcripts are scoped per session key so switches don't leak history, the new-chat latch survives the URL flip, and pending rows are promoted to real session ids the moment the server assigns them. (`81d8b6f`, `b1a41d8`, `d354bd2`, `f118ae8`, `186c9ae`, `6c7012d`, `5a427a4`)
- Healed legacy null-org agents so their first chat saves instead of returning 424, and started routing each chat turn through an agent-identity preamble so name, role, personality, and skills configured in the UI actually shape the conversation. (`6a7ded1`, `9a33549`)
- Polished sidekick visuals and a stuck image-mode upload gate: selected session rows now share the neutral overlay treatment of the agent list, and the image-mode send button correctly unlocks when an attachment is present. (`9480f8a`, `c826bd6`)

## 10:30 PM — Session summaries handle non-coding chats gracefully

The Haiku summarizer no longer assumes every chat is a coding session, eliminating refusal-style titles in the sidekick.

- Replaced the coding-specific summarizer prompt with a content-agnostic one so trivial or non-coding turns stop persisting refusals like "I don't have any agent coding session to summarize" as the session title. (`aa14044`)

## 10:42 PM — Live ChatGPT-style titles and trustworthy agent bindings

The sidekick gained on-send optimistic rows, live-streamed Haiku titles, and a server-authoritative source of truth for which projects an agent is bound to.

- Replaced the lazy multi-line summary flow with a short ChatGPT-style title generated the moment the user's first prompt is persisted, pushed live to the sidekick over the WebSocket bus so the row label flips from "New chat" to a real 2–5 word title before the assistant finishes streaming. (`44738c8`, `0d2fe13`)
- Inserted an optimistic "New chat" row into both the agents-app and projects-app sidekicks the instant the first message is sent, then swapped its synthetic id for the real session id once SessionReady arrives — no more waiting on an SSE round-trip plus refetch for the row to appear. (`a579da2`)
- Reconciled title and id races in the sessions store so a title arriving before SessionReady attaches to the right row, late titles can no longer stamp unrelated optimistic placeholders during concurrent new-chat creates, and duplicate rows after the swap are gone. (`fff04e7`, `53ab98f`)
- Started sourcing agent-to-project bindings from GET /api/agents/:id/projects instead of the active-org sidebar snapshot, so remote agents like Glenn and Machina with cross-org Home-project bindings finally show their existing chats instead of "No sessions yet", with a pending lane while the binding fetch is in flight. (`198f5f2`)
- Smoothed the fresh-canvas micro-UX: the chat input auto-focuses after pressing + on desktop, and the prior assistant bubble keeps its alias across the same-render send so it no longer flashes a remount when a new user message is appended. (`e3fcec1`, `91c47d4`)
- Added [attach]-prefixed instrumentation and FileReader error handling along the desktop paste / drag-drop / file-picker intake path so silently-dropped attachments now surface a clear console trail and stop hanging the intake promise on reader failures. (`95f0d0a`)

## 12:32 AM — Desktop release channel fails closed to stable

A release-safety change prevents the dev channel — which disables the in-app updater — from ever shipping to users again if a workflow flag is dropped.

- Flipped the cargo default for aura-os-desktop and aura-os-server from dev-channel to stable-channel so a plain build now produces a stable, updater-enabled binary; if a release workflow ever drops the explicit --features stable-channel flag, the result is still stable instead of a silently-broken dev binary like the one shipped between May 5 and 6. (`e86897a`)
- Updated the desktop and mobile dev runner scripts and README to pass --features dev-channel explicitly, preserving parallel dev/stable installs with distinct data dirs, ports, and window titles. (`e86897a`)

## 1:58 AM — Attachment thumbnail no longer disappears after upload

Moved attachment update logic into the dedicated hook so the preview thumbnail stays visible across the upload lifecycle on both desktop and mobile chat input bars.

- Consolidated attachment update logic inside useFileAttachments so the chat input thumbnail stops disappearing mid-upload on desktop and mobile. (`7f5f0af`)

## 2:53 AM — Reliable image uploads and history rendering

Image attachments now survive history reloads, large files are no longer silently rejected, and the production S3 bucket and IAM user for aura-router are scripted for repeatable deploys.

- Persisted source_url alongside base64 data for user image content blocks and ensured the frontend always includes base64 as a fallback, so images render reliably when a session is reloaded from history instead of breaking when the S3 upload path was used. (`f6903cd`)
- Removed the per-file 5MB and total 10MB upload caps that were silently rejecting larger images with no user feedback, since compression already sizes images for the LLM and S3 handles large uploads. (`b9a8fda`)
- Added deploy scripts to provision the aura-asi-production-assets S3 bucket with public-read and CORS, plus a dedicated S3-only IAM user for aura-router. (`031d8fb`)

## Highlights

- ChatGPT-style fresh-canvas + button with optimistic sidekick rows
- Live-streamed session titles replace lazy summaries
- Agent personality now actually shapes chat replies
- Desktop updater fail-closes to stable channel
- Image attachments survive history reloads and large files

