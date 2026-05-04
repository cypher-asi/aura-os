# Themeable Aura: light mode, onboarding, and a self-diagnosing updater

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.445.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.445.1

Today's nightly is dominated by a sweeping theming overhaul that finally makes Aura usable in light mode, alongside a new onboarding flow, a redesigned chat input with mode selection, and a substantially more debuggable desktop auto-updater. Settings, modal chrome, and form inputs got pulled into a more coherent visual system, and the release pipeline picked up a few missing secrets along the way.

## 8:11 PM — Light mode, theming editor, and a redesigned Settings + onboarding surface

A multi-phase theming program landed end-to-end: design tokens, a theme editor with presets, a real light mode, sectioned Settings, and a first-run onboarding flow.

- Introduced a full token-driven theme system with light/dark variants, a dynamic highlight.js theme, and a Settings → Appearance section plus a titlebar quick toggle that flips between light and dark; the cycle was later simplified from a three-state dark/light/system rotation to a binary switch that always produces a visible change. (`e4a35e7`, `43d01ee`, `7f6bb74`, `401d9fb`)
- Shipped a richer theming editor: per-token overrides for sidebar, sidekick, titlebar and surface tints persisted in localStorage, named presets with built-in Aura Dark/Light, and JSON import/export of user themes from a new PresetsPanel. (`aaee109`, `0928dc6`)
- Made light mode actually usable: rerouted hardcoded #fff/#000 across chat bubbles, LLM output, nav rails, sidekick, project lists, modals, and mobile screens through semantic tokens, fixed the white-on-white form chrome, bumped light-mode text contrast to WCAG AA, and inverted the AURA wordmark in light theme. A lint guard scans module CSS for raw color literals to prevent regressions. (`9f52c4e`, `f6cb146`, `085ff9a`, `ee63308`)
- Rebuilt Settings into a sectioned Navigator-driven layout (About, Appearance, Notifications, Keyboard, Advanced) with /settings/:section deep links and a matching mobile drill-down, then merged the app-scoped sections into the taskbar gear's Settings modal so theme controls are finally reachable without typing a URL. (`b94ad56`, `7ec29ea`)
- Added a first-run onboarding system: 2-step welcome modal, floating 5-task checklist with progress, a help button in the taskbar, prompt suggestion chips on empty chat, a pulsing input glow, and improved empty-state copy on agents and tasks. Several follow-up fixes ensured tasks only complete from new user activity rather than pre-existing defaults. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `11fc116`, `779d737`, `0d96fae`, `2f9dbb1`, `8d0ab5a`, `ec62961`)
- Fixed two long-standing chat reliability bugs: the CEO/SuperAgent chat panel could blink to empty when background sidebar prefetches evicted its history from the LRU, and could render fully black on cold reload when the initial-anchor reveal callback latched before history resolved. The history store now pins the active key and ChatPanel proactively reveals the transcript once both signals are satisfied. (`3527198`, `4bc972e`)
- Fixed agent deletion to cascade-remove all project bindings (including the auto-healing Home binding) in a single confirm step, eliminating the 409 dead-end where Delete did nothing. (`95f172f`)
- Restored keyboard focus visibility app-wide by removing a global outline:none rule that had been suppressing every focus indicator, and replaced it with a single :focus-visible base style driven by the focus-ring token. (`e69bc31`)
- Kept the desktop window draggable and closable when the React app fails to mount by adding a native-HTML fallback titlebar above the splash and boot-error overlay that uses the same wry IPC bridge. (`d2848bd`)
- Polished desktop chrome: flattened sidebar/sidekick backgrounds to match the taskbar, unified titlebar icon sizing with the window controls, kept the sidekick-toggle in primary text color rather than accent when open, and switched ZUI Panel's default variant to solid so unannotated panels match the taskbar surface. (`ee63308`, `401d591`, `3199ec4`, `6fe2f64`)
- Large-scale internal restructuring split several files over 500 lines (PermissionsTab, aura-events, notes-store, AgentEnvironment, stream handler tests, entities types, chat-history-sync) into focused folders without behavior changes, and converted a handful of default exports to named exports. (`78c08f2`, `3ee06ea`, `60f0af6`, `f2b997e`, `1d3e8e8`, `e57e0be`)

