# Fresh-canvas chat sessions and a fail-closed updater channel

- Date: `2026-05-07`
- Channel: `nightly`
- Version: `0.1.0-nightly.477.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.477.1

Today's nightly is dominated by a deep rework of the agents-shell chat sessions experience: the "+" new-chat flow, the sidekick session list, ChatGPT-style auto-titles, and the cross-session navigation that drives them. A late-night release fix also flips the desktop default Cargo channel to stable so a workflow regression can't silently ship dead binaries again.

## 5:47 PM — Rebuilt "+ new chat" flow in the agents shell

A long arc of fixes makes session switching, the new-chat button, and the chats sidekick behave like a fresh canvas instead of leaking state across sessions.

- Zero-event sessions are now filtered out of the project and agent session list endpoints, so orphaned "New chat" rows from racey first-turn persistence and pre-lazy-+ legacy data no longer appear as unclickable ghosts in the sidekick. (`c16c910`)
- Clicking "+" or switching sessions in the agents shell now reliably lands on a clean canvas: the chat lane clears destination history keys and the shared stream slot, the prior assistant bubble stays mounted across sends, and the input bar no longer churns through React.memo on same-agent navigation. (`81d8b6f`, `8e0129c`, `2c795b8`, `c3aeb20`, `fd7a552`, `d957b25`, `bbee79c`)
- Chat transcripts are now scoped by session key and the agents panel stays mounted for known sessions, so flipping between recent chats no longer reuses stale same-agent history or briefly flashes the previous transcript. (`b1a41d8`, `d354bd2`, `f118ae8`, `5a427a4`)
- After several iterations, the new-chat "+" action now resets only local state and lets the first sent message create the real, persisted sidekick row, with pending rows promoted as soon as the server assigns a session id. (`186c9ae`, `6c7012d`)
- Two backend reliability fixes round out the thread: legacy null-org agents are healed on first chat instead of returning a 424, and chat turns now prepend an identity preamble (name, role, personality, skills) so PersonalityTab edits actually take effect in conversation. (`6a7ded1`, `9a33549`)
- The selected row in the sidekick "Sessions" list now uses the same neutral overlay treatment as the selected agent row, ending the accent-tinted highlight from an undefined token, and an image-mode upload send-gate bug was fixed. (`9480f8a`, `c826bd6`)

## 10:30 PM — Content-agnostic session summary prompt

The Haiku summarizer no longer assumes every chat is a coding session, so trivial or non-coding turns stop producing refusal prose as session titles.

- Reworded the summarizer system prompt to be content-agnostic, eliminating persisted titles like "I don't have any agent coding session to summarize" on non-coding chats. (`aa14044`)

## 10:42 PM — ChatGPT-style auto-titles and server-sourced agent bindings

Brand-new chats now get a short, human-readable title generated from the first message and pushed live to the sidekick, while agent bindings are read from the authoritative server endpoint instead of the active-org sidebar.

- On the first user message, the server now spawns a Haiku title task that generates a 2-5 word noun-phrase title, persists it as the session summary, and pushes it over the WebSocket event bus so the sidekick row flips from "New chat" to the real label before the assistant finishes streaming. (`44738c8`, `0d2fe13`)
- Optimistic "New chat" rows now appear in both the agents-app and projects-app sidekicks the moment the first message is sent, with the synthetic id swapped for the real session id once SessionReady arrives — and the chat input regains focus on the fresh canvas after pressing "+". (`a579da2`, `e3fcec1`)
- The agents-app "Chats" tab and the standalone-agent default-session redirect now fetch authoritative bindings from GET /api/agents/:agent_id/projects, fixing the case where remote agents auto-bound to a Home project outside the active org showed "No sessions yet" despite real chats in storage. (`198f5f2`)
- Two race fixes around title delivery: late-arriving titles are now stashed by real session id and reattached on the optimistic-to-real id swap so concurrent new chats never cross-contaminate, and the prior assistant bubble keeps its alias when a send appends a new user message in the same render. (`fff04e7`, `53ab98f`, `91c47d4`)
- Added [attach]-prefixed instrumentation and FileReader error handling to the desktop chat input intake path to track down a silent paste/drop/picker attachment failure on /agents/<uuid>. (`95f0d0a`)

## 12:32 AM — Cargo default flipped to stable-channel for desktop and server

After dev-channel binaries silently shipped to users earlier this week with the in-app updater disabled, the desktop and server crates now default to stable-channel so the failure mode is fail-closed.

- Flipped the default Cargo features on aura-os-desktop and aura-os-server from dev-channel to stable-channel, so a future workflow regression that drops --features stable-channel produces a stable, updater-enabled binary instead of a silently-broken dev one. (`e86897a`)
- Local dev runners (run-desktop-dev.sh/.ps1, run-mobile-dev.sh) now explicitly pass --no-default-features --features dev-channel so developer builds keep their distinct identifiers and can run alongside an installed stable AURA. (`e86897a`)

## 1:58 AM — Attachment thumbnail no longer disappears mid-upload

Moved the attachment update logic into the file-attachments hook so the preview thumbnail stays visible through the upload lifecycle on desktop and mobile.

- Centralized attachment state updates inside useFileAttachments, fixing a thumbnail-disappearing regression in the desktop and mobile chat input bars. (`7f5f0af`)

## 2:53 AM — S3 asset bucket and IAM provisioning scripts

New deploy scripts stand up the aura-asi-production-assets bucket with public-read and CORS, plus a dedicated S3-only IAM user for aura-router.

- Added deploy/setup-s3.sh and deploy/create-s3-iam-user.sh to provision the production assets bucket and a least-privilege IAM user for the router. (`031d8fb`)

## Highlights

- Fresh-canvas "+ new chat" flow with optimistic sidekick rows
- ChatGPT-style auto-generated session titles on first message
- Desktop updater can no longer silently ship as dev-channel
- Agents shell now sources bindings from the server, not the active-org sidebar

