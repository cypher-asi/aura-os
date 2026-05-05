# Theming overhaul, desktop chrome, and a self-diagnosing updater

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.452.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.452.1

Today's nightly is a heavy day for Aura's desktop experience. A multi-phase theming program lands light mode end-to-end, with custom token overrides, named presets, and a clean two-state titlebar toggle. The desktop shell gains a real File/Edit/View/Help menu bar, an Update pill, multi-window support that stays signed in, and an auto-updater that finally explains itself when it fails. New users also get an onboarding flow with a welcome modal, a checklist, and an agent MODE selector for Code/Plan/Image/3D.

## 8:11 PM — Light mode lands across the app with per-token presets

A multi-phase theming program ships a real light mode, an editable Appearance section, custom token overrides, named presets, and a two-state titlebar toggle, with extensive surface-level cleanup so chat, sidebars, modals, and form inputs read correctly in both themes.

- Introduced a tokenized theming foundation: a new tokens.css with light/dark variants, removal of the legacy always-dark overrides, a dynamic highlight.js theme bridge, and a pre-React theme stamper to avoid first-paint flash. (`e4a35e7`, `7f6bb74`, `3424cb5`)
- Added a Settings > Appearance section with theme mode buttons, a 6-color accent picker, a custom token editor, and named presets with JSON import/export, plus a titlebar quick toggle and a matching mobile toggle in MobileTopbar. (`43d01ee`, `aaee109`, `0928dc6`, `79f001d`)
- Migrated process canvas, xterm, sidekick log, chat input, IDE view, browser address bar, agent environment, billing modals and more onto the new tokens, and added a lint guard that fails the build on raw color literals in migrated module.css files. (`7f6bb74`, `47721ec`, `aca46ec`, `7d2fb89`, `c56ba50`, `4281fd0`, `fe9bfeb`, `53bc7a4`, `1ca212d`, `abb325f`, `f6cb146`)
- Fixed the worst light-mode contrast bugs: white-on-white chat bubbles, rails, sidekick, modals, the AURA wordmark, and ZUI form inputs (Input, Search, Textarea, Select) all now route through theme-aware tokens, and the user message bubble stays dark in light mode for sender contrast. (`9f52c4e`, `085ff9a`, `8706839`, `f111847`)
- Reworked Settings into a sectioned layout with /settings/:section deep links, merged the app Appearance/Notifications/Keyboard/About/Advanced sections into the taskbar gear modal so theme controls are reachable, and simplified the titlebar toggle to a binary light↔dark switch. (`b94ad56`, `7ec29ea`, `401d9fb`)
- Restored keyboard focus visibility app-wide by removing the global outline:none and adding a single :focus-visible base rule, and kept the boot/error overlay window controls accessible via a native HTML fallback titlebar. (`e69bc31`, `d2848bd`)
- Fixed the CEO chat blink and orphaned-binding regressions: cascade-delete now tears down agent project bindings before delete, and active history keys are pinned in the chat-history LRU so background sidebar prefetches can no longer evict the visible chat. (`95f172f`, `3527198`, `4bc972e`)
- Shipped the first-run onboarding flow: a welcome modal, a portal-rendered checklist with progress, a help button in the taskbar, an auto-detection watcher with a baseline-count guard, and prompt suggestion chips on empty chats. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `11fc116`, `0d96fae`, `8d0ab5a`, `779d737`)
- Defaulted Debug to hidden in the Apps taskbar, aligned Settings/Aura3D/Apps modal headers to a 32px control height, and disabled REQUIRE_ZERO_PRO by default in both server and desktop builds. (`4b47c85`, `ac89c2f`, `ae418f3`, `d987125`)
- Wired VITE_MIXPANEL_TOKEN into the desktop nightly build so analytics ship with the artifact. (`814d663`)

## 12:42 PM — Slim 32px modal headers become the ZUI default

The opt-in compact modal header introduced for Apps and Settings is promoted into ZUI's Modal as the default look, so every modal title bar lines up with the sidebar search.

- Added a compactHeader prop to ZUI Modal, applied it to the Apps and Org Settings modals to fix a cascade-order issue with local overrides, then made the 32px slim header the baked-in default and removed the now-redundant prop and CSS. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mobile nightly picks up Mixpanel analytics token

The mobile nightly workflow now passes VITE_MIXPANEL_TOKEN through to the build so analytics behave consistently with desktop nightlies.

- Forwarded VITE_MIXPANEL_TOKEN into the mobile nightly GitHub Actions workflow. (`a60654c`)

## 12:48 PM — Agent MODE selector and a self-diagnosing desktop updater

Chat gains a Code/Plan/Image/3D mode selector with an animated capsule and a shared input bar shell, while the desktop auto-updater is rebuilt with persistent logs, reconcile-on-boot, and a sentinel-gated handoff so install failures stop being silent.

