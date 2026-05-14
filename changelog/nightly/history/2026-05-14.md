# Video generation lands in chat, with Seedance models and 3D persistence

- Date: `2026-05-14`
- Channel: `nightly`
- Version: `0.1.0-nightly.512.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.512.1

Today's nightly brings end-to-end video generation into the chat experience: new Seedance models with provider-aware controls in the AURA Video app, a full wiring pass so video mode behaves correctly across desktop and mobile chat input bars, and matching chat-history persistence for both video and 3D generations. Late in the day, the in-chat video player picked up a real preview frame and an MP4 download.

## 2:29 AM — Video generation becomes a first-class chat mode

A coordinated push introduces Video as a full agent mode across the AURA Video app, chat input bars, stream hooks, and the server, with Seedance 2.0 / 2.0 Fast added alongside Veo.

- Added Seedance 2.0 and Seedance 2.0 Fast to the AURA Video app with provider-specific resolution (480p–1080p vs Veo's 720p–4k), duration (4–15s vs Veo's 4–8s), and a new aspect ratio picker (16:9, 9:16, 1:1, 4:3, 3:4, 21:9) shown only for Seedance; switching providers automatically clamps settings to a valid combination. (`a6d7ffe`)
- Wired Video as a full agent mode end-to-end: new generate_video slash command, mode descriptors, tool labels, GenerationCompleted/GenerationStart event variants, and a VideoBlock renderer that plays results inline with an HTML5 player. (`b99ce50`, `4a2a5d9`, `ec9c63b`)
- Fixed a cluster of fall-through bugs that made early video mode silently behave like chat, 3D, or image: desktop and mobile input bars, agent chat streams, the /generate_video slash command, progress text, and the model picker now all recognize video mode and pin to DEFAULT_VIDEO_MODEL_ID. (`1fd4789`, `007699f`, `79c0834`)
- On the server, the video generation handler now accepts agent_id and agent_instance_id and persists the user prompt before opening the generation stream, mirroring the image handler while staying backward compatible for callers without agent scope. (`afe9649`)

## 2:30 AM — Video turns persist to chat history, Seedance gated as coming soon

The client now forwards agent identifiers so video generations are saved to chat history, while Seedance models are surfaced but disabled until the BytePlus account is live.

- Chat and agent chat streams now pass agentInstanceId / agentId on video generation requests so the server can resolve the session and persist video turns alongside text in chat history. (`b430244`)
- Seedance 2.0 and 2.0 Fast are visible in both the AURA Video and chat model pickers but greyed out with a "(coming soon)" suffix and disabled clicks until the BytePlus integration is ready. (`62a3dc1`)

## 3:18 AM — 3D chat persistence plus polish for the in-chat video player

3D generation gets the same chat-history persistence as video and image, and the VideoBlock in chat picks up a real poster frame and an MP4 download link.

- 3D generation now persists to chat history end-to-end: the server's Generate3dRequest accepts agent_id / agent_instance_id and runs resolve_persist_ctx + persist_user_prompt, and the client's generate3dStream forwards those IDs from both project and agent chats. The standalone AURA 3D app continues to work without persistence. (`287bc37`, `c63ce8d`)
- VideoBlock now seeks to 0.5s via a #t=0.5 media fragment so chat shows a real preview frame instead of a black first frame, matching the sidekick panel thumbnails. (`d06e704`)
- Added a Download MP4 link beneath the in-chat video player, reusing the styling from the 3D model download. (`f56188f`)

## Highlights

- Video generation is now a first-class chat mode
- Seedance 2.0 models added to AURA Video (gated as coming soon)
- Video and 3D generations now persist into chat history
- In-chat video player gets preview thumbnails and MP4 download

