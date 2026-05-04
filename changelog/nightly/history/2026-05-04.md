# Theming overhaul, agent modes, and a self-diagnosing desktop updater

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.446.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.446.1

A heavy day for Aura: the app gained a real light/dark theming system with custom tokens and presets, an end-to-end agent MODE selector for chat, a native-style desktop menu bar, and a long-overdue diagnostic backbone for the auto-updater. Onboarding, settings navigation, and chat reliability all picked up meaningful improvements alongside.

## 8:11 PM — Theming, settings, onboarding and a long chat-reliability sweep

The bulk of the day landed in one long thread: a multi-phase theming system, a sectioned Settings surface, the first onboarding flow, and a series of fixes for stubborn chat and desktop-shell bugs.

- Shipped a full light/dark theming system: shared token layer with light/dark variants, a Settings > Appearance section with theme-mode and accent pickers, a titlebar quick toggle, dynamic highlight.js theme, and migration of process canvas, xterm, sidekick log, chat input, IDE, preview, billing modals and more off raw hex onto tokens — guarded by a lint:colors check against module CSS color literals. (`e4a35e7`, `43d01ee`, `7f6bb74`, `3424cb5`, `47721ec`, `aca46ec`, `7d2fb89`, `c56ba50`, `4281fd0`, `fe9bfeb`, `53bc7a4`, `1ca212d`, `abb325f`, `f6cb146`, `8277208`)
- Layered an advanced theming editor on top: per-token chrome overrides for sidebar, sidekick, titlebar and surface tints persisted per resolved theme, plus named presets with rename/delete/import/export to JSON and built-in Aura Dark / Aura Light presets. (`aaee109`, `0928dc6`)
- Made light mode actually usable: routed chat bubbles, rails, sidekick, modals and mobile screens through theme-aware tokens, fixed the AURA wordmark to invert on light backgrounds, kept the user message bubble dark for sender contrast, and flattened dark side panels to match the taskbar background. The titlebar toggle is now a clean two-state light/dark switch with icon and aria-label reflecting the resolved theme. (`9f52c4e`, `085ff9a`, `ee63308`, `401d9fb`, `8706839`, `f111847`, `6fe2f64`)
- Restructured Settings into About / Appearance / Notifications / Keyboard / Advanced sections with /settings/:section deep links and a matching mobile drill-in screen, then merged the app-level Appearance controls into the taskbar gear's Settings modal so theme controls are finally reachable from the desktop chrome. A mobile theme toggle now sits in the persistent topbar. (`b94ad56`, `79f001d`, `7ec29ea`)
- Introduced a first-run onboarding experience: a Zustand-backed onboarding store with localStorage persistence, a 2-step welcome modal, a floating bottom-right checklist with progress, a help button in the taskbar, and a task watcher that auto-completes steps as the user sends a first message, creates a project or agent, generates an image, or opens billing — with baseline counting so pre-existing defaults don't falsely complete tasks. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `ec62961`, `11fc116`, `779d737`, `0d96fae`, `2f9dbb1`, `8d0ab5a`)
- Closed two long-standing chat regressions: the CEO chat "blink" caused by the LRU evicting the active history key under sidebar prefetch is now fixed by pinning the active key, and a separate "black panel on cold reload" caused by a one-shot anchor-ready gate is solved by a proactive transcript reveal that no longer depends on signal ordering. (`3527198`, `4bc972e`)
- Tightened the agents experience: deleting a template now cascades through every project binding (with a confirm modal that lists the projects, and a server-side guard against the chat-side self-heal racing the cascade), and the agent's Projects tab annotates Home bindings that live in another org or are archived. Debug is hidden from the taskbar by default in a way that still respects user customization. (`95f172f`, `4b47c85`)
- Restored keyboard focus visibility across the app by removing the global outline:none override and adding a single :focus-visible base rule wired to the focus-ring token. (`e69bc31`)
- Hardened the desktop shell with a native-HTML fallback titlebar in index.html so window controls remain draggable and closable even when React fails to mount (dev-server unreachable or boot error overlay). (`d2848bd`)
- Polished titlebar chrome: aligned theme/host icons with the sidekick and window-control buttons on a unified 14px / size-sm rhythm, and rendered the sidekick drawer toggle in primary text color when open instead of the accent-glow selected state. (`3199ec4`, `401d591`)
- Fixed a desktop boot regression where REQUIRE_ZERO_PRO defaulted to true when the env var was unset, by defaulting it to false in both the server and the desktop build. (`ae418f3`, `d987125`)
- Aligned the Settings, Aura3D, and Apps modal title bars to a 32px height that matches the sidebar search input, via an opt-in compactHeader on the ZUI Modal. (`ac89c2f`)
- Wired VITE_MIXPANEL_TOKEN into the desktop nightly workflow so analytics ship with nightly builds. (`814d663`)
- Continued large-file decomposition without behavior changes: PermissionsTab, aura-events, notes-store, chat-history-sync, shared entities, AgentEnvironment, and the stream handler test suite were each split into focused modules behind preserved import paths. (`78c08f2`, `3ee06ea`, `60f0af6`, `f2b997e`, `1d3e8e8`, `e57e0be`, `0b2c8a5`, `671d0b2`)

## 12:42 PM — Slim 32px modal header becomes the ZUI default

A short follow-up that promoted the compact modal header from an opt-in to the default across ZUI.

