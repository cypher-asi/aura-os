# Clearing App Review: account deletion, support page, and iOS permissions

- Date: `2026-06-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.582.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.582.1

Today's nightly is focused on unblocking the iOS App Store submission that was rejected on build 4231. Three separate App Review issues — missing camera permissions, a missing Support URL, and the lack of in-app account deletion — were each addressed end to end, alongside a mobile settings scroll fix and an evals update to keep CI green against the new sidekick tab layout.

## 2:39 AM — Evals adapt to the new sidekick tab overflow

End-to-end evals were updated to match the recent sidekick tab layout and to stop tripping over the first-run welcome modal.

- Smoke and workflow evals now reach Stats via the More overflow menu, reflecting the new Sessions/Terminal/Browser tabs that push Stats off the top row at default panel widths. (`5bef97f`)
- Both eval bootstraps seed onboarding as completed and dismissed so the first-run welcome modal no longer overlays the app and silently intercepts clicks during runs. (`5bef97f`)

## 4:16 AM — iOS camera and photo library permission prompts

Fixes the App Review 2.1a rejection where tapping Take Photo crashed the iOS build with a TCC abort.

- Added NSCameraUsageDescription and NSPhotoLibraryUsageDescription to the iOS Info.plist so agent image selection and message attachments now prompt for permission instead of crashing on launch of the native picker. (`d851c7d`)

## 5:01 AM — Public /support page for the App Store Support URL

Addresses the App Review 1.5 rejection by giving reviewers and users a real support landing page regardless of auth state.

- Added a standalone, ungated /support route on the aura.ai static site, mounted outside AppShell and the marketing gate so a logged-out reviewer can deep-link straight to a support contact. (`7b0499a`)
- Shipped a dedicated SupportView with its own wordmark, headline, contact email button, and styling, plus a render test asserting the Support heading is present. (`7b0499a`)

## 6:26 AM — Backend delete-account proxy to zOS

Lays the server-side foundation for Apple Guideline 5.1.1(v) in-app account deletion, with strict failure semantics.

- Added a protected POST /api/auth/delete-account endpoint on the aura-os-server that forwards the caller's JWT to zOS's /api/v2/accounts/delete, then tears down the local session — but only after the upstream soft delete succeeds, so a failure surfaces the error instead of lying about the account being gone. (`3d8656b`)
- Verified via a new integration test that the route is registered and auth-guarded, returning 401 without a bearer token so the destructive upstream call is never reached unauthenticated. (`3d8656b`)

## 6:49 AM — In-app Delete Account flow for iOS and mobile scroll fix

Completes the App Store 5.1.1(v) requirement with a native-only Delete Account flow in settings, and unblocks scrolling on tall mobile settings panes.

- Wired authApi.deleteAccount() and a deleteAccount store action that calls the upstream delete first and, unlike logout, propagates failures so the local session stays intact on error — with unit tests covering both the success and failure paths. (`ec4c31c`)
- Added a Delete Account section to the You settings pane, gated to the native app via isNativeApp, opening a confirmation modal with explicit irreversibility copy before invoking the delete action and signing the user out on success. (`a30c08d`)
- Fixed mobile settings panes (notably You) being clipped below the fold by making .settingsRoot its own scroll viewport with flex:1, min-height:0, and overflow-y:auto, since the native shell disables body scrolling via Capacitor. (`bd3dd4e`)

## Highlights

- iOS camera and photo library permissions wired up
- Public /support page shipped for App Store reviewers
- Full in-app account deletion flow built end to end
- Mobile settings panes are scrollable again

