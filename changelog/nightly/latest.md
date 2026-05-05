# Theming overhaul, desktop menu bar, and a self-diagnosing auto-updater

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.458.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.458.1

Today's nightly is a heavy day for desktop polish. AURA gains a real light/dark theming system with custom tokens and presets, a native-style File/Edit/View/Help menu bar in the titlebar, an onboarding flow with a checklist, and a chat MODE selector for Code/Plan/Image/3D. On the reliability side, the Windows + macOS auto-updater learned to log and reconcile its own failures, the macOS DMG packaging pipeline got patched to survive Spotlight-busy volumes, and CI was modernized for Node 24 and Xcode 26.

## 8:11 PM — Light/dark theming, sectioned Settings, and onboarding checklist land together

A multi-phase theming push de-darkifies the shell, ships a full Settings/Appearance editor with presets, restores keyboard focus, and introduces a first-run onboarding flow.

- Introduced a complete light/dark theming system: token-based color palette in tokens.css, dynamic highlight.js theme, a Settings > Appearance section, a titlebar/topbar quick toggle (later simplified to a binary light↔dark switch), and a mobile theme toggle in the persistent topbar. (`e4a35e7`, `43d01ee`, `7f6bb74`, `79f001d`, `401d9fb`)
- Added a power-user theming editor: per-token overrides persisted to localStorage, named presets with built-in Aura Dark/Light, and JSON import/export of custom themes from the Appearance panel. (`aaee109`, `0928dc6`)
- Fixed light mode end-to-end: chat bubbles, rails, sidekick, modals, and form inputs now route through semantic tokens so text and chrome stay legible in both themes; the AURA wordmark inverts in light mode and a lint guard catches future raw-color regressions. (`9f52c4e`, `8706839`, `085ff9a`, `f6cb146`, `f111847`)
- Restored visible keyboard focus across the app by removing the global outline:none override and adding a single :focus-visible rule driven by the theme's focus-ring token. (`e69bc31`)
- Reorganized Settings into a Navigator-driven layout with About / Appearance / Notifications / Keyboard / Advanced sections and /settings/:section deep links, and merged App and Team settings behind the taskbar gear so theme controls are finally reachable from the desktop chrome. (`b94ad56`, `7ec29ea`)
- Shipped a first-run onboarding flow: a 2-step welcome modal, a floating 5-task checklist (send message, create project, create agent, generate image, explore billing) with auto-detection, prompt suggestions on empty chat, and a Help button in the taskbar. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `11fc116`, `779d737`)
- Fixed two long-tail chat bugs: pinned the active history key in the chat-history LRU so background prefetches can no longer evict the visible CEO chat, and made ChatPanel proactively reveal the cold-load transcript when history resolves out of order, eliminating the residual black panel. (`3527198`, `4bc972e`)
- Cascade-deletes project bindings when removing an agent, with a confirm modal that lists which projects will be detached and a server-side guard so the chat-side self-heal can't resurrect the Home binding mid-cascade. (`95f172f`)
- Kept Aura's window controls accessible during boot/error overlays via a fallback HTML titlebar, and hid the Debug app from the taskbar by default so the visible app strip starts cleaner. (`d2848bd`, `4b47c85`)
- Slimmed every ZUI Modal header to a 32px row that aligns with the sidebar search, and unified the Settings, Aura3D, and Apps modal title bars on the same control height. (`ac89c2f`, `6209501`)
- Wired the desktop nightly build to pass VITE_MIXPANEL_TOKEN to both desktop and mobile pipelines so analytics is populated in shipped binaries. (`814d663`, `a60654c`)

## 12:48 PM — Chat MODE selector and Aura3D context memory

Chat input grows a Code/Plan/Image/3D mode switch backed by a shared InputBarShell, Aura3D remembers the last project and asset, and the desktop auto-updater becomes self-diagnosing.

- Added a per-agent MODE selector (Code, Plan, Image, 3D) to the chat input on desktop and mobile. Selection persists per agent and steers model lists, slash-command injection (/image, /3d, generate_specs), and the send pipeline through a new discriminated-union ResolvedSend type. (`4165166`, `b35614b`, `375eb86`)
- Aura3D now remembers context across opens: the nav hydrates the last selected project, switching tabs auto-selects the latest image (and any linked model) or latest model, and loading a project seeds defaults so users no longer land on an empty editor. (`4f26758`)
- Extracted a shared InputBarShell from ChatInputBar and the Aura3D PromptInput, consolidating ~1300 lines of input-bar styling and behavior into one reusable shell with a shared ModelPicker. (`c2f8653`)
- Made the Windows + macOS auto-updater self-diagnosing: a daily desktop.log file, an updater::diagnostics module that records every install step to updater.log and updater-state.json, on-boot reconcile that surfaces where a previous attempt died, a sentinel-gated Windows handoff that no longer exits Aura on failure, and a graceful macOS shutdown handshake. UpdateControl now shows the failed step and a Show updater logs button. (`7f8e1d7`)
- Hardened onboarding completion to use a baseline count for agents and projects so pre-existing defaults don't mark Create tasks as already done, and baked Z_BILLING_API_KEY into the desktop binary via build.rs so billing flows work in shipped builds. (`c9514db`, `d24847f`, `abc3392`)

## 3:07 PM — First-chat 422 fixed for newly created agents

Restores the Home-project binding self-heal on the chat hot path so a brand-new agent's first message no longer fails with a 422.

