# AURA 3D comes online in chat, with a sharper image experience

- Date: `2026-05-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.462.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.462.1

Today's nightly is dominated by a deep push on the AURA 3D app and the new in-chat 3D mode: a usable image-to-3D pipeline, persistent thumbnails, calmer error states, and an end-to-end image experience that finally survives reload. Alongside it, the mode selector pill was rebuilt twice on the way to a clean shared component, and theme handling now reaches all the way out to the browser tab and PWA chrome.

## 3:33 AM — More accurate DAU and checkout-intent analytics

Tightened the analytics surface so daily active users and paywall funnels reflect what's actually happening.

- Added a session_active event in the AppShell so DAU tracking is grounded in real session activity rather than incidental page loads. (`25abb62`)
- Renamed purchase and subscription events in the Buy Credits and Tier Subscription modals so they read as checkout intent rather than completed transactions. (`32f8ad0`)

## 9:08 AM — Mode selector pill restored and rebuilt to actually slide

Reverted a chrome-trimming sweep that had quietly regressed the shell, then iterated the mode pill until its slide animation was smooth and reliable.

- Rolled back an earlier interface trim to bring back the animated mode-selector indicator, the bespoke desktop titlebar with compact UpdatePill, the shared right-click menu on the taskbar, the inline CommandChips slot, and 125 lines of context-menu test coverage. (`4fd0e5e`)
- Worked through several iterations on the sliding pill — re-porting the per-mode tint, switching to a CSS-variable-driven slide, fixing translateX reference bugs, and finally emitting a literal transform per render — so the indicator reliably animates between Code, Plan, Image, and 3D instead of snapping. (`6345213`, `af9baf7`, `c10d321`, `93e858d`)
- Settled on a single accent color for the active mode pill instead of per-mode hues, for a more consistent look across modes. (`8fa4a8a`)
- Redesigned the agent info Chats tab as a flat, ChatGPT-style date-bucketed list (Today / Yesterday / Previous 7 Days…) with auto-summarized titles that populate as soon as a session has its first exchange. (`b55579d`)
- Darkened the light-mode process canvas dot grid so it's actually visible against the near-white background. (`f96d5c3`)

## 10:01 AM — AURA 3D viewer overhaul and chat 3D mode wiring

A major pass on the 3D app fixed long-standing viewer glitches, brought 3D generation into chat, and unified image viewing across the product.

- Fixed eight stacked AURA 3D issues at once: the WebGL viewer no longer flashes blank when resizing, scene background and grid are theme-aware, the Image→3D flow stops auto-promoting old models, right-click delete now works on both image and 3D thumbnails, and main-panel previews are no longer capped at 360px. (`31a743c`)
- Wired chat's 3D mode straight to Tripo for both standalone and project-scoped agent chats, sending pasted/uploaded images as data URLs instead of falling through to the LLM. (`31a743c`, `a39cfb2`)
- Introduced a single shared Gallery overlay used by chat attachments, generated images, and the 3D sidekick, plus a useImageScrollPin hook that re-anchors the chat to the latest message as new images decode. (`f180965`, `9d23338`)
- Synced the browser tab thumbnail and PWA manifest to AURA's in-app ZUI theme via a new BrowserChromeThemeBridge and a sibling light-mode manifest, so OS-dark / app-light no longer leaves a dark Chrome tab. (`0fe61f9`)
- Replaced the 3D tab's bare Generate button with the same prompt input shell used by the Image tab so previews stop resizing when switching tabs, and made a single click on a sidekick image just re-select it instead of opening the gallery. (`a3e6206`, `d2f348a`)

## 10:58 AM — SlidingPills component, per-theme wallpapers, and theme leak fixes

Extracted the segmented-pill into a reusable component, added per-theme desktop backgrounds, and closed several theme-token leaks that left light mode dark.

- Extracted the segmented control into a generic SlidingPills component (controlled, role=radiogroup, keyboard-navigable, variable-width segments) and rebuilt ModeSelector as a thin wrapper on top. (`eeaddb7`)
- The desktop background store now holds independent Light Mode and Dark Mode slots, and the right-click Set Background modal exposes both side-by-side; legacy single-config users are migrated by copying their existing wallpaper into both slots. (`7986e09`, `aac2256`)
- Briefly opened a text-to-3D path in chat, then refactored the source argument into an explicit discriminated union covering url / data / none variants. (`83f8acb`, `165bd66`)
- Finished wiring the BrowserChromeThemeBridge into index.html and main.tsx, and added theme-aware aliases for --color-bg-subtle / -bg-elevated / -border-strong so the in-app Browser tab strip and other surfaces stop painting black slabs in light mode. (`5d8b770`, `1e6a6ec`)
- Floated the AURA 3D viewer's Grid / Wireframe / Texture toggles into a translucent bottom-right overlay and made the viewer full-bleed below the tab bar. (`3690351`)

## 11:20 AM — Persistent image history, 3D thumbnails, and a calmer chat 3D experience

Image and 3D generation got production-grade polish: results survive reload, 3D models earn real preview thumbnails, and the chat 3D guardrails are friendlier when something is missing.

- Image-mode generations now persist into chat history. The /api/generate/image/stream request carries chat scope (agentId or projectId+agentInstanceId), and a sibling task writes user_message + assistant_message_end rows so cold reload re-renders the image through the existing ImageBlock path. (`9a9d18e`)
- AURA 3D viewer now snapshots freshly-rendered scenes to a PNG and POSTs them to a new /api/artifacts/:id/thumbnail endpoint, so sidekick model tiles render the actual model preview with image and cube fallbacks; a follow-up wired the artifactId end-to-end and added a token query param so unauthenticated <img> tags can fetch the protected thumbnail. (`cafe391`, `12adeef`)
- Generating an image or 3D model now clears the previous selection and pins a fresh placeholder thumbnail in the sidekick, so the main panel shows a clean loading state instead of stale content while the new asset streams in. (`94b76d2`, `3514966`, `2505150`)
- Pulled chat 3D back to image-only after the upstream router rejected prompt-only requests as a confusing 502, replacing the hard error with a persistent inline 'Add an image to generate.' hint in both desktop and mobile composers, and routed delete actions through the standard ModalConfirm. (`8613b09`, `cdd9c4e`, `695e1e8`)
- Iterated on SSE body limits for inlined images: tried a 25 MiB route-level cap, reverted it in favor of an explicit 8 MiB pre-flight check on data URLs in the 3D handler that returns a clear 413 instead of a 120-second watchdog timeout. (`2a201a1`, `35f2562`, `02c0b01`)
- Hid 3D mode from the mode selector for now (Code / Plan / Image only) while keeping the underlying pipeline intact, fixed a server-side ordering bug that was masking chat_persist_unavailable (424) as a generic missing_aura_session_id (422), and dropped an ineffective dynamic import of aura3d-store flagged by Vite. (`534c7c4`, `cb67da1`, `5df9dea`)

## 1:42 PM — Right-click delete now works for 3D models too

Closed the loop on the AURA 3D delete-confirm flow.

- Bound the deleteModel store action in ModelGeneration so the right-click delete confirm actually removes 3D models, matching the image side that was already wired through deleteImage. (`148a5cc`)

## Highlights

- Chat 3D mode lands (then narrows to image-to-3D with a calmer hint)
- Image-mode generations now persist into chat history across reloads
- Per-theme desktop wallpapers and theme-synced browser/PWA chrome
- Sliding mode-selector pill rebuilt as a reusable SlidingPills component
- 3D viewer captures and persists snapshot thumbnails for the sidekick

