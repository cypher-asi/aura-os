# AURA 3D lands: image-to-model studio with persistent projects

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.362.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.362.1

Today's nightly introduces AURA 3D, a new in-app studio that turns a prompt into an image and then into a WebGL-viewable 3D model, with project-scoped history wired to the storage backend. Alongside it, the nightly release pipeline got meaningfully sturdier — from smarter asset pruning to tighter screenshot proofing — and a Windows updater handoff bug was fixed.

## 9:17 AM — Nightly release pruning, gh-pages recovery, and GPT-5.5 in the picker

The morning thread hardened the nightly release pipeline end-to-end and slipped a new model into the chat picker.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke","batchId":"entry-1","slug":"nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke","alt":"Nightly release prune, gh-pages recovery, and GPT-5.5 in the picker screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.362.1/entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke.png","presentationMode":"raw_contextual","screenshotSource":"openai-polish","originalScreenshotSource":"capture-proof","polishProvider":"openai","polishModel":"gpt-image-2","polishJudgeModel":"gpt-4.1-mini","polishScore":90,"polishFallbackReason":"","updatedAt":"2026-04-24T04:14:49.480Z","storyTitle":"GPT-5.5 now selectable in the chat input model picker"} -->
![Nightly release prune, gh-pages recovery, and GPT-5.5 in the picker screenshot](../../assets/changelog/nightly/0.1.0-nightly.362.1/entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-1-nightly-release-prune-gh-pages-recovery-and-gpt-5-5-in-the-picke -->

- Nightly asset pruning moved to a dedicated retrying script that tolerates missing releases, paired with a new workflow that syncs changelog media history into gh-pages after every publish. (`a7eb25a`, `ac61ac3`, `d81834c`)
- Added a gh-pages republish recovery workflow with a retrying commit helper, so transient push failures no longer leave the published changelog out of sync. (`ca9eaa8`)
- Changelog proof screenshots got crisper and better framed: branded cards were enlarged, capture was preserved at higher fidelity, and the AI proofing step learned to distinguish raw contextual shots from branded cards. (`2217600`, `43ac905`, `8ef3f5b`, `a0f9f63`, `4c104ae`, `60f4bab`)
- GPT-5.5 is now selectable from the chat input's model picker, and server-reported usage includes ZERO Pro status for downstream billing/display. (`d9d82e9`, `b2847a4`)

## 5:11 PM — AURA 3D app: from scaffold to working image + WebGL model studio

A new /3d app was built up in four commits, ending in a working prompt-to-image-to-3D flow rendered in a Three.js viewer.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer","batchId":"entry-2","slug":"aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer","alt":"AURA 3D app debuts with image-to-3D generation and WebGL viewer screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.361.1/entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer.png"} -->
![AURA 3D app debuts with image-to-3D generation and WebGL viewer screenshot](../../assets/changelog/nightly/0.1.0-nightly.361.1/entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer -->

- Scaffolded a new AURA 3D app at /3d with a Box icon, Zustand store, and left-nav asset history, pulling in three.js for the upcoming viewer. (`1b20985`)
- Replaced the initial Imagine/Generate/Tokenize tab stubs with a single-page flow: SSE-streamed image generation on top, 3D model section below, plus a sidekick panel with Images and Models tabs and a ChatInputBar-style model selector. (`90887d5`)
- Added a WebGLViewer built on a Three.js scene with a 4-light rig and a GLTF loader that auto-centers and scales models, plus grid, wireframe, and texture toggles; 3D generation streams via Tripo and auto-uses the generated image as its source. (`8b2b861`)
- Added a project selector dropdown in the left nav, gated the app behind a VITE_ENABLE_AURA_3D flag, and covered store state transitions with unit tests. (`9cb954d`)

## 5:11 PM — Generation proxy accepts data-only SSE frames

A small but essential fix to how generation events flow from aura-router through the desktop server.

- The generation SSE proxy was silently dropping router frames that omitted an explicit event: line; it now extracts the event type from the JSON data field so start/progress/completed events reach the UI reliably. (`e0d60fd`)

## 5:11 PM — AURA 3D layout rework: tabs, lightbox, and shared project tree nav

Iterative polish swapped the split layout for tabs and unified the left nav with the Projects app.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav","batchId":"entry-4","slug":"aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav","alt":"AURA 3D layout moves to tabs with a project-tree left nav screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.361.1/entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav.png"} -->
![AURA 3D layout moves to tabs with a project-tree left nav screenshot](../../assets/changelog/nightly/0.1.0-nightly.361.1/entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav -->

- Added an IMAGE section header matching the 3D MODEL header, a click-to-expand lightbox for generated images, and a clean 50/50 split with centered empty states. (`ddb0b7e`)
- Replaced the horizontal split with Image and 3D Model tabs and moved the left nav onto the shared LeftMenuTree, so AURA 3D now matches the Projects app pattern with projects as expandable groups and generated images as children. (`5f41de6`, `9250ebf`)

## 5:11 PM — AURA 3D artifact persistence and project-scoped history

Generated images and models now persist to aura-storage, link together by parentId, and load back when you revisit a project.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla","batchId":"entry-5","slug":"3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla","alt":"3D artifacts persist per project and the studio comes out of flag gating screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.361.1/entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla.png"} -->
![3D artifacts persist per project and the studio comes out of flag gating screenshot](../../assets/changelog/nightly/0.1.0-nightly.361.1/entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla -->

- Added StorageProjectArtifact types and client methods in aura-os-storage plus JWT-authenticated proxy routes under /api/projects/:id/artifacts and /api/artifacts/:id in aura-os-server. (`d3ad5ec`)
- Wired the AURA 3D store to load artifacts on project select, captured the image artifactId from the SSE completed event, and forwarded it as parentId when generating 3D so models link back to their source image. (`f3dc0ae`, `e204d4c`)
- Polished the studio: left nav shows icon-prefixed images and models under each project, sidekick panels use thumbnail grids, viewer controls became icon toggles, and cycling progress messages play during generation. (`6229c31`)
- Removed the VITE_ENABLE_AURA_3D flag so AURA 3D ships on by default, and fixed a 404 on artifact GETs caused by an axum router trie conflict by moving artifact routes into project_routes. (`6bbc5df`, `5df2a3b`)

## 7:00 PM — Windows updater handoff fix and tougher changelog media capture

Late-evening work repaired the Windows auto-update handoff and significantly tightened the screenshot proofing pipeline.

- Fixed the Windows updater handoff in the desktop shell, with matching updates to the desktop-validate workflow and the local auto-update smoke script so NSIS-based upgrades install reliably. (`bb28191`)
- Hardened the changelog media capture pipeline: the heuristic now penalizes subtle maintenance commits, backend-only feature work, and desktop-only updater changes as screenshot targets, and a new demo-screenshot-quality module plus navigation lessons corpus make agent-driven captures more reliable. (`0b64b22`)

## Highlights

- AURA 3D app: prompt → image → WebGL 3D model
- Artifacts persist per project via aura-storage
- GPT-5.5 available in the model picker
- Windows auto-updater handoff fixed
- Nightly release + changelog media pipelines hardened

