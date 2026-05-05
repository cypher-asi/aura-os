# Themeable shell, agent modes, and a self-diagnosing updater

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.450.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.450.1

A big day for Aura's surface area: light mode finally works end to end with editable themes and presets, the desktop chrome gains a proper menu bar and an in-titlebar Update pill, the chat input picks up a Code/Plan/Image/3D mode selector, and the Windows/macOS auto-updater is rebuilt to log every step instead of silently dying. New users get an onboarding checklist, and a couple of nasty chat reliability bugs (CEO blink, black panel, first-chat 422) are fixed at the root.

## 8:11 PM — Themeable shell, sectioned settings, and onboarding land together

A long phased push tokenized the UI, shipped a real Appearance editor with presets, made light mode actually usable across the app, restructured Settings, and introduced a first-time onboarding flow.

- Introduced a full theming system: design tokens with light/dark variants, a Settings → Appearance section, titlebar and mobile quick toggles, dynamic highlight.js/xterm theming, and migrated the process canvas, sidekick log, IDE, browser bar, billing modal, and other surfaces off raw hex values onto tokens — with a lint guard against new color literals. (`e4a35e7`, `43d01ee`, `7f6bb74`, `3424cb5`, `47721ec`, `aca46ec`, `7d2fb89`, `c56ba50`, `4281fd0`, `fe9bfeb`, `53bc7a4`, `1ca212d`, `abb325f`, `f6cb146`, `79f001d`, `8277208`)
- Built an Appearance editor with per-token color overrides and named presets — including JSON import/export and built-in Aura Dark/Light — backed by a ThemeOverridesBridge that re-applies overrides on every theme switch. (`aaee109`, `0928dc6`)
- Made light mode genuinely visible: rerouted hardcoded #fff/#000 in chat bubbles, ChatPanel, LLM output, nav rails, sidekick, project lists, modals, and mobile screens through theme-aware tokens; bumped light-mode contrast to WCAG AA; inverted the AURA wordmark in light mode; and pinned the user message bubble dark in both themes for sender contrast. Form inputs now use dedicated input tokens so ZUI Input/Search/Textarea/Select stop disappearing on white. (`9f52c4e`, `085ff9a`, `8706839`, `ee63308`, `6fe2f64`)
- Reworked Settings into deep-linkable /settings/:section routes (About, Appearance, Notifications, Keyboard, Advanced) on desktop and a list-then-detail pattern on mobile; folded the standalone Appearance surface into the taskbar gear modal so theme controls are discoverable, and aligned the Settings/Aura3D/Apps modal title bars with the sidebar search at 32px. (`b94ad56`, `7ec29ea`, `ac89c2f`)
- Restored keyboard focus visibility everywhere by removing the global outline:none reset and adding a single :focus-visible base rule, and switched the titlebar/topbar theme button from a 3-state cycle to a binary light↔dark toggle that reflects the resolved theme. (`e69bc31`, `401d9fb`, `401d591`, `3199ec4`)
- Shipped first-time onboarding: a 2-step welcome modal, a portal-rendered checklist of 5 starter tasks (send a message, create a project/agent, generate an image, explore billing) with auto-detection that ignores pre-existing defaults, prompt suggestion chips and a pulsing input on empty chat, friendlier empty states for agents and tasks, and a Help button in the taskbar. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `11fc116`, `779d737`, `0d96fae`, `2f9dbb1`, `8d0ab5a`, `ec62961`)
- Fixed two long-standing chat reliability bugs: pinned the active history key in the LRU so background sidebar prefetches no longer evict and blink the CEO chat, and added a proactive cold-load reveal in ChatPanel so the transcript can't get stuck black when historyResolved arrives after the first commit. (`3527198`, `4bc972e`)
- Cascade-deleting an agent now tears down every project binding (including the auto-created Home one) in a single confirm flow, with the modal listing exactly which projects will be detached and the server skipping its auto-bind once the template is gone. (`95f172f`)
- Hid Debug from the taskbar by default (it now seeds into the Apps modal's Hidden section instead of cluttering the visible strip), kept window controls accessible on the boot/error overlay via a native fallback titlebar, and defaulted REQUIRE_ZERO_PRO to false in both desktop and server builds. (`4b47c85`, `d2848bd`, `ae418f3`, `d987125`)
- Started piping VITE_MIXPANEL_TOKEN into the desktop nightly build so analytics work in shipped binaries. (`814d663`)

## 12:42 PM — ZUI modals adopt a 32px header by default

After two iterations on an opt-in flag, the slim 32px modal header was promoted to the ZUI default so every modal lines up with the sidebar search row.

- Added a compactHeader prop on ZUI Modal, applied it to the Apps and Org Settings modals, then promoted the slim 32px header to the default for all ZUI modals — so the new chrome is consistent without per-caller overrides. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mixpanel token wired into mobile nightly builds

Mobile nightly CI now receives the analytics token alongside desktop.

- Mobile nightly release workflow now passes VITE_MIXPANEL_TOKEN through to the build so analytics are populated on Android nightlies. (`a60654c`)

## 12:48 PM — Agent MODE selector and a self-diagnosing desktop updater

The chat input gains a Code/Plan/Image/3D mode that steers the whole send pipeline, Aura3D remembers its last context, and the desktop auto-updater is rebuilt to actually report what went wrong.

- Added a Code/Plan/Image/3D mode row above the chat input on desktop and mobile. Selection is persisted per agent, drives model lists, injects /image, /3d, or generate_specs into the send pipeline, and is modeled as a discriminated union so each mode has the right field shape end to end. (`4165166`, `b35614b`, `375eb86`)
- Rebuilt the Windows + macOS auto-updater into a self-diagnosing pipeline: every install step now appends to a persistent updater.log and updater-state.json, a reconcile pass on boot reports the last failed step, the macOS path swapped process::exit for a graceful shutdown handshake, and the UpdateControl UI surfaces "Stopped at: …" plus a Show updater logs button. New /api/update-reveal-logs and a debug-only stage-only endpoint round it out. (`7f8e1d7`)
- Aura3D now hydrates a sensible starting context: it remembers the last project across sessions, expands its tree on first paint, and auto-selects the latest image (with linked 3D model) or latest model when you switch tabs into an empty pane. (`4f26758`)
- Extracted a shared InputBarShell so the chat input and Aura3D PromptInput share one chrome, simplifying future input work, and rearranged the Agent editor's Name/Role fields into a 2-column layout that collapses on narrow screens. (`c2f8653`, `a86946a`)
- Tightened onboarding completion so the create-project and create-agent tasks only fire when the count truly grows beyond the user's pre-existing defaults, and threaded the Z_BILLING_API_KEY secret into both the desktop nightly workflow and the desktop binary via build.rs. (`c9514db`, `d24847f`, `abc3392`)

## 3:07 PM — First chat with a new agent self-heals its Home binding

Closed a 422 on a brand-new user's first turn caused by a missing project_agent binding when the create-time auto-bind silently failed.

- When the deduped chat hot path finds no matching project_agent rows for a freshly created agent, it now runs the same lazy_repair_home_project_binding the legacy wrapper used to call, busting the discovery cache so SessionConfig.aura_session_id is populated and the Tier-1 chat preflight stops returning 422 "aura_session_id is missing". (`8b5b7d7`)

## 3:12 PM — Desktop titlebar gains a real menu bar, Update pill, and shared right-click menu

An evening of desktop-chrome work: a File/Edit/View/Help menu bar with cross-platform shortcuts and a new-window IPC, an in-titlebar Update pill replacing the floating banner, a shared desktop/taskbar context menu, and a more reliable Windows updater handoff.

- Added a native-style File/Edit/View/Help menu bar to the desktop titlebar with hover-to-switch dropdowns, right-aligned shortcuts that render Cmd glyphs on macOS and Ctrl+ on Win/Linux, View-menu zoom controls persisted to localStorage, and a new IPC path that lets New Window spawn a second main window without exiting on close. (`0bb9d92`, `3694dd6`, `0b40364`, `5c94d6a`, `917c64a`, `8d25e4a`, `8bf0278`, `9a46409`)
- Replaced the floating bottom-left UpdateBanner on desktop with a compact "Update" pill in the titlebar's right rail that mirrors the updater state machine (hidden / Update / Installing…), keeping mobile on the existing banner. (`c4a25d4`)
- Right-clicking empty taskbar chrome now opens the same context menu as the desktop surface, and the menu pre-anchors near the click site so it never spawns off-screen near the taskbar; a Settings entry into org settings is included. (`de0dd0f`)
- Replaced the fragile PowerShell updater handoff with a cmd.exe .bat: startup is essentially instant (no AMSI/ExecutionPolicy gating), the sentinel deadline is now a soft 30s with a hard 60s ceiling, child stdout/stderr is captured and tailed back into updater.log on failure, and an early-exit child is detected via try_wait instead of timing out. (`3286f2c`)
- After several iterations, the chat input MODE pill animation now reliably slides between Code/Plan/Image/3D using measured pixel positions and inline transforms, with slash-command tags kept inline and the cooking indicator re-aligned to the taller input bar. (`7a6715a`, `45a46a8`, `91fac39`, `32e45e1`, `bbb8eae`, `bea9919`, `708a892`, `ee74d74`, `840f241`, `fa8ce32`)
- Light-mode polish on small surfaces: the org switcher avatar drops its jagged 1px ring and uses theme-aware tokens, team avatar fallbacks match user/agent fallbacks, and the image crop modal's zoom knob references --color-accent so its ring shows up in light mode. (`5b35a3b`, `57aca98`, `e4b9402`, `ca3cf0a`)
- Restored the desktop build by switching the new DesktopContextMenu return type from bare JSX.Element to ReactNode so npm run build (and therefore cargo run via build.rs) succeeds. (`bcb603e`)

## Highlights

- Light mode rolled out across chat, rails, sidekick, and modals with a full theming editor and presets
- File/Edit/View/Help menu bar plus a compact Update pill in the desktop titlebar
- Chat input gains a Code/Plan/Image/3D mode selector that steers slash commands and models
- Auto-updater on Windows/macOS now writes diagnostics, recovers from failed handoffs, and switched to cmd.exe
- First-time user onboarding with welcome modal, checklist, and prompt suggestions
- Fixes for CEO chat blink, black ChatPanel on cold load, and 422 on first chat with new agents

