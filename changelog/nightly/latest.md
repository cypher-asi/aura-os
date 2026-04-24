# AURA 3D studio lands, with a hardened nightly release pipeline

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.363.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.363.1

Today's nightly introduces AURA 3D, a new in-app studio for generating images and turning them into 3D models inside a live WebGL viewer. Alongside the new app, the team shipped artifact persistence so 3D work survives across sessions, patched a Windows updater handoff bug, and tightened the nightly release and changelog media pipelines end to end.

## 9:17 AM — Nightly release pipeline and changelog media proofing

The nightly release workflow and the automated changelog media pipeline were hardened with retries, recovery paths, and smarter proof-screenshot selection, and GPT-5.5 was added to the chat model picker.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke","batchId":"entry-1","slug":"nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke","alt":"Nightly release prune, gh-pages recovery, and GPT-5.5 in the picker screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.362.1/entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke.png"} -->
![Nightly release prune, gh-pages recovery, and GPT-5.5 in the picker screenshot](../../assets/changelog/nightly/0.1.0-nightly.362.1/entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke -->

- Nightly releases now prune old assets through a retryable script that tolerates missing releases, and a new workflow keeps changelog media history in sync with the latest published entries. (`a7eb25a`, `ac61ac3`, `d81834c`)
- Added a gh-pages republish recovery workflow with a retrying commit script so transient push failures no longer strand changelog updates. (`ca9eaa8`)
- Reworked AI-driven changelog media proofing to pick between raw contextual screenshots and branded cards, reject release/CI/backend-only work, and preserve crisper, larger proof frames. (`8ef3f5b`, `2217600`, `43ac905`, `a0f9f63`, `4c104ae`, `60f4bab`)
- Added GPT-5.5 to the chat model picker with updated pricing metadata, and surfaced ZERO Pro status alongside usage in server responses. (`d9d82e9`, `b2847a4`)

## 5:11 PM — AURA 3D app: image generation, WebGL viewer, and 3D flow

A brand-new AURA 3D app shipped behind an initial feature flag, covering image generation, a Three.js-based WebGL model viewer, and an end-to-end prompt → image → 3D model flow.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-2-aura-3d-app-image-generation-webgl-viewer-and-3d-flow","batchId":"entry-2","slug":"aura-3d-app-image-generation-webgl-viewer-and-3d-flow","alt":"AURA 3D app: image generation, WebGL viewer, and 3D flow screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-2-aura-3d-app-image-generation-webgl-viewer-and-3d-flow -->

- Introduced AURA 3D as a new app in the registry at /3d, initially scaffolded with an Imagine/Generate/Tokenize studio layout, a left nav for asset history, and a Zustand store. (`1b20985`)
- Replaced the tab scaffold with a single-page image generation flow: SSE image streaming with style-lock prompts, a ChatInputBar-style model selector, and Images/Models sidekick panels for asset management. (`90887d5`)
- Added a Three.js WebGL viewer with a 4-light rig, GLTF auto-center/scale loader, full lifecycle cleanup, and grid/wireframe/texture toggles, wired to a Tripo-backed 3D generation SSE stream that auto-uses the generated image as its source. (`8b2b861`)
- Added a project selector dropdown to the left nav and gated the whole app behind a VITE_ENABLE_AURA_3D flag, with store unit tests covering state transitions, generation completion, and error handling. (`9cb954d`)

## 5:11 PM — Generation SSE proxy handles data-only frames

Fixed a silent drop of upstream generation events in the server's SSE proxy.

- The generation proxy now extracts the event type from the JSON data field when aura-router sends data-only SSE frames without a separate event line, so start/progress/completed events are no longer dropped. (`e0d60fd`)

## 5:11 PM — AURA 3D layout polish: tabs, lightbox, and project tree nav

AURA 3D's layout moved to an Image/3D Model tab structure with a lightbox preview and a project tree nav matching the Projects app.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-4-aura-3d-layout-polish-tabs-lightbox-and-project-tree-nav","batchId":"entry-4","slug":"aura-3d-layout-polish-tabs-lightbox-and-project-tree-nav","alt":"AURA 3D layout polish: tabs, lightbox, and project tree nav screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-4-aura-3d-layout-polish-tabs-lightbox-and-project-tree-nav -->

- Added an IMAGE section with a click-to-expand lightbox (backdrop and X-button close), a 50/50 split with the 3D Model section, and centered empty states. (`ddb0b7e`)
- Switched from a horizontal split to Image and 3D Model tabs based on feedback, and reused LeftMenuTree for the left nav to stay consistent with the Projects app. (`5f41de6`, `9250ebf`)

## 5:11 PM — AURA 3D project artifacts now persist and AURA 3D ships unflagged

3D projects gained backend-persisted artifacts with a parent-child chain linking images to their derived models, and AURA 3D is now always on.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-5-aura-3d-project-artifacts-now-persist-and-aura-3d-ships-unflagge","batchId":"entry-5","slug":"aura-3d-project-artifacts-now-persist-and-aura-3d-ships-unflagge","alt":"AURA 3D project artifacts now persist and AURA 3D ships unflagged screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-5-aura-3d-project-artifacts-now-persist-and-aura-3d-ships-unflagge -->

- Added a project artifact backend in aura-os-storage and aura-os-server with list/create/get/delete proxy routes under /api/projects/:id/artifacts, plus a fix moving those routes into project_routes to resolve an axum trie 404. (`d3ad5ec`, `5df2a3b`)
- Wired artifact persistence into the AURA 3D store: selecting a project loads its saved images and models, style-lock suffixes are stripped for display, and parentId chains link models back to their source images across the generation flow. (`f3dc0ae`, `e204d4c`)
- Polished the left nav, sidekick thumbnails, and viewer controls, gated prompt input and Generate 3D behind a project selection, and cycled progress messages during generation. (`6229c31`, `e204d4c`)
- Removed the VITE_ENABLE_AURA_3D feature flag so the AURA 3D app is now always visible in the registry. (`6bbc5df`)

## 7:00 PM — Windows updater handoff fix and changelog capture resilience

A Windows desktop auto-update handoff bug was fixed, and the changelog media capture pipeline was made substantially more resilient.

- Fixed the Windows updater handoff in the desktop shell, with accompanying tweaks to the desktop validation workflow and the local auto-update smoke script. (`bb28191`)
- Hardened the changelog media capture pipeline with expanded screenshot quality and seed planning logic, a navigation-lessons knowledge base, and tighter heuristics that skip subtle maintenance, backend-only features, and desktop-only updater changes as non-visual proofs. (`0b64b22`)
- Stale media paths are now cleared when a capture fails, preventing broken screenshots from leaking into the published changelog. (`9941234`)

## Highlights

- New AURA 3D app with image → 3D model flow and WebGL viewer
- 3D projects, images, and models now persist across sessions
- Windows desktop updater handoff fixed
- GPT-5.5 available in the chat model picker
- Nightly release and changelog media pipelines hardened