- Fixed a regression where a new user's first chat with a freshly created agent could fail with `Required session identity field aura_session_id is missing` when the create-time auto-bind silently failed. The chat hot path now calls lazy_repair_home_project_binding when no matching project_agent is found, restoring the self-heal contract that an earlier latency optimization had inadvertently bypassed. (`8b5b7d7`)

## 3:12 PM — Desktop menu bar, multi-window login sharing, and DMG packaging fixes

A native-style menu bar joins the titlebar, secondary windows share auth state, and the macOS release pipeline learns to survive Spotlight on busy CI runners.

- Added a native-style File/Edit/View/Help menu bar to the desktop titlebar with hover-to-switch dropdowns, cross-platform shortcut hints (Cmd glyphs on macOS, Ctrl+ on Windows/Linux), zoom controls, Previous/Next Agent navigation, Toggle Full Screen, and a New Window action backed by new Rust IPC commands and a secondary-window runtime. (`0bb9d92`, `3694dd6`, `0b40364`, `5c94d6a`, `8d25e4a`, `8bf0278`, `6ac931e`)
- File > New Window now stays logged in: secondary main windows share the primary window's wry::WebContext so localStorage, cookies, and IndexedDB (including the live aura-jwt) are shared, and login/logout propagates across all open windows. (`6bf1c29`)
- Replaced the floating UpdateBanner with a compact Update pill in the titlebar's right rail, backed by a new shared PillButton primitive, and shared the desktop right-click menu between the desktop surface and empty taskbar chrome. (`c4a25d4`, `8588aea`, `de0dd0f`)
- Stabilized the chat MODE selector pill animation through several iterations, ultimately driving the indicator from measured pixel positions with a ResizeObserver so the capsule reliably slides between Code, Plan, Image, and 3D across browsers. (`7a6715a`, `32e45e1`, `bbb8eae`, `708a892`, `840f241`)
- Replaced the fragile Windows PowerShell updater handoff with a cmd.exe .bat handoff: 30s soft / 60s hard sentinel deadline, captured stdout/stderr appended to updater.log on timeout, and try_wait()-based detection so a child that dies early fails fast instead of waiting out the deadline. (`3286f2c`)
- Rebranded the desktop app to AURA: macOS-style squircle icon generated from a single master orb, NSIS installer icon/header/sidebar, custom DMG background, and renamed the cargo-packager product-name so the .app, .dmg, NSIS installer, and Add/Remove Programs entry all read AURA. (`ad5a8a6`)
- Hardened release infrastructure: macOS DMG packaging now disables Spotlight indexing and force-unmounts stuck volumes before retry, iOS TestFlight uploads are pinned to Xcode 26 on macos-26 to clear the App Store SDK gate, and the Aura functional evals smoke job is unblocked with a refresh-baseline script and a stale-baseline detector. (`70441f6`, `def9935`, `819bcfa`)
- Unified the login screen and authenticated DesktopShell chrome through a shared ShellTitlebar (later trimmed back to the zui Topbar), then walked back the more aggressive ShellTitlebar/UpdatePill experiments in a cleanup sweep that also tightened agent editor layout and avatar/empty-state polish. (`3451488`, `2a5a27e`)
- Re-ranked the leaderboard by estimated cost spent (with tokens as tiebreaker) and rescaled the row progress bar to match, and tightened the Settings > Updates row so status text and the check-for-updates button stay readable at narrow widths. (`509366a`, `1257a45`, `0ad4432`)

## 8:45 PM — Node 24 / Xcode 26 CI modernization and DMG cache patch

A late-day reliability sweep clears Node 20 deprecation warnings, points iOS at the right Xcode, and pre-seeds cargo-packager with a patched create-dmg so macOS Intel nightly stops failing on busy volumes.

- Bumped every GitHub Actions runner pinned to Node 20 to its Node-24-compatible major (checkout v5, setup-node v5, setup-java v5, setup-android v4, upload/download-artifact v5, setup-python v6, cache v5) ahead of the June 2026 enforcement, and tightened a leaderboard map callback type so verify-android.mjs builds cleanly. (`8054922`)
- Pre-seeded cargo-packager's create-dmg cache with a vendored, patched copy that attaches with -nobrowse, runs mdutil -i off after mount, and retries hdiutil detach -force, ending the recurring `Resource busy` failures on the macOS-15 Intel runner. (`5cb4b2a`)
- Pointed iOS validate and ship steps at the existing /Applications/Xcode_26.4.app symlink (the macos-26 runner has no plain Xcode_26.app) so the iOS jobs stop exiting before build. (`22d66ef`)
- Renamed the 1024px desktop icon to icon-1024@2x.png so cargo-packager's icns generator maps it to the retina ic10 slot instead of aborting the macOS .app build with `No matching IconType`. (`a751975`)
- Tinted the chat MODE selector active pill border by mode (green for Code, amber for Plan, cyan for Image, purple for 3D) and re-suppressed the global focus ring on the input-bar textarea after a refactor had dropped it. (`42ba4dc`, `ae66231`)

## Highlights

- Full light/dark theming with custom tokens, presets, and JSON import/export
- Desktop titlebar gains a File/Edit/View/Help menu bar with shortcuts
- Onboarding welcome flow + 5-task checklist for new users
- Chat input now has a Code/Plan/Image/3D MODE selector
- Self-diagnosing auto-updater on Windows and macOS
- Hardened macOS DMG packaging and Node 24 / Xcode 26 CI

