# AURA 3D studio debuts alongside nightly release hardening

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.361.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.361.1

A big day for Aura: a brand-new AURA 3D app landed end-to-end, going from an empty scaffold to a working image-to-3D studio with WebGL preview, project-linked persistence, and polished navigation. In parallel, the release pipeline got meaningfully sturdier — nightly asset pruning, changelog media history, and the Windows updater handoff all saw targeted fixes.

## 9:17 AM — Nightly release pruning, changelog media sync, and GPT-5.5 model

Release infrastructure got a substantial reliability pass, the AI-assisted changelog media pipeline grew stricter proofing, and GPT-5.5 joined the model selector.

- Replaced inline asset pruning in the nightly workflow with a retry-aware script that tolerates missing releases and missing assets, and added a new workflow plus sync script to keep changelog media history in step with the latest entries. (`a7eb25a`, `ac61ac3`, `d81834c`)
- Added a dedicated gh-pages republish recovery workflow backed by a retrying commit helper, giving the team a safety net when changelog publishes fail to push. (`ca9eaa8`)
- Tightened the AI changelog media pipeline with a stricter tool-based inference step (prompt v4), sharper framing, crisper preserved screenshots, and larger branded proof cards. (`8ef3f5b`, `2217600`, `43ac905`, `a0f9f63`, `4c104ae`)
- Added GPT-5.5 to the model registry and chat input selector, and started reporting ZERO Pro status alongside usage from the dev loop. (`d9d82e9`, `b2847a4`)

## 5:11 PM — AURA 3D app debuts with image-to-3D generation and WebGL viewer

A new AURA 3D studio app was scaffolded, wired to live generation streams, and given a full Three.js-based viewer, all gated behind a feature flag for early testing.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer","batchId":"entry-2","slug":"aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer","alt":"AURA 3D app debuts with image-to-3D generation and WebGL viewer screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.361.1/entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer.png","screenshotSource":"capture-proof","originalScreenshotSource":"capture-proof","polishProvider":"openai","polishModel":"","polishJudgeModel":"gpt-4.1-mini","polishScore":100,"polishFallbackReason":"openai_polish_quality_gate","updatedAt":"2026-04-24T02:28:17.246Z","storyTitle":"AURA 3D — Image-to-3D Generation with WebGL Viewer"} -->
![AURA 3D app debuts with image-to-3D generation and WebGL viewer screenshot](../../assets/changelog/nightly/0.1.0-nightly.361.1/entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-webgl-viewer -->

- Introduced a new AURA 3D app in the registry at /3d with a Box icon, left-nav asset history, and a Zustand-backed store, pulling in Three.js as a dependency for the upcoming viewer. (`1b20985`)
- Replaced the initial tab stubs with a single-page image generation flow backed by an SSE stream, a style-locked prompt, and a sidekick panel for browsing generated Images and Models. (`90887d5`)
- Added a Three.js WebGLViewer with a 4-light rig, GLTF loading with auto-center/scale, lifecycle cleanup, and toggles for grid, wireframe, and texture, wired to a Tripo-backed 3D generation stream that auto-picks up the generated source image. (`8b2b861`)
- Added a project selector in the left nav, gated the app behind the VITE_ENABLE_AURA_3D flag, and locked in store behavior with a suite of unit tests covering generation, selection, and error states. (`9cb954d`)

## 5:11 PM — SSE proxy now accepts data-only generation frames

Fixed a silent dropout where the Aura router's data-only SSE frames were being discarded by the proxy.

- The generation proxy now derives the event type from the JSON data field when an upstream frame omits the event: line, so start/progress/completion events from aura-router reach the client instead of being silently dropped. (`e0d60fd`)

## 5:11 PM — AURA 3D layout moves to tabs with a project-tree left nav

Based on early feedback, the 3D studio switched from a stacked split to Image/3D Model tabs and adopted the shared LeftMenuTree for project navigation.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav","batchId":"entry-4","slug":"aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav","alt":"AURA 3D layout moves to tabs with a project-tree left nav screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.361.1/entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav.png","screenshotSource":"openai-polish","originalScreenshotSource":"capture-proof","polishProvider":"openai","polishModel":"gpt-image-2","polishJudgeModel":"gpt-4.1-mini","polishScore":80,"polishFallbackReason":"","updatedAt":"2026-04-24T02:32:24.060Z","storyTitle":"AURA 3D – Image / 3D Model tab bar with LeftMenuTree project navigation"} -->
![AURA 3D layout moves to tabs with a project-tree left nav screenshot](../../assets/changelog/nightly/0.1.0-nightly.361.1/entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-4-aura-3d-layout-moves-to-tabs-with-a-project-tree-left-nav -->

- Replaced the 50/50 horizontal split with Image and 3D Model tabs in the main panel, and swapped the custom project dropdown for the shared LeftMenuTree so navigation matches the Projects app. (`5f41de6`, `9250ebf`)
- Added an IMAGE section header with a click-to-expand lightbox for generated images, including backdrop and X-button close, before the layout shift to tabs superseded the headers. (`ddb0b7e`)

## 5:11 PM — 3D artifacts persist per project and the studio comes out of flag gating

AURA 3D gained end-to-end artifact persistence, a polished nav and sidekick, parent-linked image-to-model chains, and was promoted out of feature-flag gating.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla","batchId":"entry-5","slug":"3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla","alt":"3D artifacts persist per project and the studio comes out of flag gating screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.361.1/entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla.png","screenshotSource":"capture-proof","originalScreenshotSource":"capture-proof","polishProvider":"openai","polishModel":"","polishJudgeModel":"gpt-4.1-mini","polishScore":30,"polishFallbackReason":"openai_polish_quality_gate","updatedAt":"2026-04-24T02:38:05.650Z","storyTitle":"AURA 3D – Artifact Persistence & Studio Promotion Out of Flag Gating"} -->
![3D artifacts persist per project and the studio comes out of flag gating screenshot](../../assets/changelog/nightly/0.1.0-nightly.361.1/entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-5-3d-artifacts-persist-per-project-and-the-studio-comes-out-of-fla -->

- Added a project artifacts backend in aura-os-storage with list/create/get/delete, exposed via JWT-authenticated proxy routes under /api/projects/:id/artifacts, and fixed a router trie conflict that was making GET return 404 while OPTIONS passed. (`d3ad5ec`, `5df2a3b`)
- Wired artifact persistence into the 3D store so selecting a project loads its saved images and models, stripping the style-lock suffix for display and linking models to source images via sourceImageId/parentId. (`f3dc0ae`, `e204d4c`)
- Polished the studio surface: left nav shows images and models as icon-prefixed children under each project, sidekick panels use a thumbnail grid with section headings, viewer controls became icon toggles, Generate 3D hides once a model is loaded, and progress messages cycle during generation. (`6229c31`)
- Enforced project selection before generation is allowed and removed the VITE_ENABLE_AURA_3D flag, making AURA 3D visible to everyone by default. (`e204d4c`, `6bbc5df`)

## 7:00 PM — Windows desktop updater handoff fix

Late-day desktop fix restored reliable auto-update handoff on Windows, with validation tightened in CI and local smoke scripts.

- Fixed the Windows updater handoff in the desktop app and updated the desktop-validate workflow, local auto-update smoke script, and CI verifier to catch regressions earlier. (`bb28191`)

## Highlights

- AURA 3D app shipped with image→3D generation and WebGL viewer
- Artifacts now persist per project and survive reloads
- Nightly release pruning and changelog media sync hardened
- Windows auto-update handoff fixed
- GPT-5.5 available in the model picker

