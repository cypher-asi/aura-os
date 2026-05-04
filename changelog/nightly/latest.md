# Theming overhaul, onboarding, and chat reliability

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.443.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.443.1

A big day for Aura: the app gains a real light/dark theming system with a per-token editor and named presets, a new first-run onboarding flow with welcome modal and checklist, two long-standing chat regressions ("CEO blink" and the cold-load black panel) get root-caused, and Settings is consolidated into a single discoverable surface. The day closes out with nightly CI plumbing for Mixpanel and billing secrets.

## 8:11 PM — Light/dark theming, sectioned Settings, and onboarding flow

The bulk of the day: a multi-phase theme system lands end-to-end, Settings is restructured and merged with the taskbar gear, a new onboarding experience ships, and two stubborn chat regressions are fixed.

- Introduced a full light/dark theme system: extracted semantic tokens (status colors, borders, spinners, text), de-darkified the shell, made highlight.js follow the resolved theme, and added a Settings > Appearance pane plus a titlebar Sun/Moon/Monitor quick toggle. Phase 9 then migrated SidekickLog, ChatInputBar, IdeView, Preview, LeftMenuTree, BrowserAddressBar, AgentEnvironment, TaskOutputPanel, and the billing modals onto tokens, with a new lint:colors guard preventing raw hex/rgb literals from creeping back in. (`e4a35e7`, `43d01ee`, `7f6bb74`, `3424cb5`, `47721ec`, `aca46ec`, `7d2fb89`, `c56ba50`, `4281fd0`, `fe9bfeb`, `53bc7a4`, `1ca212d`, `abb325f`, `f6cb146`, `8277208`)
- Built a richer theming editor on top of the token system: per-token overrides for sidebar, sidekick, titlebar, and surface tints persist to localStorage and apply via inline styles, and a new Presets panel lets users save, rename, delete, export, and import named themes as JSON, with built-in Aura Dark and Aura Light shipped read-only. (`aaee109`, `0928dc6`)
- Polished light mode end-to-end: chat bubbles, nav rails, sidekick, modals, and mobile screens were routed through semantic tokens to fix white-on-white text and dark slabs; the user message bubble stays dark in both themes for sender contrast; ZUI form inputs got dedicated tokens so they're visible on white; the AURA wordmark inverts in light mode; and the titlebar/topbar toggle was simplified to a binary light↔dark switch. (`9f52c4e`, `085ff9a`, `8706839`, `f111847`, `401d9fb`, `ee63308`, `6fe2f64`)
- Restored keyboard focus visibility everywhere by removing the global outline:none override left over from the theme work and adding a single :focus-visible base rule using the theme's focus ring token, so tabbing through the app once again shows a visible indicator. (`e69bc31`)
- Sectioned Settings into About / Appearance / Notifications / Keyboard / Advanced with /settings/:section deep links and a mirrored mobile drill-in, added a mobile theme toggle in the persistent topbar, and merged app-scoped Settings into the taskbar gear's modal so Appearance is finally reachable from the desktop chrome. (`b94ad56`, `79f001d`, `7ec29ea`, `ac89c2f`)
- Shipped a first-run onboarding experience: a 2-step welcome modal, a portal-rendered floating checklist of 5 starter tasks (send message, create project, create agent, generate image, explore billing) with a help button in the taskbar, auto-detection via store subscriptions, and follow-up fixes so the create-agent and create-project tasks only complete on genuinely new entities. Empty states for chat, agents, and tasks were rewritten with prompt suggestions and clearer guidance. (`bd80420`, `988eee6`, `708e75e`, `6f91ff3`, `e5d310e`, `ec62961`, `11fc116`, `779d737`, `0d96fae`, `2f9dbb1`, `8d0ab5a`)
- Root-caused two CEO chat regressions: the sidebar prefetch LRU was evicting the active chat (the "CEO blink"), now fixed by pinning the active history key against eviction; and the cold-load transcript could stay permanently hidden on re-entry to a chat with carried-over messages, now fixed by proactively revealing once history resolves. (`3527198`, `4bc972e`)
- Fixed agent deletion: the UI now cascade-deletes project bindings (including the auto-created Home binding) before deleting the template, with a confirm modal that lists which projects will be detached, ending the 409 "still added to: Home" dead-end. (`95f172f`)
- Hardened the desktop shell: a native-HTML fallback titlebar in index.html keeps the frameless window draggable and closable even when the React app fails to mount (e.g. dev server unreachable or Vite errors), using the same wry IPC bridge as WindowControls. (`d2848bd`)
- Hid the Debug app from the taskbar by default via a new defaultHidden flag in the AuraApp registry, while preserving explicit user reorderings of visible vs hidden apps across reloads. (`4b47c85`)
- Defaulted REQUIRE_ZERO_PRO to false in both the server's app builder and the desktop build so unset environments no longer gate behind the Zero Pro requirement. (`ae418f3`, `d987125`)
- Restructured the largest interface modules into focused folders — PermissionsTab, aura-events, notes-store, chat-history-sync, shared entity types, AgentEnvironment, and the stream handlers test suite — without behavior changes, plus extracted a shared buildUserChatMessage helper to deduplicate the optimistic user-message construction across chat streaming hooks. (`78c08f2`, `e57e0be`, `3ee06ea`, `60f0af6`, `f2b997e`, `1d3e8e8`, `0b2c8a5`, `671d0b2`)