- Introduced compactHeader on ZUI Modal, applied it to the Apps and Settings modals, then promoted the 32px header to the ZUI Modal default and dropped the now-redundant prop and per-caller overrides. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mixpanel token now flows to mobile nightly builds

Mirrored the desktop change earlier in the day for the mobile nightly pipeline.

- Pass VITE_MIXPANEL_TOKEN through to the mobile nightly workflow so Android builds ship with analytics configured. (`a60654c`)

## 12:48 PM — Agent MODE selector and a self-diagnosing desktop updater

Two large pieces landed back-to-back: an end-to-end Code/Plan/Image/3D mode selector across the chat input, and a diagnostic backbone for the desktop auto-updater so the silent "click Install and nothing happens" failure mode finally has visibility.

- Added a per-agent MODE selector (Code, Plan, Image, 3D) above every chat input on desktop and mobile. Selection persists like the model picker and steers the entire pipeline: image and 3D modes inject their slash commands on send, Plan switches to spec generation, the model list narrows per mode, and /image and /3d become keyboard shortcuts. Behavior is modeled as discriminated unions so the wire shape stays clean. (`4165166`, `b35614b`, `375eb86`)
- Made the desktop auto-updater self-diagnosing: tracing now writes to a daily file under <data_dir>/logs even on Windows GUI builds, every install step is appended to updater.log with a single-record updater-state.json, a boot-time reconcile surfaces failed steps if a previous attempt died, the Windows handoff is gated on a sentinel file so Aura no longer exits when PowerShell never starts, and macOS replaces process::exit with a graceful ShutdownForUpdate handshake. UpdateControl exposes the failed step and a "Show updater logs" button. (`7f8e1d7`)
- Aura3D now remembers context across sessions: the nav hydrates from the last selected project (or falls back to the most recently created one), tab switches auto-pick the latest image and its linked model or the latest model, and loading a project's artifacts seeds sensible default selections instead of an empty pane. (`4f26758`)
- Extracted a shared InputBarShell from the chat input and the Aura3D prompt input so both surfaces converge on one shell, model picker, and styling system — setup work that the new MODE selector then plugs into. (`c2f8653`)
- Tuned secondary chrome details: agent editor now lays Name and Role side-by-side with a single-column fallback under 640px, and onboarding only completes create tasks when counts exceed the user's initial defaults. (`a86946a`, `c9514db`)
- Plumbed the Z_BILLING_API_KEY secret through the desktop nightly workflow and baked it into the desktop binary via build.rs so billing-dependent features work in shipped builds. (`d24847f`, `abc3392`)

## 3:07 PM — Self-heal restored on the bare-agent first-chat path

Closed a 422 regression where new users hit a missing aura_session_id on their first chat with a fresh agent.

- Restored the Home-project binding self-heal on the deduped chat hot path so a transient failure during agent create no longer leaves the next first-chat turn returning a 422 missing-session-identity error. The repair is shared with reset_agent_session and busts the per-(jwt, agent_id) discovery cache before persistence and history loading run. (`8b5b7d7`)

## 3:12 PM — Desktop menu bar lands and the mode pill animation finally sticks

Two threads dominated the evening: a real File/Edit/View/Help menu bar in the desktop titlebar, and a long iteration to make the chat MODE selector pill actually animate between segments instead of snapping.

- Added a native-style File/Edit/View/Help menu bar to the left of the org icon in the desktop titlebar, with hover-to-switch dropdowns, cross-platform shortcut formatting (Cmd glyphs on macOS, Ctrl+ on Windows/Linux), and global hotkey handlers. Coverage includes New Agent / New Window / New Project / Settings / Exit, sidekick toggle, zoom in/out/reset, previous/next agent (context-aware over standalone vs project agents), and toggle full screen. New Rust IPC commands back ToggleFullscreen and OpenMainWindow, and secondary main windows are tracked and closed independently of the app lifecycle. (`0bb9d92`, `3694dd6`, `0b40364`, `5c94d6a`, `917c64a`)
- Iterated the chat mode selector pill to a stable animation: after a CSS-grid/variable approach and a FLIP-style ref pattern both raced React's commit timing, the final fix drives transform via inline React style with measured pixel positions from getBoundingClientRect plus a ResizeObserver, so the pill reliably slides between Code, Plan, Image, and 3D. (`7a6715a`, `45a46a8`, `32e45e1`, `bbb8eae`, `708a892`, `840f241`)
- Cleaned up surrounding chat chrome: kept slash command tags inline in the input, lifted the cooking indicator clear of the now-taller input bar, and aligned its label with message text. (`91fac39`, `bea9919`, `ee74d74`)
- Finished light-mode polish for small UI bits: the org switcher dropped its hardcoded black ring and avatar slab in favor of theme-aware tokens, team avatars now use the same fallback tint as user/agent avatars, and the image-crop zoom knob's broken --color-primary reference was replaced with --color-accent so the ring renders in both themes. (`5b35a3b`, `57aca98`, `e4b9402`, `ca3cf0a`)

## Highlights

- Full light/dark theming with custom tokens, presets, and JSON import/export
- Agent MODE selector (Code/Plan/Image/3D) above every chat input
- Self-diagnosing desktop auto-updater on Windows and macOS
- Native File/Edit/View/Help menu bar in the desktop titlebar
- Onboarding welcome flow and checklist with task auto-detection
- Sectioned Settings with deep links, merged into the taskbar gear

