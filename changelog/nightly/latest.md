# AURA Video launches, Windows startup self-heal, and chat input overhaul

- Date: `2026-05-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.506.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.506.1

A heavy day across the stack: a brand-new AURA Video app lands end-to-end, the Windows desktop client gains a self-healing settings store and a real "could not start" dialog, and the chat input bar picks up @-mention file context, persistent drafts, and a long sweep of pixel-level polish. Release pipelines also got tougher against flaky GitHub uploads and Apple notary outages.

## 7:59 AM — @-mention file context, persistent drafts, and feedback authoring

Chat picks up file autocomplete and draft persistence, while the feedback sidekick gains inline comments and author-controlled status changes.

- Typing @ in a project-scoped chat now opens a file autocomplete that attaches the picked file through the same S3 upload pipeline as drag-and-drop, with a synchronous placeholder chip so a fast double-Enter no longer races the file read and sends the message empty. (`0699f92`, `ec99e57`)
- Unsent chat prompts now persist per session in the chat UI store, so switching sessions or navigating away and back restores the text you were typing (attachments and slash chips still reset with the session). (`7407754`)
- The feedback Details tab now shows an inline newest-first comment list, and submitting authors can change Status directly from a scoped dropdown (current → Not Started / Done / Deployed) to close their own items in one click. (`9215324`)
- Added an Invite Friends modal triggered from a new pulsing taskbar button, and introduced separate border tokens so users can tint the desktop lane borders independently from the topbar and taskbar chrome in Settings → Appearance. (`11dcaf4`, `3540be2`)
- Fixed a Windows-only IDE window auth bug by sharing the main webview's WebContext, so the IDE inherits the live session instead of rendering 'missing authorization token' for every file API call. (`f9ac248`)

## 9:52 AM — Self-healing release uploads via reconcile-and-retry

Release jobs no longer fail outright when GitHub drops a single asset upload mid-flight.

- Added a reconcile script that diffs local artifacts against the published release and re-uploads only missing or wrong-sized assets with retries on transient EPIPE / ECONNRESET / 'other side closed' errors. Wired into every release flow (immutable nightly, nightly alias, stable, mobile-nightly) so a single dropped softprops upload no longer reds an entire 40-minute pipeline. (`d08885c`)

## 10:41 AM — Unified sidekick width and cleaner desktop lane shaping

The desktop shell simplifies sidekick sizing and tightens the visual treatment of its main lanes.

- The sidekick lane now uses a single shared width across every app instead of per-app persistence and on-switch retargeting, with a one-time migration from the legacy keys so existing users keep their preferred size. (`efe1f31`)
- Replaced the inset divider against the sidekick with explicit rounded corners on the sidebar, main panel host, and sidekick lane, with the main panel only rounding its right edge when the sidekick is collapsed. (`7d60929`)
- Empty-chat prompt suggestions now appear only during onboarding and disappear the moment a user sends their first-ever message. (`d08ec6b`)

## 11:26 AM — AURA Video app and a no-more-silent-exit Windows fix

A new end-to-end video generation app lands alongside a major Windows reliability fix and a wave of taskbar and sidebar polish.

- Shipped AURA Video as a standalone app: Veo Fast/Standard/Lite models, a /api/generate/video/stream proxy reusing the harness pipeline, a Zustand-backed store, prompt input with model picker and progress UI, a left-nav project tree, and a sidekick gallery with thumbnail grid and context-menu delete. (`b56deec`, `d740587`, `f82551b`, `2775e2f`)
- Fixed Windows installs that launched silently after a torn settings.json write: the store now quarantines corrupt files and returns an empty CF, persist now fsyncs before rename so atomic-rename actually holds across crashes, and a fatal startup failure now pops a native 'AURA could not start' dialog pointing at the crash log instead of vanishing into the windowed subsystem. (`6591e07`)
- Restored agent memory loading by reverting reads to the bare template id the harness keys on, with strongly-typed extractors that reject malformed ids at the proxy edge instead of forwarding 400s. (`a7c70aa`)
- Reworked the bottom taskbar: collapsed the right cluster to a profile-only default behind a chevron, moved the day/night theme toggle into the taskbar pills next to Help, and iterated the Earn Credits / Invite CTAs through several placements before landing the EARN pill in the titlebar action row. (`df125f6`, `a214178`, `3c50616`, `677c33f`, `e0f5791`, `aa45bee`, `0338e1d`, `c44941d`)
- Polished the mode selector and sidebar highlights: equal-width segments stop the active pill's border from jittering during slides, the selected segment now fills with accent + contrast text, the redundant MODE label is gone, and sidebar/sidekick row highlights share a single inset pill style. (`e20c9a1`, `6d00de8`, `c039c02`, `3ff6733`, `e064f2c`, `f6646fe`, `e34befd`)

## 2:50 PM — Mac packaging retries on Apple notary outages

Transient Apple notary failures no longer red the macOS packaging job.

- Extended the desktop packaging retry matcher so xcrun notarytool HTTP 429 and 5xx responses (in addition to existing hdiutil 'Resource busy' flakes) trigger a retry instead of aborting the macOS release. (`d9aaba8`)

## 2:59 PM — Standalone agents chat pinned to Home, plus input bar refinement

Standalone agent chats get a consistent Home picker and a decoupled wire project id, while the chat input picks up a shared icon-button hover system and many alignment fixes.

- Standalone Agents-app chats now always render the project picker as a single non-interactive 'Home' entry — auto-bound for new agents and synthesized for legacy bindings — and a new llmProjectId prop decouples the wire body.project_id from the picker label so fresh canvases ship Home, existing sessions ship their session-of-record's project, and legacy agents trigger a server-side lazy heal plus local refresh. (`5018182`, `758c18f`, `1d75419`)
- Reset paths now only drop ?session= (not the whole URL triple), keeping AgentChatPanel mounted on the agents-shell route so the optimistic 'New chat' row survives in the sidekick and the transcript clears via freshCanvasPending instead of re-fetching the full timeline. (`f28e2c6`, `22a6fca`)
- Introduced a shared inner-plate icon hover treatment driven by --icon-hover-inset / --icon-hover-radius / --icon-hover-bg tokens, applied across the taskbar, app nav rail, and the input bar's attach, send, and new-chat buttons, with centering safeguards and a new icon-system.md as the source of truth. (`ed75519`, `60fdc4a`, `a102b47`, `abfd57e`, `de29952`, `5d07c04`, `5e7df7d`, `f09317b`)
- Stopped the mode-selector pill from sliding on every app switch or post-mount layout shift by suppressing SlidingPills' transition for non-user-driven updates and only animating when the controlled value actually changes. (`21f0a38`)
- Tightened chat transcript and input chrome: desktop inter-message gap bumped from 2px to 8px, image-only user messages get extra bottom margin, generated-image wrappers clip their rounded frame, corner buttons share a 2px inset, the mode-bar divider spans the full row, and the Code-mode placeholder now hints '/ for commands, @ for context'. (`fad2fd4`, `a03fe79`, `2dd33dd`, `f68b5c6`, `64ba005`, `053f04c`, `43ba1eb`, `249f6f6`, `b3d6b61`)

## Highlights

- AURA Video app shipped with Veo models, gallery, and SSE streaming
- Windows installer no longer fails silently on corrupt settings
- @-mention file context in chat with persistent drafts
- Release pipeline survives dropped uploads and Apple notary 5xx
- Standalone agents chat now pinned to a consistent Home project

