# Light mode lands, plus an onboarding checklist for new users

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.444.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.444.1

Today's nightly is dominated by one large thread: Aura grew a real theming system, with a working light mode, a Settings → Appearance editor, custom token overrides, and named presets you can import and export. On top of that, a first-run onboarding flow now greets new users with a welcome modal, a five-step checklist, and friendlier empty states. Smaller polish hits the chat panel reliability, modal chrome alignment, the Aura3D editor's memory of where you left off, and a few release-pipeline secrets needed for the desktop nightly.

## 8:11 PM — Theming system, light mode, onboarding checklist, and chat reliability fixes

A long, multi-phase push delivered Aura's theming system end-to-end, shipped a first-run onboarding experience, fixed two distinct CEO/MEOW chat blanking bugs, and tightened agent deletion and desktop window-control behavior.

- Introduced a full theming system: tokenized colors with light/dark variants, a dynamic highlight.js theme, a Settings → Appearance section with mode and accent pickers, a titlebar quick toggle, and matching coverage for the process canvas, xterm terminal, and dozens of module CSS files. The toggle was later simplified to a binary light↔dark switch in the titlebar and mobile topbar. (`e4a35e7`, `43d01ee`, `7f6bb74`, `3424cb5`, `47721ec`, `aca46ec`, `7d2fb89`, `c56ba50`, `4281fd0`, `fe9bfeb`, `53bc7a4`, `1ca212d`, `abb325f`, `f6cb146`, `79f001d`, `401d9fb`)
- Added a customizable Appearance editor: per-token color overrides for sidebar, sidekick, titlebar, and chrome surfaces persist per-theme, plus named presets with built-in Aura Dark/Light, JSON import/export, and a CustomTokensPanel that gracefully grays out for read-only built-ins. (`aaee109`, `0928dc6`)
- Made light mode actually usable: rewrote hard-coded #fff/#000 across chat bubbles, LLM output, nav rails, sidekick, project list, modals, and mobile screens to flow through theme tokens; bumped light-mode secondary/muted text to WCAG AA contrast; inverted the AURA wordmark in light mode; and pinned the user message bubble dark in both themes for sender contrast. ZUI form inputs (Input, Search, Textarea, Select, login provider buttons) gained dedicated tokens so they're readable on white surfaces, with the focus halo dropped for consistency. (`9f52c4e`, `085ff9a`, `8706839`, `f111847`, `ee63308`, `6fe2f64`)
- Settings became a proper sectioned surface with /settings/:section deep links (About, Appearance, Notifications, Keyboard, Advanced) on desktop and a list-then-detail screen on mobile; the taskbar gear now opens a single "Settings" modal that groups APP and TEAM sections so theme controls are finally reachable from the chrome. (`b94ad56`, `7ec29ea`, `79f001d`)
- Shipped a first-run onboarding experience: a Zustand-backed store with a 2-step welcome modal, a portal-rendered checklist of five tasks (send a message, create a project, create an agent, generate an image, explore billing), a help button in the taskbar, and a watcher that auto-completes tasks against baseline counts so pre-existing defaults aren't miscounted. The empty chat now shows prompt suggestion chips and a pulsing input glow, and agent/task empty states got more directive copy. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `ec62961`, `11fc116`, `779d737`, `0d96fae`, `2f9dbb1`, `8d0ab5a`)
- Killed two distinct CEO/MEOW chat blanking races: pinned the active history key in the chat-history LRU so background sidebar prefetches can't evict the visible thread, and made ChatPanel's cold-load reveal proactive so the transcript can't stay permanently hidden when historyResolved arrives after the initial anchor signal. (`3527198`, `4bc972e`)
- Agent deletion is no longer a dead-end: a new useCascadeDeleteAgent hook tears down all project bindings before deleting the template, the confirm modal lists which projects will be detached, and the server-side Home auto-bind skips templates that are already gone so the cascade can't race the chat self-heal. The agent's Projects tab also annotates bindings with "(in another org)" / "(archived)". (`95f172f`)
- Restored keyboard focus visibility everywhere by removing the global outline:none !important rule installed during the theming refactor and replacing it with a single :focus-visible base style; added a native-HTML fallback titlebar so window minimize/maximize/close stay reachable even when the React app fails to mount on the frameless desktop window. (`e69bc31`, `d2848bd`)
- Polished desktop chrome: the sidekick drawer toggle now renders in primary text color when open instead of accent glow, the theme/host icon row aligns with the sidekick and window controls at 14px/sm with zero gap, and dark side panels flatten to the taskbar background to remove the visible vertical stripe. (`3199ec4`, `401d591`, `ee63308`)
- Hid the Debug app from the taskbar by default via a new defaultHidden flag in the AuraApp registry, while preserving "explicitly cleared the list" semantics so users who drag Debug back into Visible keep that state across reloads. (`4b47c85`)
- Broke up four oversized files (PermissionsTab ~1043 lines, aura-events ~842 lines, notes-store ~632 lines, entities.ts ~700 lines, AgentEnvironment ~510 lines, stream handlers tests ~1334 lines, use-chat-history-sync ~530 lines) into focused folders with no behavior change, and added a lint:colors guard that fails CI on raw hex/rgb literals in module CSS files on the migrated denylist. (`78c08f2`, `60f0af6`, `f2b997e`, `1d3e8e8`, `3ee06ea`, `f6cb146`)
- Aligned modal chrome with the sidebar: Settings, Aura3D's tab bar, and the Apps modal now sit at a 32px control-height-sm header so they line up with the sidebar search input. (`ac89c2f`)
- Defaulted REQUIRE_ZERO_PRO to false on the server and in desktop builds so unset environments don't gate features behind a Zero Pro check. (`ae418f3`, `d987125`)

