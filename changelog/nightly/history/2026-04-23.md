# AURA 3D studio lands alongside a mobile project shell rebuild

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.365.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.365.1

Today's nightly is an unusually feature-heavy one. A brand-new AURA 3D app arrives end-to-end — from scaffolding to a Three.js WebGL viewer and persisted artifacts — while the mobile project experience gets a ground-up navigation redesign with a dedicated Agents roster. Underneath, the release pipeline and changelog media tooling were tightened, and a Windows updater handoff bug was fixed.

## 9:17 AM — Nightly release pruning, gh-pages recovery, and GPT-5.5 in the picker

Release infrastructure got a substantial resilience pass, and GPT-5.5 showed up as a selectable model in chat.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-1-nightly-release-pruning-gh-pages-recovery-and-gpt-5-5-in-the-pic","batchId":"entry-1","slug":"nightly-release-pruning-gh-pages-recovery-and-gpt-5-5-in-the-pic","alt":"Nightly release pruning, gh-pages recovery, and GPT-5.5 in the picker screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-1-nightly-release-pruning-gh-pages-recovery-and-gpt-5-5-in-the-pic -->

- Nightly release asset pruning was extracted into a retryable script that tolerates missing releases and assets, replacing the brittle inline workflow step. (`a7eb25a`, `ac61ac3`)
- Added a dedicated workflow to sync changelog media into dated history entries and a gh-pages republish recovery workflow so failed publishes can self-heal. (`d81834c`, `a7eb25a`, `ca9eaa8`)
- GPT-5.5 is now selectable in the chat model picker, with pricing and server-side routing updated to match, and ZERO Pro status is reported alongside usage. (`d9d82e9`, `b2847a4`)
- AI changelog media proofing was rewritten to version 4 of the prompt with stricter heuristics — maintenance fixes, non-renderable support code, and desktop-only updater work are now filtered out of screenshot candidates, and proof framing was tightened for readability. (`8ef3f5b`, `2217600`, `43ac905`, `a0f9f63`, `4c104ae`, `60f4bab`)

## 5:11 PM — AURA 3D app debuts with image-to-3D generation and a WebGL viewer

A new AURA 3D studio landed at /3d, evolving from a tab scaffold into a working image generation + Three.js 3D preview flow in a single batch.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-a-webgl-viewe","batchId":"entry-2","slug":"aura-3d-app-debuts-with-image-to-3d-generation-and-a-webgl-viewe","alt":"AURA 3D app debuts with image-to-3D generation and a WebGL viewer screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-2-aura-3d-app-debuts-with-image-to-3d-generation-and-a-webgl-viewe -->

- Scaffolded the AURA 3D app in the registry at /3d with a left nav, Zustand store, and a three.js dependency set up for the upcoming viewer. (`1b20985`)
- Replaced the initial tab stubs with a single-page flow: SSE-streamed image generation on top, 3D model section below, plus a sidekick panel with Images and Models tabs and a ChatInputBar-style model selector. (`90887d5`)
- Added a WebGLViewer built on a Three.js 4-light scene with a GLTF loader that auto-centers and scales models, toggles for grid, wireframe, and texture, and an SSE-driven 3D generation flow via Tripo that picks up the generated source image automatically. (`8b2b861`)
- Shipped a project selector in the left nav behind the VITE_ENABLE_AURA_3D feature flag, with unit tests covering store transitions, generation completion, asset selection, and error handling. (`9cb954d`)

## 5:11 PM — Generation SSE proxy no longer drops data-only frames

A small but important fix to how the server proxies upstream generation events.

- The aura-router sometimes emits generation events as data-only SSE frames without a separate event line; the proxy now extracts the event type from the JSON payload so start/progress/completed frames are no longer silently dropped. (`e0d60fd`)

## 5:11 PM — AURA 3D gains artifact persistence, project-tree nav, and tabbed layout