- Added a per-agent MODE row (Code/Plan/Image/3D) above the chat input on desktop and mobile, modeled as a discriminated union so Image/3D modes inject the right slash command and steer the model list end-to-end; mode is persisted per agent like the model picker. (`4165166`, `b35614b`, `375eb86`)
- Extracted a shared InputBarShell from ChatInputBar and the Aura3D PromptInput so chat and 3D prompt surfaces share chrome, model picker, and the new mode selector. (`c2f8653`)
- Rebuilt the desktop auto-updater to be self-diagnosing: a daily desktop.log via tracing-appender, an updater.log + updater-state.json that survive process exit, boot-time reconcile of stalled installs, a sentinel-gated Windows handoff that no longer exits Aura blindly, a graceful macOS shutdown handshake, and a 'Show updater logs' affordance in UpdateControl. (`7f8e1d7`)
- Made Aura3D remember context across sessions: nav hydrates the last selected project, the store auto-selects the latest image (and any linked 3D model) or latest model when switching tabs, and project artifacts seed default selections on load. (`4f26758`)
- Tightened onboarding completion logic to ignore pre-existing defaults, placed Name and Role side-by-side in the agent editor, and threaded Z_BILLING_API_KEY into both the desktop nightly workflow and the desktop binary via build.rs. (`c9514db`, `a86946a`, `d24847f`, `abc3392`)

## 3:07 PM — First chat with a fresh agent self-heals its Home binding

A 422 'aura_session_id missing' regression on a new user's very first chat with a freshly created agent is fixed by restoring the lazy Home-project repair on the deduped chat hot path.

- Re-enabled lazy_repair_home_project_binding on the deduped agent chat persistence path so a missing or transient Home binding is repaired before the first turn instead of returning a structured 422; covered with new setup tests. (`8b5b7d7`)

## 3:12 PM — Native-style menu bar, multi-window login, and DMG packaging unblocked

The desktop titlebar gains a real File/Edit/View/Help menu with cross-platform shortcuts, secondary windows now share the auth-bearing WebContext, an Update pill replaces the floating banner, and macOS DMG packaging is hardened against Spotlight-induced ejection failures.

- Added a File/Edit/View/Help menu bar to the desktop titlebar with hover-to-switch dropdowns, cross-platform shortcut formatting (Cmd glyphs on macOS, Ctrl+ on Win/Linux), zoom controls, context-aware Previous/Next Agent navigation, and Rust-side IPC for new windows and fullscreen toggle. (`0bb9d92`, `3694dd6`, `0b40364`, `5c94d6a`, `917c64a`, `8d25e4a`, `8bf0278`, `6ac931e`)
- Made File > New Window stay signed in by sharing the primary window's wry::WebContext across all main windows, so cookies, localStorage, and IndexedDB (and therefore the auth session) propagate between windows in real time. (`6bf1c29`)
- Hardened the Windows auto-updater handoff by replacing the fragile PowerShell launcher with a cmd.exe .bat script, bumping the sentinel deadline from 5s to 30s with a 60s ceiling, capturing child stdout/stderr into the updater log, and detecting early child exit instead of timing out blindly. (`3286f2c`)
- Replaced the floating bottom-left UpdateBanner on desktop with a compact Update pill in the titlebar's right rail, backed by a new shared PillButton primitive; mobile keeps the legacy banner. (`c4a25d4`, `8588aea`)
- Unified the login screen and authenticated shell behind a shared ShellTitlebar, and shared the desktop right-click menu between the desktop surface and empty taskbar chrome (with edge-aware anchoring so menus near the taskbar don't spawn off-screen). (`3451488`, `de0dd0f`)
- Polished the chat input mode selector after several attempts: switched from JS-measured WAAPI to a CSS-grid + measured-pixel approach driven by inline transform styles so the active capsule reliably slides between Code, Plan, Image, and 3D. (`7a6715a`, `45a46a8`, `32e45e1`, `bbb8eae`, `708a892`, `840f241`)
- Cleaned up several light-mode chrome regressions in the org switcher avatar, image-crop zoom knob, slash command chips, cooking indicator alignment, and the narrow-width Settings > Updates row. (`5b35a3b`, `57aca98`, `e4b9402`, `ca3cf0a`, `91fac39`, `bea9919`, `ee74d74`, `1257a45`)
- Unblocked the Aura Functional Evals smoke job by refreshing the renamed-scenario baseline, adding a stale-baseline detector and refresh script, and stopped macOS DMG packaging from wedging on Spotlight-busy volumes via forced unmount/eject and disabled indexing on the runner. (`819bcfa`, `70441f6`)

## Highlights

- Light mode and per-token theme presets across the app
- File/Edit/View/Help menu bar in the Desktop titlebar
- Self-diagnosing auto-updater with logs on Windows and macOS
- Code/Plan/Image/3D MODE selector in the chat input
- First-run onboarding with welcome modal and checklist

