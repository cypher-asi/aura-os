# First-run onboarding gets a two-lane choice, plus chat routing that actually remembers where you were

- Date: `2026-07-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.742.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.742.1

Today's nightly reworks the very first moments in Aura and tightens the chat surface around it. New users now pick between "Just Start" and "Set Up My Agent" instead of being dropped into a six-step wizard, and the chat app learned to preserve, restore, and share concrete session routes across taskbar returns, fresh canvases, and public visitors. The desktop shell also stops flashing hidden windows in CI, and the public chat's free-message limit finally has a real UI.

## 3:10 AM — Fresh chat canvases bind to a real session after first send

The chat app's fresh-canvas flow now correctly hands off to the persisted session route as soon as the first message materializes, without racing the session list.

- Fresh chat routes now consistently flag as pending until a session exists, and the fresh canvas key is threaded through to the standalone chat hook so the next send is armed as a new session exactly once per canvas. (`378f600`, `8a544bb`)
- After a fresh send lands, ChatAppRoute swaps the `fresh=` param for a full `session/project/instance/agent` URL via a replace navigation, so reloads and back-navigation land on the real session instead of a blank canvas. (`164f2d2`)
- Share links from the message actions menu now read the canonical `project`/`instance`/`session` params from the URL, fixing shares started from agent-scoped stream keys. (`8a544bb`)

## 4:46 AM — macOS desktop launches visibly, CI stays headless

The desktop shell now opens its main window on launch for real users while suppressing it on CI runners so automated builds don't pop UI.

- The macOS main window is shown on launch by default, restoring the expected first-open behavior for desktop users. (`2665200`)
- Standard CI environments are detected via env and keep the desktop window hidden, so builds and headless tests no longer flash a window. (`c9d2b5c`, `a3ca860`)

## 5:47 AM — Taskbar returns, session hydration, and mobile public chat polish

The chat app now remembers the concrete session route you last had open, the web session list survives malformed data and legacy API hosts, and the mobile public chat shell gets a touch-friendly refresh.

- Opening chat from the taskbar or nav rail restores the exact `session/project/instance/agent` route you were last on, including derivation from legacy session-only links, while fresh canvases are explicitly not remembered. (`5f2505a`, `debe58e`)
- Web session hydration is hardened: SessionsList tolerates a polluted `sessions` prop by rendering the empty state, and host-config canonicalizes the legacy Render API origin to `https://api.aura.ai` on production web even when a stale value is stored. (`17db544`)
- The mobile public chat shell bumps top-bar and button targets to 48px with safe-area-aware padding, adds `touch-action: manipulation`, and ships new copy for the free-message limit state. (`3329590`)

## 10:38 AM — Public chat gets a real free-limit gate

When a public visitor hits the free-message cap, the composer is replaced with a titled notice and login/sign-up actions instead of surfacing a raw error.

- PublicChatView detects the limit-reached error, swaps the input bar for a rounded limit notice with title, body, and primary/secondary CTAs, and mirrors the same handling in the mobile view so streams stop cleanly at the cap. (`be5b4cc`)
- New localized strings introduce a dedicated title, body, and placeholder for the free-chat limit state driving both the desktop and mobile public views. (`be5b4cc`)

## 10:37 PM — Two-lane first-run onboarding replaces the six-step wizard

New users now see a two-card choice — Just Start or Set Up My Agent — backed by a latched, authority-gated first-run signal so the modal only appears for genuine new accounts.

- The auto-opening 6-step wizard is replaced by an OnboardingChoice modal: Just Start relies on `ensureCeoHome()` auto-provisioning and (on desktop) shows a one-shot project folder prompt banner, while Set Up My Agent opens the wizard trimmed to Identity, Expertise, and Launch. Lane selection is instrumented via an `onboarding_lane_selected` analytics event. (`4604c18`)
- `firstRunDetected` is now a latched, authority-gated decision in agent-store: it only settles once per signed-in session and only from an org-scoped fetch (or a confirmed zero-org roster), so existing users switching into an empty org can no longer be misclassified as new. (`4604c18`)
- `ensureCeoHome` is deferred until the org-scoped fetch, and a swallowed-refetch race is fixed by re-running `fetchAgents` when the org scope drifts — so a brand-new user reliably gets a default CEO and sees the onboarding choice instead of waiting for a 30s TTL. (`4604c18`)
- OnboardingChoice is lazy-loaded and gated behind `isAuthenticated`, the folder-prompt storage key is scoped per user with an in-memory fallback when localStorage is blocked, and account switches fully reset the store so one user's onboarding state can't leak into another's session. (`4604c18`)

## Highlights

- New two-lane first-run onboarding replaces the 6-step wizard
- Fresh chat canvases now adopt a real session URL after the first send
- Taskbar returns preserve the exact chat session route
- Public chat has a proper free-limit gate with login CTAs
- macOS desktop window shows on launch but stays hidden in CI