A rapid second wave of AURA 3D work added backend persistence, reworked navigation to match the Projects app, and polished the generation surfaces.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-4-aura-3d-gains-artifact-persistence-project-tree-nav-and-tabbed-l","batchId":"entry-4","slug":"aura-3d-gains-artifact-persistence-project-tree-nav-and-tabbed-l","alt":"AURA 3D gains artifact persistence, project-tree nav, and tabbed layout screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-4-aura-3d-gains-artifact-persistence-project-tree-nav-and-tabbed-l -->

- Added an artifact persistence backend: new StorageProjectArtifact types and client methods in aura-os-storage, JWT-authenticated proxy handlers on aura-os-server, and routes under /api/projects/:id/artifacts — wired into the store so selecting a project loads its images and models, linked via parentId from image to 3D generation. (`d3ad5ec`, `f3dc0ae`, `e204d4c`, `5df2a3b`)
- Replaced the horizontal split with Image and 3D Model tabs, switched the left nav to the shared LeftMenuTree used by the Projects app, and surfaced generated images and models as children under each project. (`5f41de6`, `9250ebf`)
- Polished the studio surfaces: click-to-expand lightbox for generated images, icon-only viewer toggles, cycling progress messages during 3D generation, thumbnail grids in the sidekick, and a hidden Generate 3D button once a model is loaded. (`ddb0b7e`, `6229c31`)
- Removed the VITE_ENABLE_AURA_3D feature flag so AURA 3D is now always visible in the app registry, and required an active project before prompt input and 3D generation can run. (`6bbc5df`, `e204d4c`)

## 7:00 PM — Windows updater handoff fix and changelog media capture overhaul

A targeted Windows desktop fix shipped alongside a large rewrite of how changelog proof screenshots are captured and validated.

- Fixed the Windows updater handoff in the desktop shell, with accompanying updates to the desktop validate workflow and the local auto-update smoke script so the regression is caught on CI. (`bb28191`)
- Rebuilt the changelog media capture pipeline with a new demo-screenshot-quality module, a seed planner, and recorded navigation lessons — adding explicit quality gates and clearing stale media paths when a capture fails so broken screenshots no longer leak into the published changelog. (`0b64b22`, `9941234`, `7291956`)

## 11:41 PM — Mobile project shell redesign with a new Agents roster

The mobile project experience was rebuilt around a redesigned shell, a dedicated Agents roster view, and cleaner tab layouts.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-6-mobile-project-shell-redesign-with-a-new-agents-roster","batchId":"entry-6","slug":"mobile-project-shell-redesign-with-a-new-agents-roster","alt":"Mobile project shell redesign with a new Agents roster screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-6-mobile-project-shell-redesign-with-a-new-agents-roster -->

- Added a Project Agents roster as a first-class mobile destination at /projects/:id/agents, rewiring the bottom nav ("Agent" → "Agents"), HomeView redirects, and project layout so remembered projects land directly on the roster. (`6af2ee0`)
- Redesigned the mobile project shell — new drawer contents, topbar, and project navigation drawer with lazy-loaded Feedback, Feed, and Profile panels — and simplified drawer and sheet controls in a follow-up pass. (`ac6859e`, `7731ecd`)
- Chat gained a mobile model selector in the input bar, and the feedback composer now opens fullscreen on mobile instead of a cramped modal. (`4b20733`, `8b2db78`)
- Tightened up project tab layouts on mobile (Files, Tasks, Work, Stats, Process) and stopped surfacing raw remote gateway errors in the file explorer, backed by refreshed e2e coverage for mobile navigation. (`4a4e780`, `dabcfa7`, `26a8ea1`)

## Highlights

- New AURA 3D app with image + WebGL 3D generation
- Mobile project shell and agents roster redesign
- GPT-5.5 available in the model picker
- Windows auto-updater handoff fixed
- Nightly release pruning and gh-pages recovery hardened