## 12:19 PM — Visible form inputs and aligned modal chrome in light mode

Form components and modal headers were retuned so light theme reads correctly and chrome heights line up with the sidebar.

- Gave ZUI Input, Search, Textarea, Select, login provider buttons, and the folder picker dedicated input tokens with a visible #d1d5db border and white fill on light theme, fixing previously invisible white-on-white form chrome. The errant 3px focus halo on Input was later dropped to match its sibling components. (`8706839`, `f111847`)
- Aligned the Settings page header, the Aura3D image/3D tab bar, and the Apps modal header to a 32px control height so they sit on the same horizontal rhythm as the sidebar search input. (`ac89c2f`)
- Hid the Debug app from the taskbar by default via a new defaultHidden registry flag, while distinguishing 'never customized' from 'explicitly cleared' so dragging Debug back into Visible persists. (`4b47c85`)
- Stopped the desktop build from defaulting REQUIRE_ZERO_PRO to true, matching the server change earlier in the day. (`d987125`)

## 12:41 PM — Mixpanel token wired into desktop nightly builds

Release Infrastructure: the desktop nightly workflow now forwards VITE_MIXPANEL_TOKEN so analytics ship in built binaries.

- Pass VITE_MIXPANEL_TOKEN through to the desktop nightly GitHub Actions workflow so the built app contains the analytics token. (`814d663`)

## 12:42 PM — Slim 32px modal headers become the ZUI default

An iterative refactor promoted the compact modal header from a per-caller override to the default Modal layout.

- Added a compactHeader prop on ZUI Modal, wired Apps and Org Settings modals through it after the original headerClassName approach lost specificity battles in production builds, then made the 32px slim header the unconditional default and removed the now-redundant prop and class. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mixpanel token wired into mobile nightly builds

Release Infrastructure: the mobile nightly workflow now forwards VITE_MIXPANEL_TOKEN to match the desktop pipeline.

- Forward VITE_MIXPANEL_TOKEN to the mobile nightly GitHub Actions workflow so iOS and Android builds carry the analytics token. (`a60654c`)

## 12:48 PM — Code/Plan/Image/3D mode selector and a self-diagnosing desktop updater

Chat input picks up an explicit mode selector, Aura3D remembers context across sessions, and the desktop auto-updater finally tells you why it failed.

- Added a MODE row above every agent chat input on desktop and mobile with mutually exclusive Code, Plan, Image, and 3D modes. Selection persists per agent, drives the model list and slash-command behavior, and routes through a discriminated-union send pipeline so Image injects /image, 3D injects /3d, and Plan switches to spec generation. (`4165166`)
- Aura3D now remembers context across opens: the nav rehydrates the last project, the store persists project selection to localStorage, and switching tabs or loading a project auto-selects the most recent image and any linked 3D model so users no longer land on an empty editor. (`4f26758`)
- Extracted a shared InputBarShell from ChatInputBar and the Aura3D PromptInput, consolidating ~1,300 lines of duplicated input chrome and unblocking the new MODE selector. (`c2f8653`)
- Made the Windows + macOS auto-updater self-diagnosing: a daily desktop.log via tracing-appender, a new updater::diagnostics module that records every install step to updater.log and updater-state.json, a boot-time reconcile that surfaces where a previous attempt died, a sentinel-file gate that prevents Aura from exiting if the PowerShell handoff never starts, a graceful macOS shutdown handshake replacing process::exit, and a UI 'Show updater logs' button plus 'Stopped at: …' status. (`7f8e1d7`)
- Wired the Z_BILLING_API_KEY secret end-to-end: passed through the desktop nightly workflow and baked into the desktop binary via build.rs so billing calls work in shipped builds. (`d24847f`, `abc3392`)
- Tightened onboarding completion so the create-project and create-agent tasks only fire when the user's count exceeds the initial defaults, fixing false completions for fresh accounts that already had seed entities. (`c9514db`)

## Highlights

- Full light/dark theming with custom token presets and JSON import/export
- New onboarding: welcome modal, checklist, and prompt suggestions
- Chat input gains Code/Plan/Image/3D mode selector
- Self-diagnosing desktop auto-updater on Windows and macOS
- Sectioned Settings with deep links and a unified Settings modal