## 12:41 PM — Mixpanel token wired into desktop nightly builds

Desktop nightly builds now have access to the Mixpanel analytics token at build time.

- Passed VITE_MIXPANEL_TOKEN through to the desktop nightly workflow so analytics are correctly initialized in nightly desktop artifacts. (`814d663`)

## 12:42 PM — Slim 32px modal headers across all ZUI modals

Modal headers were aligned with the sidebar search rhythm by introducing, then promoting, a compact 32px header as the ZUI default.

- Added a compactHeader prop to ZUI Modal and applied it to the Apps and Org Settings modals so their title bars line up with the sidebar search input, then quickly promoted the slim 32px layout to the default for every ZUI Modal and removed the now-redundant prop. (`621104e`, `3702057`, `6209501`)

## 12:46 PM — Mixpanel token wired into mobile nightly builds

The mobile nightly pipeline now receives the same analytics token treatment as desktop.

- Forwarded VITE_MIXPANEL_TOKEN into the mobile nightly release workflow so iOS/Android nightly builds carry analytics configuration. (`a60654c`)

## 12:48 PM — Aura3D context memory and shared input bar shell

Aura3D remembers where users left off, and the chat and 3D prompt inputs now share a common shell.

- Aura3D now restores the last-used project on open, auto-selects the latest image plus its linked 3D model when switching tabs, and seeds defaults after a project's artifacts load, so users land on real content instead of an empty editor. (`4f26758`)
- Extracted a shared InputBarShell (with ModelPicker) used by both ChatInputBar and the Aura3D PromptInput, consolidating ~1.3k lines of duplicated input chrome into one component. (`c2f8653`)
- Tightened the onboarding task watcher further so create-agent and create-project tasks only complete when the count actually exceeds the initial baseline. (`c9514db`)

## 1:35 PM — Z Billing API key plumbed into desktop nightly

Desktop nightly builds gain access to the Z Billing API key secret at build time.

- Forwarded the Z_BILLING_API_KEY secret into the desktop nightly workflow so billing-related code paths can authenticate against the Z billing service in nightly builds. (`d24847f`)

## Highlights

- Full light/dark theming with custom tokens and presets
- First-run onboarding with welcome modal and checklist
- Two CEO chat regressions (blink + black panel) fixed at the root
- Settings unified under the taskbar gear with deep links
- Nightly CI gains Mixpanel and billing secret wiring

