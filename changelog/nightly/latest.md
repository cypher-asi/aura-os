# Theming overhaul, desktop chrome, and onboarding land together

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.457.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.457.1

A heavy day for Aura's desktop experience: a multi-phase theming system shipped end-to-end with light mode, custom tokens, and presets; a native-style menu bar and unified titlebar arrived; a first-run onboarding flow went live; and the auto-updater and macOS DMG packaging were rebuilt to be self-diagnosing and reliably shippable.

## 8:11 PM — Light mode, theme presets, and a unified Settings surface

A 14-phase theming program landed: design tokens, a custom-token editor with import/export presets, sectioned Settings with deep links, onboarding, and a long tail of light-mode contrast fixes.

- Introduced a token-driven theme system with light/dark variants, a Settings > Appearance section, and Sun/Moon quick toggles in the desktop titlebar and mobile topbar; the toggle was later simplified to a binary light↔dark switch with theme-aware icons. (`e4a35e7`, `43d01ee`, `7f6bb74`, `79f001d`, `401d9fb`)
- Shipped a per-token theme editor with named presets, JSON import/export, built-in Aura Dark/Light, and live previews; chrome tokens for sidebar, sidekick, and titlebar are now user-customizable and persisted per resolved theme. (`aaee109`, `0928dc6`, `ee63308`)
- Made light mode actually usable: routed chat bubbles, rails, sidekick, modals, and form inputs through semantic tokens; bumped contrast on muted text; pinned the user message bubble dark in both themes; and added a lint guard against raw color literals in module CSS. (`9f52c4e`, `8706839`, `085ff9a`, `f6cb146`, `f111847`)
- Reorganized Settings into deep-linkable sections (/settings/:section) with About, Appearance, Notifications, Keyboard, and Advanced, and merged app + team settings into a single taskbar-gear modal so theme controls are finally discoverable. (`b94ad56`, `7ec29ea`, `ac89c2f`, `621104e`, `3702057`, `6209501`)
- Added a first-run onboarding experience: a 2-step welcome modal, a portal-rendered checklist with 5 tasks, auto-detection via store subscriptions with baseline counts to ignore pre-existing defaults, and a Help button in the taskbar. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `11fc116`, `779d737`, `0d96fae`, `2f9dbb1`, `8d0ab5a`)
- Fixed two longstanding chat blink bugs: pinned the active history key in the LRU so background prefetches can't evict the visible chat, and added a proactive cold-load reveal so transcripts no longer render as a black panel after re-entry. (`3527198`, `4bc972e`)
- Restored keyboard focus visibility across the app, added a fallback HTML titlebar so window controls remain usable on boot/error overlays, and cascade-deletes for agents now tear down project bindings instead of dead-ending on a 409. (`e69bc31`, `d2848bd`, `95f172f`)
- Wired Mixpanel tokens into desktop and mobile nightly builds and defaulted REQUIRE_ZERO_PRO to false on server and desktop so unset envs no longer block sign-in. (`814d663`, `a60654c`, `ae418f3`, `d987125`)

## 12:48 PM — Agent MODE selector and self-diagnosing auto-updater

Chat input gains a Code/Plan/Image/3D mode switch with persisted per-agent state, and the desktop auto-updater grows a full diagnostic backbone for shipped Windows and macOS builds.

- Added a MODE row above every chat input (desktop and mobile) with mutually-exclusive Code, Plan, Image, and 3D modes that drive model lists, slash-command injection, and the send pipeline end-to-end; selection persists per agent. (`4165166`, `b35614b`, `375eb86`)
- Made the desktop auto-updater observable on shipped builds: daily tracing log file, per-step diagnostics with persisted state, boot-time reconcile that surfaces the failed step, sentinel-gated Windows handoff so a stalled PowerShell can't kill Aura, and a graceful macOS shutdown handshake. (`7f8e1d7`)
- Aura3D now remembers context across sessions: the nav restores the last project, switching tabs auto-selects the latest image or model, and project artifacts seed default selections instead of landing on an empty pane. (`4f26758`)
- Extracted a shared InputBarShell from ChatInputBar and Aura3D PromptInput so chat and 3D prompts share one input chrome, and baked the Z_BILLING_API_KEY into desktop builds via build.rs and CI. (`c2f8653`, `abc3392`, `d24847f`)

## 3:07 PM — First-chat self-heal for new bare agents

Restore Home-project binding repair on the deduped chat hot path so a freshly created agent's first message no longer 422s.