## 12:41 PM — Mixpanel token wired into desktop nightly builds

Release Infrastructure: the desktop nightly workflow now receives the Mixpanel write key so analytics aren't silently dropped from shipped builds.

- Pass VITE_MIXPANEL_TOKEN through the desktop nightly GitHub Actions workflow so the bundled web build can emit telemetry. (`814d663`)

## 12:42 PM — Slim 32px modal header is now the ZUI default

A short iteration moved the compact modal header from a per-call override into a ZUI prop, then made it the default once it stopped winning the cascade reliably.

- Promoted the 32px modal title bar from an AppsModal-local CSS override to a first-class compactHeader prop on ZUI Modal, then collapsed that prop entirely by baking the slim layout straight into Modal.module.css so every modal aligns with the sidebar search by default. AppsModal and the Settings modal drop their bespoke flags as a result. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mixpanel token wired into mobile nightly builds

Release Infrastructure: the mobile nightly workflow now also receives the Mixpanel write key, matching the desktop change earlier in the day.

- Pass VITE_MIXPANEL_TOKEN through the mobile nightly GitHub Actions workflow so iOS/Android builds emit telemetry consistent with desktop. (`a60654c`)

## 12:48 PM — Aura3D remembers context, and chat/PromptInput share one shell

Aura3D stops landing users on an empty editor by remembering project, image, and model selections, while ChatInputBar and the Aura3D PromptInput consolidate onto a single shared input shell.

- Aura3D now hydrates the last selected project from localStorage, falls back to the most recently created project, and auto-selects the latest image (and its linked 3D model) or latest model when switching tabs, so opening the app lands on real content instead of a blank pane. (`4f26758`)
- Extracted a shared InputBarShell (with ModelPicker) used by both the chat input bar and the Aura3D prompt input, deleting ~1100 lines of duplicated CSS and TSX in favor of one consistent component. (`c2f8653`)
- Tightened onboarding's create-task detection to only complete when the agent or project count exceeds the initial baseline, so users with pre-existing defaults aren't auto-credited on first launch. (`c9514db`)

## 1:35 PM — Z_BILLING_API_KEY plumbed into desktop nightly

Release Infrastructure + Desktop: the billing API key is now passed from CI into the desktop build and baked into the binary at compile time.

- Add the Z_BILLING_API_KEY secret to the desktop nightly workflow and bake it into the desktop binary via build.rs so shipped desktop builds can authenticate against the billing service without runtime configuration. (`d24847f`, `abc3392`)

## Highlights

- Full light/dark theming with a Settings → Appearance editor, custom tokens, and JSON presets
- First-run onboarding: welcome modal, 5-task checklist, and friendlier empty states
- Light mode is now actually readable across chat, sidekick, modals, and form inputs
- Two CEO-chat blanking bugs (LRU eviction and cold-load reveal) fixed
- Aura3D remembers your last project and auto-selects the latest image/model

