# Theming overhaul, agent modes, and a desktop menu bar

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.447.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.447.1

Today's nightly is a big one for surface polish and power-user controls. Aura ships a full light/dark theming system with custom token overrides and saved presets, a brand-new agent MODE selector that retargets the chat input between Code, Plan, Image, and 3D, an onboarding checklist for first-time users, and a native-style File/Edit/View/Help menu bar in the desktop titlebar — backed by a self-diagnosing auto-updater on Windows and macOS.

## 8:11 PM — Light mode, theming editor, and onboarding land together

A multi-phase theming program rebuilds Aura's surface system, adds a real Settings page with deep links, and ships a first-run onboarding checklist — alongside a clutch of chat reliability fixes.

- Introduced a full light/dark theming system: shell de-darkified onto CSS tokens, dynamic highlight.js theme, Settings → Appearance with mode and accent pickers, and titlebar / mobile topbar quick toggles that now flip cleanly between light and dark. (`e4a35e7`, `43d01ee`, `7f6bb74`, `79f001d`, `401d9fb`)
- Added a power-user theming editor: per-token overrides for sidebar, sidekick, titlebar and surface tints, plus named presets with JSON import/export and built-in Aura Dark / Aura Light baselines. (`aaee109`, `0928dc6`)
- Closed the long tail of light-mode contrast bugs across chat bubbles, rails, sidekick, modals and form inputs, with a lint guard that fails CI on raw color literals in migrated CSS modules. (`9f52c4e`, `8706839`, `085ff9a`, `f6cb146`)
- Reworked Settings into a sectioned view with /settings/:section deep links and folded Appearance + app settings into the taskbar gear modal so theme controls are finally reachable from the chrome. (`b94ad56`, `7ec29ea`)
- Shipped a first-run onboarding flow: a 2-step welcome modal, a floating 5-task checklist with auto-detection, prompt suggestions on empty chat, and a Help button in the taskbar to bring it back. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `11fc116`)
- Fixed two longstanding chat regressions: pinned the active history entry in the LRU to stop the CEO chat blink, and added a proactive cold-load reveal so re-entering CEO/MEOW no longer renders a black panel. (`3527198`, `4bc972e`)
- Made deleting an agent actually work end-to-end by cascading project-binding teardown through a shared hook, and stopped the chat-side self-heal from racing the cascade. (`95f172f`)
- Restored keyboard focus visibility app-wide after Phase 1 had suppressed all outlines, and added a boot/error fallback titlebar so the desktop window stays draggable and closable even when the React app fails to mount. (`e69bc31`, `d2848bd`)
- Hid the Debug app from the taskbar by default and aligned the Settings, Aura3D, and Apps modal title bars to the 32px sidebar-search rhythm for a calmer chrome. (`4b47c85`, `ac89c2f`)

## 12:42 PM — Slim 32px modal headers become the ZUI default

After a brief detour through an opt-in compactHeader prop, the slim modal header was promoted to the default in ZUI so every Aura modal lines up with the sidebar search bar.

- Baked the 32px control-height header straight into ZUI's Modal so Apps, Settings, and every other modal share one consistent title-bar rhythm without per-caller overrides. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mixpanel token wired into mobile nightly builds

Release infrastructure tweak so mobile nightlies pick up product analytics the same way the desktop pipeline does.

- Pass VITE_MIXPANEL_TOKEN through to the mobile nightly GitHub Actions workflow so analytics ship with Android builds. (`a60654c`)

## 12:48 PM — Agent MODE selector and a self-diagnosing desktop updater

Chat input gains a four-way MODE switch that retargets the whole send pipeline, while the desktop auto-updater finally tells you why an install died.

- Added a Code / Plan / Image / 3D MODE row above the chat input on desktop and mobile, persisted per agent and wired end-to-end so each mode steers the model list, slash-command behavior, and send pipeline. (`4165166`, `b35614b`, `375eb86`)
- Made the Windows + macOS auto-updater self-diagnosing: every install step is now appended to a daily desktop.log and updater.log, /api/update-status surfaces the last persisted state, and the UI exposes a 'Show updater logs' button and the failed step (e.g. 'Stopped at: Handoff spawned'). (`7f8e1d7`)
- Aura3D now remembers context across sessions: nav auto-hydrates the last project, and switching tabs or opening a project lands on the latest image (and its linked 3D model) instead of an empty editor. (`4f26758`)
- Extracted a shared InputBarShell so chat and Aura3D's prompt input render through one component, and tightened the agent editor by placing Name and Role side-by-side on wide viewports. (`c2f8653`, `a86946a`)
- Plumbed the Z_BILLING_API_KEY secret through the desktop nightly workflow and baked it into the binary via build.rs so billing-gated features work in shipped builds. (`d24847f`, `abc3392`)

## 3:07 PM — Bare-agent first chat self-heals its Home binding

Server-side fix that restores a missing Home-project binding on the chat hot path so a new user's first message to a freshly created agent no longer 422s.

- Restored the lazy Home-project binding repair on the deduped chat persistence path, so first chats with a brand-new agent succeed even when the create-time auto-bind silently failed. (`8b5b7d7`)

## 3:12 PM — Native-style desktop menu bar in the titlebar

A real File / Edit / View / Help menu bar lands in the desktop titlebar, with cross-platform shortcuts, zoom controls, multi-window support, and a final round of mode-selector polish.

- Added a File / Edit / View / Help menu bar to the desktop titlebar with hover-to-switch dropdowns, right-aligned shortcuts (Cmd glyphs on macOS, Ctrl+ on Win/Linux), context-aware Previous/Next Agent, and a new Rust-side IPC for opening secondary windows and toggling fullscreen. (`0bb9d92`, `3694dd6`)
- Polished the menu bar with theme-aware overlay tokens for hover/open states, lighter trigger weight, and the org avatar correctly seated to its left. (`0b40364`, `5c94d6a`, `917c64a`, `8d25e4a`)
- Settled the chat MODE pill animation after several iterations: the indicator now uses measured pixel positions written as inline transforms, sliding reliably between Code, Plan, Image, and 3D across browsers. (`7a6715a`, `45a46a8`, `32e45e1`, `bbb8eae`, `708a892`, `840f241`)
- Cleaned up several small light-mode papercuts: the org switcher's avatar ring and dropdown are theme-aware, team avatar fallbacks match user/agent ones, the image-crop zoom knob ring is visible again, and the cooking indicator clears the taller input bar. (`5b35a3b`, `57aca98`, `e4b9402`, `ca3cf0a`, `bea9919`, `ee74d74`)
- Kept slash-command chips inline in the input bar so MODE + chips share the same row without wrapping. (`91fac39`)

## Highlights

- Light mode lands across the app with editable tokens and saved presets
- Agent chat gains a Code / Plan / Image / 3D mode selector
- Desktop titlebar gets a real File/Edit/View/Help menu bar
- Auto-updater now writes its own diagnostic logs on Windows and macOS
- First-run onboarding: welcome modal, checklist, and prompt suggestions

