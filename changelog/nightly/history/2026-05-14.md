# Video generation lands in chat, with Seedance models on deck

- Date: `2026-05-14`
- Channel: `nightly`
- Version: `0.1.0-nightly.511.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.511.1

Today's nightly brings end-to-end video generation into the chat experience: a new in-message video player, a fully wired Video mode across desktop and mobile input bars, server-side persistence so video turns survive in chat history, and groundwork for BytePlus Seedance models alongside the existing Veo lineup. A late polish pass also extends the same persistence pattern to 3D generation and fixes a black-poster glitch on rendered videos.

## 2:29 AM — Video becomes a first-class chat generation mode

A full video generation path lands in chat: new models, a dedicated mode, an inline player, and end-to-end wiring across desktop, mobile, and the agent stream — plus server-side persistence of video turns.

- Added Seedance 2.0 and Seedance 2.0 Fast to the AURA Video panel with provider-aware controls — Seedance gets 480p–1080p resolutions, 4–15s durations, and a new aspect ratio picker (16:9, 9:16, 1:1, 4:3, 3:4, 21:9), while Veo keeps its 720p–4k / 4–8s constraints, with model switching automatically clamping invalid settings. (`a6d7ffe`)
- Promoted video to a first-class AgentMode across constants, slash commands, tool labels, and system event types, and introduced a new VideoBlock renderer that plays generated clips inline in chat with native HTML5 controls. (`b99ce50`, `4a2a5d9`)
- Wired the video dispatch path through chat hooks, the stream handler, resolve-send, and the chat UI store so sending in Video mode actually calls generateVideoStream, snaps the model picker to the default video model, and routes /generate_video to video mode on both desktop and mobile input bars — closing fall-through bugs that previously sent video prompts as chat or 3D. (`ec9c63b`, `1fd4789`, `79c0834`, `007699f`)
- On the server, the video generation handler now resolves a persist context and records the user prompt before streaming, mirroring the image handler so video turns land in chat history when an agent or instance ID is provided. (`afe9649`)

## 2:30 AM — Seedance gated as 'coming soon' while persistence wires through

Client-side plumbing finishes the video persistence loop, and Seedance models are intentionally surfaced but disabled until the BytePlus account is live.

- Project and agent chat streams now pass agentInstanceId and agentId on GenerateVideoOptions, completing the client side of video chat persistence introduced on the server. (`b430244`)
- Seedance 2.0 and Seedance 2.0 Fast appear in both the AURA Video and chat model pickers but are greyed out with a '(coming soon)' suffix and click disabled, ready to be enabled once the BytePlus account is provisioned. (`62a3dc1`)

## 3:18 AM — 3D generation joins chat history, and video posters stop showing black

The chat persistence pattern extends to 3D generations, and a small but visible fix replaces the black first frame on inline videos with a real preview.

- 3D generation now persists into chat history: the server handler accepts agent and instance IDs, resolves a persist context, and records the prompt before streaming, while the client passes those IDs through generate3dStream from both project and agent chats. (`287bc37`, `c63ce8d`)
- Inline videos in chat now render a real preview frame instead of a black poster by appending a #t=0.5 media fragment to the video src, matching the sidekick thumbnail behavior. (`d06e704`)

## Highlights

- Video mode is now a first-class chat generation mode
- Inline VideoBlock renders generated clips directly in messages
- Seedance 2.0 models scaffolded with provider-aware resolution, duration, and aspect ratio controls
- Video and 3D generations now persist into chat history

