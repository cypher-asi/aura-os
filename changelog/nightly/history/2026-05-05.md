# Shell chrome restored and analytics sharpened

- Date: `2026-05-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.461.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.461.1

Today's nightly rolls back a shell-trim experiment that had quietly regressed the desktop titlebar, mode selector, and right-click menu, then re-lands the per-mode color accents on the restored animated pill. Earlier in the day, analytics events were tightened so DAU and checkout funnels reflect what actually happened.

## 3:33 AM — Truthful analytics for sessions and checkout intent

Analytics instrumentation was reworked so DAU reflects real activity and purchase events no longer overstate completion.

- Added a session_active event fired once per authenticated user load, with user identification, so DAU tracking reflects actual signed-in usage instead of incidental page hits. (`25abb62`)
- Renamed credits_purchased and subscription_started to credits_checkout_started and subscription_checkout_started so funnel data reflects checkout intent rather than completed purchases. (`32f8ad0`)

## 9:08 AM — Desktop shell chrome and mode pill restored after trim regressions

A prior shell-trim refactor was reverted to bring back the bespoke titlebar, animated mode selector, and shared right-click menu, with per-mode accents re-ported onto the restored pill.

- Reverted the shell-trim experiment to restore the bespoke ShellTitlebar with MenuBar and the compact UpdatePill placed next to the theme toggle, replacing the plain Topbar and detached UpdateBanner that had shipped in its place. (`4fd0e5e`)
- Brought back the measured, animated mode selector indicator that slides between segments and matches the input control's height, and reinstated the inline CommandChips slot so slash-command tags render next to the textarea again. (`4fd0e5e`)
- Rewired the BottomTaskbar and DesktopApp to the shared useDesktopContextMenu, restoring viewport-aware right-click positioning near the taskbar and the Settings entry that had gone missing with the inline portal. (`4fd0e5e`)
- Re-ported per-mode accent colors (green for Code, amber for Plan, cyan for Image, purple for 3D) onto the restored animated indicator via a data-mode attribute, and tightened the UpdatePill's horizontal padding so it sits cleanly in the titlebar; a global no-op ResizeObserver in the test setup keeps mode-pill consumers from crashing under JSDOM. (`6345213`)

## Highlights

- Desktop shell chrome and right-click menu restored
- Per-mode tint re-ported onto animated mode pill
- Analytics: session_active event and clearer checkout naming

