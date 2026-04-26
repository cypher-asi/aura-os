# AURA Mobile iOS Sign-off

This file is the working ledger for mobile-first iOS validation. A screen is not signed off until it has:

- an iPhone simulator screenshot saved under `/tmp/aura-ios-signoff/`
- entry and exit transition exercised on the simulator
- no clipped safe-area content, overlapping text, desktop-scale panels, or sub-44px primary tap targets
- no accidental two-line project/menu rows unless the content is intentionally multiline

## Screens

| Area | Surface | Required states | Status | Evidence |
| --- | --- | --- | --- | --- |
| Auth | Login | default, host warning/configuration, loading/error | Not started | |
| Auth | Capture login | default, success/failure | Not started | |
| Global | Projects home | default, empty/loading/error if reachable | Not started | |
| Global | Settings route | production copy, version fallback, update state, back transition | Passed | `/tmp/aura-ios-signoff/expert-pass/21-settings-production-copy.jpg`, `/tmp/aura-ios-signoff/expert-pass/22-settings-back-to-profile.jpg` |
| Global | Organization workspace | default, org switch, create team modal | Not started | |
| Global | Account/settings sheet | root shortcuts, profile, feed, leaderboard, feedback, team, host | Not started | |
| Global | Profile | default, edit sheet, keyboard | Passed | `/tmp/aura-ios-signoff/blocker-pass/01-profile-mobile-first.jpg`, `/tmp/aura-ios-signoff/blocker-pass/02-profile-edit-sheet.jpg`, `/tmp/aura-ios-signoff/blocker-pass/03-profile-edit-keyboard.jpg` |
| Global | Feed | everything, leaderboard | Not started | |
| Global | Feedback | default, new feedback modal | Not started | |
| Navigation | Project drawer | closed, open, scroll reset, search open, filtered search, backdrop close | Passed | `/tmp/aura-ios-signoff/final-pass/08-drawer-open.jpg`, `/tmp/aura-ios-signoff/final-pass/09-drawer-search-open.jpg`, `/tmp/aura-ios-signoff/final-pass/10-drawer-search-filtered.jpg`, `/tmp/aura-ios-signoff/final-pass/11-drawer-backdrop-closed.jpg` |
| Navigation | Project tabs | Agents, Files, Tasks, Run, More | Passed | `/tmp/aura-ios-signoff/final-pass/18-agents-list-no-green-banner.jpg`, `/tmp/aura-ios-signoff/final-pass/02-project-files.jpg`, `/tmp/aura-ios-signoff/final-pass/03-project-tasks.jpg`, `/tmp/aura-ios-signoff/final-pass/04-project-run.jpg`, `/tmp/aura-ios-signoff/final-pass/17-tasks-more-inline-menu.jpg` |
| Navigation | More inline menu | Process, Stats, open/close from Tasks | Passed | `/tmp/aura-ios-signoff/final-pass/17-tasks-more-inline-menu.jpg`, `/tmp/aura-ios-signoff/final-pass/06-project-process.jpg`, `/tmp/aura-ios-signoff/final-pass/07-project-stats.jpg` |
| Project | Agents list | attached agents, add button, empty/loading | Partial | `/tmp/aura-ios-signoff/final-pass/18-agents-list-no-green-banner.jpg` |
| Project | Agent chat | empty chat, input focused/unfocused, keyboard, model picker, local-agent guard | Partial | `/tmp/aura-ios-signoff/prod-pass/13-chat-empty.jpg`, `/tmp/aura-ios-signoff/prod-pass/14-chat-keyboard-inset-fixed.jpg`, `/tmp/aura-ios-signoff/prod-pass/15-model-picker.jpg`, `/tmp/aura-ios-signoff/prod-pass/16-model-picker-expanded.jpg`, `/tmp/aura-ios-signoff/prod-pass/22-chat-local-guard.jpg` |
| Project | Agent details | default, back transition | Not started | |
| Project | Create agent | default, validation, submit loading/error | Not started | |
| Project | Attach agent | default, validation, submit loading/error | Not started | |
| Project | Files | empty/no-workspace state, tab transition | Passed | `/tmp/aura-ios-signoff/final-pass/02-project-files.jpg` |
| Project | Tasks | ready empty state, tab transition | Passed | `/tmp/aura-ios-signoff/final-pass/03-project-tasks.jpg` |
| Project | Run | idle state, tab transition | Passed | `/tmp/aura-ios-signoff/final-pass/04-project-run.jpg` |
| Project | Process | empty state, More transition | Passed | `/tmp/aura-ios-signoff/final-pass/06-project-process.jpg` |
| Project | Stats | default, scrolled, More transition | Passed | `/tmp/aura-ios-signoff/blocker-pass/04-stats-mobile-summary.jpg`, `/tmp/aura-ios-signoff/blocker-pass/05-stats-mobile-scrolled.jpg` |
| Overlays | Preview sheet | open, close, drag/scroll if applicable | Not started | |
| Overlays | Host settings modal | open, close, keyboard | Not started | |
| Overlays | Team settings modal | open, close | Not started | |
| System | Offline/loading banner | retry, host settings transition | Not started | |

