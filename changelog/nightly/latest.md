# Theming overhaul, agent modes, and a self-diagnosing desktop updater

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.449.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.449.1

A heavy-traffic nightly day: Aura gained a real light/dark theming system with custom tokens and presets, a brand-new agent MODE selector, a native-style desktop menu bar, an onboarding flow for first-time users, and — critically — a deeply instrumented Windows/macOS auto-updater that can finally explain why an install failed.

## 8:11 PM — Light/dark theming, sectioned Settings, and onboarding flow land together

A 14-phase theming program ships end-to-end: tokens, light mode, custom token editor with named presets, mobile and desktop toggles, plus a sectioned Settings modal and a first-run onboarding experience.

- Replaced the always-dark shell with a real light/dark theming system: extracted tokens.css with light/dark variants, added a pre-React theme stamper, dynamic highlight.js theme switching, and a Settings > Appearance section with a titlebar quick toggle. Process canvas, xterm, and chrome surfaces (sidebar, sidekick, titlebar) were migrated to tokens, and a CSS lint guard now blocks raw color literals from regressing migrated modules. (`e4a35e7`, `43d01ee`, `7f6bb74`, `3424cb5`, `47721ec`, `aca46ec`, `7d2fb89`, `c56ba50`, `4281fd0`, `fe9bfeb`, `53bc7a4`, `1ca212d`, `abb325f`, `f6cb146`)
- Added a per-token theme editor with native color pickers and per-row reset, plus named presets with JSON import/export — built-in Aura Dark and Aura Light ship by default, and user presets persist alongside working overrides. (`aaee109`, `0928dc6`)
- Made light mode actually usable: chat bubbles, rails, sidekick, modals, and form inputs now route through theme-aware tokens so white-on-white surfaces are gone, the user message bubble stays dark for sender contrast, and the AURA wordmark inverts in light mode. (`9f52c4e`, `085ff9a`, `8706839`, `ee63308`, `6fe2f64`)
- Simplified the titlebar/topbar theme button to a binary light↔dark switch with a mobile counterpart in MobileTopbar, and unified the chrome icon sizes alongside the sidekick and window controls. (`79f001d`, `401d9fb`, `401d591`, `3199ec4`)
- Restructured Settings into deep-linkable sections (About, Appearance, Notifications, Keyboard, Advanced) at /settings/:section, and folded the App-scoped sections into the taskbar gear modal so theme controls are finally reachable from desktop chrome. (`b94ad56`, `7ec29ea`, `ac89c2f`)
- Shipped a first-run onboarding experience: a 2-step welcome modal, a floating 5-task checklist with auto-detection, a help button in the taskbar, prompt suggestions and a pulsing input on empty chat, plus better empty-state copy for agents and tasks. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `11fc116`, `779d737`, `0d96fae`, `2f9dbb1`, `8d0ab5a`, `ec62961`)
- Fixed the long-standing CEO chat blink and black-panel failures: pinned the active history key in the chat-history LRU so background prefetches can't evict it, and made ChatPanel's cold-load reveal robust to either ordering of historyResolved and the first messages frame. (`3527198`, `4bc972e`)
- Restored keyboard focus visibility app-wide by removing a global outline:none from Phase 1 and introducing a single :focus-visible base rule using the theme's focus-ring token. (`e69bc31`)
- Fixed agent deletion as a dead-end: a new useCascadeDeleteAgent hook tears down project bindings before deleting the template, the confirm modal lists which projects will be detached, and the server's auto-bind no longer races the cascade. (`95f172f`)
- Kept window controls reachable when the React app fails to mount by adding a native-HTML fallback titlebar that shares the wry IPC bridge for minimize/maximize/close/drag. (`d2848bd`)
- Hid the Debug app from the taskbar by default via a new defaultHidden flag in the app registry, distinguishing 'never seeded' from 'user cleared' so dragging Debug into Visible persists. (`4b47c85`)
- Broke up several oversized files (PermissionsTab, aura-events, notes-store, entities, AgentEnvironment, stream handlers tests, use-chat-history-sync) into focused modules and converted key default exports to named, with no behavior change. (`78c08f2`, `e57e0be`, `3ee06ea`, `60f0af6`, `f2b997e`, `1d3e8e8`, `0b2c8a5`, `8277208`, `671d0b2`)
- Hardened release plumbing: defaulted REQUIRE_ZERO_PRO to false in server and desktop builds, and started passing VITE_MIXPANEL_TOKEN into the desktop nightly workflow. (`ae418f3`, `d987125`, `814d663`)

## 12:42 PM — Slim modal headers align with the sidebar search row

Modal headers were unified at 32px so Apps, Settings, and other modals visually line up with the sidebar search input.

- Promoted the 32px compact header to a first-class ZUI Modal API and applied it to Apps and the renamed Settings modal, then made the slim header the default for every modal so callers no longer need an opt-in flag. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mixpanel token wired into mobile nightly builds

Release Infrastructure: VITE_MIXPANEL_TOKEN is now passed to the mobile nightly workflow alongside the desktop one.

- Forwarded VITE_MIXPANEL_TOKEN into the mobile nightly GitHub Actions workflow so analytics are populated on built mobile artifacts. (`a60654c`)

## 12:48 PM — Agent MODE selector and a self-diagnosing desktop auto-updater

Chat input gains a Code/Plan/Image/3D mode selector backed by a shared input bar shell, while the desktop updater is rebuilt around on-disk diagnostics and boot-time reconciliation.

