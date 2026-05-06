# AURA 3D, image flows, and Settings polish

- Date: `2026-05-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.463.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.463.1

A heavy day for AURA's creative surfaces: chat 3D mode landed (and was carefully walked back to image-only), image generations now persist across reloads, the desktop wallpaper splits per theme, and the Settings panel got a wide pass for layout stability and overlay scrollbars. A late stretch hardened image upload paths through the server router and tightened the marketplace end-to-end.

## 3:33 AM — More accurate Mixpanel signals for DAU and checkout

Analytics events were realigned so DAU and purchase funnels reflect actual user behavior.

- Added a session_active event from AppShell for accurate daily-active-user tracking. (`25abb62`)
- Renamed purchase and subscription events in the Buy Credits and Tier modals to reflect checkout intent rather than completion, so funnel analytics no longer overcount conversions. (`32f8ad0`)

## 9:08 AM — AURA 3D viewer overhaul and chat 3D mode lifecycle

A long arc that restored the polished shell chrome, rebuilt the mode-selector pill animation, brought chat 3D mode online via Tripo, then walked it back to image-required after upstream limits surfaced — alongside a shared Gallery, per-theme desktop wallpapers, and Settings polish.

- Reverted a regressing UI trim and restored the desktop titlebar's compact UpdatePill, the BottomTaskbar right-click menu, the inline CommandChips slot, and the AgentEditorForm Name/Role row. (`4fd0e5e`)
- Rebuilt the mode-selector indicator from the ground up — first as a CSS-variable slide, then with literal per-render transforms after Chromium collapsed the variable updates — and finally extracted a generic SlidingPills primitive (radiogroup, keyboard nav, variable-width segments) that ModeSelector composes on top. (`6345213`, `8fa4a8a`, `af9baf7`, `c10d321`, `93e858d`, `e86a27f`, `eeaddb7`)
- Overhauled the AURA 3D app: theme-aware viewer chrome, coalesced ResizeObserver renders to stop blank frames on resize, full-bleed viewer with floating bottom-right toggles, larger main-panel images, right-click delete with confirm, pending thumbnails during generation, and captured PNG snapshots persisted as sidekick thumbnails via a new /api/artifacts/:id/thumbnail endpoint. (`31a743c`, `a3e6206`, `d2f348a`, `3690351`, `2505150`, `94b76d2`, `3514966`, `cafe391`, `12adeef`, `695e1e8`, `148a5cc`)
- Brought chat 3D mode online by routing 3D sends through Tripo with pasted image data URLs in both standalone and project chats, briefly opened a text-to-3D path, then reverted to image-required when aura-router's upstream stayed image-only — replacing the hard error with an inline 'Add an image to generate.' hint and ultimately hiding 3D from the mode selector for now. (`a39cfb2`, `83f8acb`, `165bd66`, `8613b09`, `cdd9c4e`, `534c7c4`)
- Shipped a single shared in-app Gallery overlay (prev/next, ESC, download) used by chat attachments, generated ImageBlock results, and 3D sidekick thumbs, plus a useImageScrollPin hook that re-pins the chat to the bottom while images decode mid-generation. (`f180965`, `9d23338`)
- Image-mode generations now persist into chat history: the request carries chat scope and the server writes a user_message + assistant_message_end pair so generated images survive a hard reload through the existing ImageBlock path. (`9a9d18e`)
- Hardened theme handling: browser tab and PWA chrome now sync to the in-app ZUI theme via a BrowserChromeThemeBridge and a sibling light manifest, the in-app Browser tab strip stops painting black in light mode, and the ReactFlow canvas dot grid is visible against the light background. (`f96d5c3`, `0fe61f9`, `5d8b770`, `1e6a6ec`)
- Added per-theme desktop wallpapers — the background store now holds separate light/dark slots and the modal exposes a Color/Image toggle with sensible white/black defaults; legacy single-config users are migrated into both slots. (`7986e09`, `aac2256`, `30a578a`)
- Redesigned the agent info Chats tab as a flat, ChatGPT-style date-bucketed list (Today / Yesterday / Previous 7 Days / ...) with Haiku-summarized titles populated as soon as a session has its first turn. (`b55579d`)
- Settings panel polish: stabilized the Updates row layout so 'Check for updates' no longer jerks, aligned 'Last checked' under the description, added a hover-only overlay scrollbar to the left nav, prewarmed billing subscription state and cached the invite code so Rewards/Billing stop flashing loading on every open, and forced Light/Dark/System onto a single row. (`5613b42`, `1a2d6d5`, `61767d0`, `2c119d7`, `a742ee9`, `bc28e94`)
- Server reliability for large attachments: raised the SSE body cap to 25 MiB for image/3D streams, added an 8 MiB cap on inline 3D data URLs with a clear 413, then reverted the 25 MiB bump after follow-up routing changes; chat-persist precedence (424) was kept ahead of the Tier-1 preflight so send_to_agent consumers see the contract-stable error. (`2a201a1`, `35f2562`, `02c0b01`, `cb67da1`)

## 4:35 PM — list_agents tool slimming and CEO double-send fix

Backend and chat-stream fixes targeting two specific user-visible failure modes — truncated agent listings inside the LLM tool path, and a duplicated first message on the CEO chat.

- Added an opt-in view=slim parameter to GET /api/agents that returns just {agent_id, name, role}, so the harness-native list_agents tool no longer overflows its 8000-char per-result cap on icon-heavy agent fleets. (`5c796bf`)
- Fixed a race where rapid double-sends on the very first CEO chat could fire two parallel POSTs to the chat stream endpoint; sendMessage now uses a synchronous latch so the second invocation in the same microtask short-circuits. (`172ebdc`)
- Added a behind-flag chat-merge tracer (localStorage aura.debug.chatMerge=1) to capture the event timeline behind reported CEO-chat user-message flap reports without speculating across stores. (`23bcd6c`)

## 5:30 PM — Marketplace unblocked and ZUI Button width rework

The Marketplace finally surfaces hireable agents end-to-end, ZUI buttons stop carrying an implicit 200px floor, and the Settings modal gains overlay scrollbars and an attached-image strip in chat bubbles.

- Unblocked the Marketplace: separated the loading flag from inflight dedupe so the first refresh actually hits the API, and unioned marketplace listings with caller-scoped agents and local shadows so users can see agents they marked hireable themselves. (`9701cb9`)
- Reworked ZUI Button sizing: dropped the 200px min-width baseline so buttons size to content by default, added a fullWidth prop with stronger specificity, and applied it to the Color/Image background toggle and the Light/Dark/System theme row. (`a201362`, `f0a7641`, `835fff7`)
- Added hover-only overlay scrollbars to the OrgSettingsPanel left nav and content area, hiding the OS-native scrollbars to match chat sidebar / LeftMenu UX. (`dcfc92c`)
- Raised the body limit on attachment-bearing routes to 16 MiB (image/3D streams and both chat event endpoints), so a normal pasted screenshot no longer surfaces as 'TypeError: Failed to fetch'. (`b44a3fe`)
- Refined chat UI: pasted images now render as a 96px thumbnail strip above the bubble (image-only messages skip the bubble entirely), and FolderSection parent chevrons hide until row hover to match the project tree. (`fbc3949`, `291cf39`)

## 6:51 PM — Settled refetch for chat history after delivery

Closes a small race where the immediate history read after a delivery event could miss storage visibility.

- Added a settled follow-up refetch for matched chat delivery events so target agent panels recover when the immediate history read races storage visibility. (`bd59d02`)

## 6:53 PM — Image upload routing, marketplace hiring, and feedback header

An end-of-day stretch reworked image-mode streaming through the router with pasted-image compression, fixed marketplace hiring + task counts, and polished the feedback feed and talent cards.

- Reworked image-mode streaming: first routed it directly through aura-router for prompt failure surfacing, then reverted when large inline inputs hit the router's body buffer, then landed a final shape that streams through the router with pasted-image compression on upload and storage-safe persisted references so reloads keep the thumbnail visible. (`72ad4ef`, `962d7e4`, `c871fad`)
- Marketplace flow now actually attaches hired agents and shows task counts on talent cards, with cleaner cover-art-heavy layout that avoids repeating role text when the description duplicates it. (`cbefa6b`, `550d033`)
- Floated the Feedback feed header above the scroll area with matching top padding so content no longer hides behind it. (`071a3da`)
- Scoped the ZUI postinstall to the vendor workspace so the parent install no longer recurses back into the interface package. (`1522dc4`)

## Highlights

- Chat 3D mode shipped via Tripo, then scoped to image-required
- Image-mode generations now persist across reload
- Per-theme desktop wallpapers with light/dark slots
- Shared in-app Gallery for every image surface
- Marketplace loading + hire flow fixed end-to-end
- Settings panel stabilized with overlay scrollbars and prewarmed billing