## Transitions

| Transition | Status | Evidence |
| --- | --- | --- |
| Hamburger opens project drawer with fade backdrop | Passed | `/tmp/aura-ios-signoff/drawer-open-from-settings.jpg` |
| Backdrop closes project drawer | Passed | `/tmp/aura-ios-signoff/drawer-backdrop-closed.jpg` |
| Drawer project tap closes drawer and opens Agents | Passed | `/tmp/aura-ios-signoff/project-home-agents.jpg` |
| Drawer search opens/closes without layout jump | Passed | `/tmp/aura-ios-signoff/drawer-search-open.jpg`, `/tmp/aura-ios-signoff/drawer-search-filtered.jpg` |
| Project tab switch: Agents -> Files -> Tasks -> Run | Passed | `/tmp/aura-ios-signoff/project-home-agents.jpg`, `/tmp/aura-ios-signoff/project-files-final.jpg`, `/tmp/aura-ios-signoff/project-tasks.jpg`, `/tmp/aura-ios-signoff/project-run.jpg` |
| More opens inline from Tasks without overlaying content | Passed | `/tmp/aura-ios-signoff/final-pass/17-tasks-more-inline-menu.jpg` |
| Agent row opens chat | Passed | `/tmp/aura-ios-signoff/final-pass/18-agents-list-no-green-banner.jpg`, `/tmp/aura-ios-signoff/final-pass/19-agent-chat-header-local.jpg` |
| Chat input focus shows software keyboard without accessory toolbar | Passed | `/tmp/aura-ios-signoff/final-pass/20-agent-chat-keyboard-up-layer-stable.jpg` |
| Chat input keyboard hide keeps top layers visible | Passed | `/tmp/aura-ios-signoff/final-pass/21-agent-chat-keyboard-down-layer-stable.jpg` |
| Model picker opens, expands all models, selects model, closes | Passed | `/tmp/aura-ios-signoff/mobile-chat-model-sheet.jpg`, `/tmp/aura-ios-signoff/mobile-chat-model-expanded.jpg`, `/tmp/aura-ios-signoff/mobile-chat-model-selected.jpg` |
| Settings route opens from top-right settings and returns to origin | Passed | `/tmp/aura-ios-signoff/expert-pass/21-settings-production-copy.jpg`, `/tmp/aura-ios-signoff/expert-pass/22-settings-back-to-profile.jpg` |
| Settings sheet nested destination back/close | Not started | |
| Profile icon opens account sheet and closes | Not started | |
| Preview sheet opens/closes from file/task/detail flows | Not started | |

## Final Pass 2026-04-25