- When a new agent's create-time Home-project bind fails silently, the chat hot path now lazily repairs the binding before persistence runs, eliminating the 'aura_session_id is missing for chat_session' error on first chat. (`8b5b7d7`)

## 3:12 PM — Native-style menu bar, desktop right-click, and shared chrome

Aura's desktop chrome got a substantial polish pass: a real menu bar with global shortcuts, a shared right-click menu, login/desktop chrome unified, and the auto-updater's Windows handoff rebuilt on cmd.exe.

- Added File/Edit/View/Help menus to the desktop titlebar with cross-platform shortcut formatting, hover-switching dropdowns, zoom controls, full-screen toggle, and Rust-side IPC for new windows; secondary windows now share the WebContext so login state propagates. (`0bb9d92`, `3694dd6`, `0b40364`, `5c94d6a`, `917c64a`, `8d25e4a`, `8bf0278`, `6ac931e`, `6bf1c29`)
- Replaced the Windows updater's PowerShell handoff with a cmd.exe .bat script with captured stdout/stderr, a 30s soft / 60s hard sentinel deadline, and early-exit detection — so AMSI/Defender scans no longer abort otherwise-healthy installs with no breadcrumbs. (`3286f2c`)
- Unified login and desktop titlebar chrome via a shared ShellTitlebar pill, then iterated to drop the bespoke wrapper and standardize on zui Topbar with a tokenized BottomTaskbar, and replaced the floating UpdateBanner with a compact Update pill in the titlebar. (`3451488`, `c4a25d4`, `8588aea`, `2a5a27e`)
- Right-clicking empty taskbar chrome now opens the same context menu as the desktop, with edge-aware anchoring and a Settings entry; the menu pre-clamps when launched near viewport edges. (`de0dd0f`, `bcb603e`)
- Rebranded installers and the in-app icon to AURA across NSIS, .dmg, .app, and PWA assets via a master-orb icon generator, and pinned iOS TestFlight uploads to Xcode 26 to clear Apple's iOS 26 SDK gate. (`ad5a8a6`, `def9935`)
- Unblocked the long-failing Aura Functional Evals smoke job: refreshed the baseline, added a stale-baseline detector, role-based login assertions, and a one-command refresh script; also tightened the About > Updates row layout at narrow widths. (`819bcfa`, `1257a45`, `0ad4432`)
- Hardened macOS DMG packaging by disabling Spotlight on the runner before packaging and force-unmounting busy volumes, recovering CI from the recurring 'hdiutil: Resource busy' wedge. (`70441f6`)
- Polished the chat input mode pill through several iterations — CSS-grid positioning, measured pixel transforms, and inline-style transforms — landing on a reliable sliding capsule animation, plus a leaderboard switch from tokens to estimated cost. (`7a6715a`, `32e45e1`, `bbb8eae`, `708a892`, `840f241`, `509366a`)

## 8:45 PM — Patched create-dmg and Node-24 CI compatibility

Vendored a hardened create-dmg fork to break the macOS Intel packaging deadlock and bumped GitHub Actions runners ahead of the Node 20 deprecation.

- Vendored a patched create-dmg with -nobrowse, mdutil-off, and forced-detach retries, and pre-seeded it into cargo-packager's cache so every nightly retry uses the fixed script instead of the broken upstream v1.1.1. (`5cb4b2a`)
- Renamed the 1024px app icon to icon-1024@2x.png so cargo-packager's icns generator maps it to the retina ic10 slot, fixing the macOS .app build that broke after the AURA rebrand. (`a751975`)
- Bumped every GitHub Action pinned to Node 20 (checkout, setup-node, setup-java, artifact, cache, setup-python) to its Node-24-compatible major ahead of the June 2026 deprecation, and unblocked Android CI by tightening a leaderboard map type. (`8054922`)
- Pinned the iOS macos-26 runner to /Applications/Xcode_26.4.app since the runner image ships no plain Xcode_26.app symlink, recovering the validate-ios and ship-ios jobs from xcode-select failures. (`22d66ef`)
- Added per-mode accent borders (green for Code, amber for Plan, cyan for Image, purple for 3D) to the segmented mode pill so the active mode reads at a glance. (`42ba4dc`)

## Highlights

- Light mode and theme presets ship across desktop and mobile
- Native-style File/Edit/View/Help menu bar in the desktop titlebar
- First-run onboarding with welcome modal and checklist
- Self-diagnosing Windows + macOS auto-updater
- Patched macOS DMG packaging unblocks nightly releases
- New agent MODE selector (Code/Plan/Image/3D) in the chat input