- Added a MODE row above the chat input on desktop and mobile with four mutually-exclusive modes (Code, Plan, Image, 3D), persisted per-agent. Image and 3D inject the matching slash commands at send time, Plan flips action=generate_specs, and the selection is modeled as a discriminated union all the way through ResolvedSend. (`4165166`, `b35614b`, `375eb86`)
- Extracted a shared InputBarShell from ChatInputBar and the Aura3D PromptInput so chat and 3D prompt surfaces now share the same chrome, model picker, and layout primitives. (`c2f8653`)
- Rebuilt the desktop auto-updater to be self-diagnosing on Windows and macOS: a daily desktop.log, an updater.log shared with the PowerShell handoff, an updater-state.json reconciled on boot, a sentinel-gated Windows exit so PowerShell failures don't kill Aura, a graceful macOS shutdown handshake, new /api/update-status diagnostics and reveal-logs/stage-only endpoints, and a 'Show updater logs' button in UpdateControl. (`7f8e1d7`)
- Aura3D now remembers context across sessions: the nav hydrates the last-opened project, switching tabs auto-selects the latest image (and any linked 3D model) or latest model, and loading project artifacts seeds sensible defaults so users no longer land on an empty editor. (`4f26758`)
- Tightened the agent editor by laying Name and Role side-by-side in a 2-column grid that collapses on narrow viewports, and refined onboarding so create-tasks only complete when the count exceeds the user's pre-existing defaults. (`a86946a`, `c9514db`)
- Threaded Z_BILLING_API_KEY through the desktop nightly workflow and baked it into the desktop binary at build time so production builds can reach the billing API. (`d24847f`, `abc3392`)

## 3:07 PM — First-chat self-heal restored for freshly created agents

Server: bare-agent first chats no longer hit a 422 when the create-time Home-project auto-bind silently fails.

- Promoted lazy_repair_home_project_binding into the deduped chat hot path so a missing Home binding is now repaired on the first chat turn instead of returning 'Required session identity field aura_session_id is missing', closing a regression introduced when the CEO-preset latency optimization moved off the legacy persistence wrapper. (`8b5b7d7`)

## 3:12 PM — Desktop menu bar, update pill, and the long fight with the mode selector animation

A native-style File/Edit/View/Help menu bar lands in the desktop titlebar, the auto-updater surfaces as a compact pill, and the chat mode selector's sliding indicator finally animates reliably.

- Added a File/Edit/View/Help menu bar to the desktop titlebar with hover-to-switch dropdowns, right-aligned shortcuts that render Cmd glyphs on macOS and Ctrl+ on Win/Linux, and a global shortcut dispatcher. Coverage includes New Agent/Window/Project, Settings, Toggle Sidekick, Zoom In/Out/Reset, Previous/Next Agent, Toggle Full Screen, and Help links — backed by new Rust IPC commands for toggle_fullscreen and new_window plus a secondary-window registry in the desktop runtime. (`0bb9d92`, `3694dd6`)
- Polished the menu bar chrome: gave the open trigger a properly themed overlay-heavy pill, rounded the hover/open state to 4px, dropped trigger weight to regular, moved the org avatar to the far left of the leading slot, aligned it with the bottom-left desktop pill, and removed a stray leading divider in View. (`0b40364`, `5c94d6a`, `917c64a`, `8d25e4a`, `8bf0278`, `9a46409`)
- Replaced the floating bottom-left UpdateBanner with a compact primary-variant Update pill in the titlebar's right rail, mirroring the existing useUpdateBanner state machine (Update / Installing… / hidden); mobile keeps the legacy banner. (`c4a25d4`)
- Iterated through several attempts before landing a reliable mode selector pill animation: the indicator is now absolutely positioned, driven by getBoundingClientRect measurements with a ResizeObserver, and writes its transform as an inline style so the browser sees a real property change between segments. Labels are centered and the cooking indicator was lifted to clear the taller input bar. (`7a6715a`, `45a46a8`, `32e45e1`, `bbb8eae`, `708a892`, `840f241`, `bea9919`, `ee74d74`, `91fac39`)
- Replaced the fragile Windows PowerShell updater handoff with a cmd.exe .bat: AMSI/ExecutionPolicy delays no longer trip the sentinel deadline (now 30s soft / 60s hard), spawned stdout/stderr is captured into the stage directory and tailed into updater.log on failure, and an early child exit is detected via try_wait so the user gets the actual exit code instead of a generic timeout. (`3286f2c`)
- Unified the desktop right-click menu so right-clicking empty taskbar chrome opens the same menu as the desktop surface, with edge-aware pre-anchoring to keep menus on-screen near the taskbar and a new Settings entry. (`de0dd0f`, `bcb603e`)
- Tidied light-mode chrome: dropped the pixelated 1px ring on the org-selector team avatar, switched its dropdown background and the avatar fallback bg to theme-aware tokens, and restored the ImageCropModal zoom knob ring by routing it through --color-accent. (`5b35a3b`, `57aca98`, `e4b9402`, `ca3cf0a`)

## Highlights

- Full light/dark theming with custom tokens and presets
- New Code/Plan/Image/3D mode selector in chat
- Desktop File/Edit/View/Help menu bar with global shortcuts
- Self-diagnosing auto-updater with on-disk logs and reconciliation
- First-run onboarding: welcome modal, checklist, and prompt suggestions
- Sectioned Settings consolidated into a single Settings modal