| Step | Screenshot |
| --- | --- |
| Agent chat composer | `/tmp/aura-ios-signoff/final-pass/01-agent-chat-composer.jpg` |
| Files tab | `/tmp/aura-ios-signoff/final-pass/02-project-files.jpg` |
| Tasks tab | `/tmp/aura-ios-signoff/final-pass/03-project-tasks.jpg` |
| Run tab | `/tmp/aura-ios-signoff/final-pass/04-project-run.jpg` |
| More popover | `/tmp/aura-ios-signoff/final-pass/05-project-more-popover.jpg` |
| Process via More | `/tmp/aura-ios-signoff/final-pass/06-project-process.jpg` |
| Stats via More | `/tmp/aura-ios-signoff/final-pass/07-project-stats.jpg` |
| Drawer open | `/tmp/aura-ios-signoff/final-pass/08-drawer-open.jpg` |
| Drawer search open | `/tmp/aura-ios-signoff/final-pass/09-drawer-search-open.jpg` |
| Drawer search filtered | `/tmp/aura-ios-signoff/final-pass/10-drawer-search-filtered.jpg` |
| Drawer backdrop closed | `/tmp/aura-ios-signoff/final-pass/11-drawer-backdrop-closed.jpg` |
| Profile screen | `/tmp/aura-ios-signoff/final-pass/12-profile-screen.jpg` |
| Settings screen | `/tmp/aura-ios-signoff/final-pass/13-settings-screen.jpg` |
| Settings production copy/back transition | `/tmp/aura-ios-signoff/expert-pass/21-settings-production-copy.jpg`, `/tmp/aura-ios-signoff/expert-pass/22-settings-back-to-profile.jpg` |
| Agents list | `/tmp/aura-ios-signoff/final-pass/14-agents-list.jpg` |
| Agent row opens chat | `/tmp/aura-ios-signoff/final-pass/15-agent-chat-open.jpg` |
| Agent chat software keyboard, no accessory toolbar | `/tmp/aura-ios-signoff/final-pass/16-agent-chat-software-keyboard-no-accessory.jpg` |
| Tasks More inline menu | `/tmp/aura-ios-signoff/final-pass/17-tasks-more-inline-menu.jpg` |
| Agents list without green banner | `/tmp/aura-ios-signoff/final-pass/18-agents-list-no-green-banner.jpg` |
| Agent chat local header | `/tmp/aura-ios-signoff/final-pass/19-agent-chat-header-local.jpg` |
| Agent chat keyboard up, layer stable | `/tmp/aura-ios-signoff/final-pass/20-agent-chat-keyboard-up-layer-stable.jpg` |
| Agent chat keyboard down, layer stable | `/tmp/aura-ios-signoff/final-pass/21-agent-chat-keyboard-down-layer-stable.jpg` |

## Current Rule

Do not mark a new row `Passed` unless the simulator screenshot and transition check are both present. If a screen looks merely acceptable but interaction is unverified, mark it `Partial`.

## Expert Mobile UI/UX Pass 2026-04-25

This pass is from the lens of mobile navigation and visual quality. It is intentionally strict: a screen can navigate correctly and still be marked `Partial` if it feels desktop-scaled, cramped, or risky under keyboard/safe-area conditions.

| Flow | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Project tabs: Agents, Files, Tasks, Run | Passed | `/tmp/aura-ios-signoff/expert-pass/01-agents-list.jpg`, `/tmp/aura-ios-signoff/expert-pass/02-files-empty.jpg`, `/tmp/aura-ios-signoff/expert-pass/03-tasks-empty.jpg`, `/tmp/aura-ios-signoff/expert-pass/04-run-idle.jpg` | Navigation is stable. Empty states are readable. |
| More inline menu from Run/Tasks | Passed | `/tmp/aura-ios-signoff/expert-pass/05-run-more-inline.jpg` | Inline expansion no longer overlays/distorts content. |
| Process | Passed | `/tmp/aura-ios-signoff/expert-pass/06-process-empty.jpg` | Clear empty state, no clipping. |
| Stats | Partial | `/tmp/aura-ios-signoff/expert-pass/07-stats-top.jpg`, `/tmp/aura-ios-signoff/expert-pass/08-stats-scrolled.jpg` | Navigates and scrolls, but the metric grid feels dense and desktop-like. |
| Add agent sheet | Passed | `/tmp/aura-ios-signoff/expert-pass/09-add-agent-sheet.jpg` | Bottom sheet behavior and sizing are acceptable. |
| Create agent form | Passed | `/tmp/aura-ios-signoff/expert-pass/13-create-agent-keyboard-pass.jpg` | Reordered form above setup summary so first fields stay usable with keyboard. Prior failing state kept as `/tmp/aura-ios-signoff/expert-pass/11-create-agent-keyboard-fail.jpg`. |
| Drawer open/search/filter | Passed | `/tmp/aura-ios-signoff/expert-pass/14-drawer-open.jpg`, `/tmp/aura-ios-signoff/expert-pass/15-drawer-search-open.jpg` | Drawer width, search, and backdrop are stable. |
| Profile route | Partial | `/tmp/aura-ios-signoff/expert-pass/16-profile-route.jpg` | Navigates, but the profile surface still feels too desktop/card-framed for first-class mobile. |
| Profile edit modal | Partial | `/tmp/aura-ios-signoff/expert-pass/17-profile-edit-modal.jpg` | Opens, but layout is dense and modal-like instead of native-sheet-like. Save was not pressed because it would modify profile data. |
| Settings route | Passed | `/tmp/aura-ios-signoff/expert-pass/21-settings-production-copy.jpg`, `/tmp/aura-ios-signoff/expert-pass/22-settings-back-to-profile.jpg` | Revalidated after the previous pass missed product copy and navigation. No `.env.example` copy, no fake `0.0.0 (Stable)` label, and top-left back returns to the originating screen. |
| Chat model picker | Passed | `/tmp/aura-ios-signoff/expert-pass/19-model-picker.jpg`, `/tmp/aura-ios-signoff/expert-pass/20-model-picker-expanded.jpg` | Sheet sizing, grouping, and selected state are stable. |

Side-effectful controls intentionally not triggered in this pass: Start remote work, Create Agent submit, Attach Existing Agent submit, Save profile, Log out, file/image pickers. These need confirmation or test fixtures before execution because they modify data, start work, or touch local files.

## Production Pass 2026-04-25

This pass was run after the mobile-first fixes and after rebuilding the native iOS bundle. Multiple review agents were used for route/content inventory and mobile UI/UX/code review; this table records only simulator-backed sign-off.

| Flow | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Profile route branding | Partial | `/tmp/aura-ios-signoff/prod-pass/01-profile-brand-fixed.jpg`, `/tmp/aura-ios-signoff/prod-pass/20-profile-route.jpg` | Footer and app name now say AURA. The profile surface is still too card-framed and desktop-like for final mobile sign-off. |
| Profile edit | Partial | `/tmp/aura-ios-signoff/prod-pass/21-profile-edit-modal-partial.jpg` | Opens and closes, but it should become a native sheet or dedicated edit screen before production. Save was not pressed. |
| Drawer open/projects | Passed | `/tmp/aura-ios-signoff/prod-pass/02-drawer-open-projects.jpg` | Search is hidden behind an icon, rows stay single-line with truncation, backdrop is visible. Group/row hit targets still need continued watching because project rows sit close to expand/collapse affordances. |
| Agents list | Passed | `/tmp/aura-ios-signoff/prod-pass/03-agents-list.jpg` | List dimensions are stable after rebuild; attached agent row opens chat. |
| Files empty | Passed | `/tmp/aura-ios-signoff/prod-pass/04-files-empty.jpg` | Empty state uses mobile-safe copy and remote-workspace language. |
| Tasks empty | Passed | `/tmp/aura-ios-signoff/prod-pass/05-tasks-empty.jpg` | Segmented task state remains stable. |
| Run idle | Passed | `/tmp/aura-ios-signoff/prod-pass/06-run-idle.jpg` | Idle state is readable and does not distort under the tab bar. |
| More inline | Passed | `/tmp/aura-ios-signoff/prod-pass/07-more-inline.jpg` | More opens inline without the distortion previously reported. |
| Process empty | Passed | `/tmp/aura-ios-signoff/prod-pass/08-process-empty-fixed.jpg` | Removed desktop-app copy; no `.env`/developer instruction leakage. |
| Stats | Partial | `/tmp/aura-ios-signoff/prod-pass/09-stats-top.jpg` | Navigates, but the metric grid still feels too dense and desktop-derived. |
| Add agent sheet | Passed | `/tmp/aura-ios-signoff/prod-pass/10-add-agent-sheet.jpg` | Bottom sheet controls now satisfy the 44px target rule. |
| Create agent form | Passed | `/tmp/aura-ios-signoff/prod-pass/11-create-agent-form.jpg`, `/tmp/aura-ios-signoff/prod-pass/12-create-agent-keyboard.jpg` | Keyboard appears, no accessibility accessory layer, primary fields stay usable. Submit was not pressed. |
| Agent chat empty/keyboard | Passed | `/tmp/aura-ios-signoff/prod-pass/13-chat-empty.jpg`, `/tmp/aura-ios-signoff/prod-pass/14-chat-keyboard-inset-fixed.jpg` | Composer sits above the software keyboard with no extra arrow/checkmark accessory layer. |
| Model picker | Passed | `/tmp/aura-ios-signoff/prod-pass/15-model-picker.jpg`, `/tmp/aura-ios-signoff/prod-pass/16-model-picker-expanded.jpg` | Latest model list is visible and expandable. |
| Local-agent mobile guard | Passed | `/tmp/aura-ios-signoff/prod-pass/17-chat-local-error-rendered.jpg`, `/tmp/aura-ios-signoff/prod-pass/22-chat-local-guard.jpg` | Reproduced the old failed local send, then rebuilt with the mobile guard. Local agents now show `Remote agent required` instead of allowing a failed send. |
| Settings route/back | Passed | `/tmp/aura-ios-signoff/prod-pass/18-settings-production.jpg`, `/tmp/aura-ios-signoff/prod-pass/19-settings-back-to-chat.jpg` | Production copy is clean: no `.env.example`, no fake `0.0.0 (Stable)`, and back returns to the originating chat. |

Remaining production blockers before full sign-off:

- Auth, capture login, feed, feedback, organization workspace, host settings, team settings, file picker/upload, and destructive/session-ending actions were not fully simulator-validated in this pass.
- A remote-agent send success path needs a test fixture with a live remote workspace; local agents are now guarded on mobile.

## Blocker Pass 2026-04-25

This pass addressed the two visual blockers from the production pass: Profile/Edit and Stats. The native bundle was rebuilt and rerun on the iPhone 17 simulator before capture.

| Flow | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Profile mobile surface | Passed | `/tmp/aura-ios-signoff/blocker-pass/01-profile-mobile-first.jpg` | Replaced the desktop card with a mobile-first identity surface. Removed the duplicate stacked profile action row from mobile. |
| Profile edit sheet | Passed | `/tmp/aura-ios-signoff/blocker-pass/02-profile-edit-sheet.jpg` | Replaced the desktop modal with a mobile bottom sheet. Save was not pressed. |
| Profile edit keyboard | Passed | `/tmp/aura-ios-signoff/blocker-pass/03-profile-edit-keyboard.jpg` | Software keyboard appears without the accessory arrow/check layer; focused field remains visible. |
| Stats mobile summary | Passed | `/tmp/aura-ios-signoff/blocker-pass/04-stats-mobile-summary.jpg` | Replaced dense grid with completion hero, compact summary metrics, and readable task/activity lists. |
| Stats scroll state | Passed | `/tmp/aura-ios-signoff/blocker-pass/05-stats-mobile-scrolled.jpg` | Lower activity rows remain readable and safe-area clean while scrolling. |

Remaining production blockers before full app sign-off:

- Auth, capture login, feed, feedback, organization workspace, host settings, team settings, file picker/upload, and destructive/session-ending actions still need dedicated safe fixtures or user confirmation before full simulator validation.
- A remote-agent send success path still needs a live remote workspace fixture; local agents are guarded on mobile.
