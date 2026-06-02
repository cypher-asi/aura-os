# Clearing the runway for iOS App Review

- Date: `2026-06-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.581.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.581.1

Today's nightly is dominated by the work needed to get Aura past Apple's App Review rejection of build 4231. A public support page, camera and photo library permissions, and an end-to-end in-app account deletion flow all landed, alongside an eval fix that adapts to the new sidekick tab layout.

## 2:39 AM — Evals adapt to the new sidekick tab layout

End-to-end evals were updated after the new Sessions/Terminal/Browser tabs pushed Stats into the overflow menu and the first-run welcome modal began intercepting clicks.

- Smoke and workflow evals now open the More menu to assert the Stats menuitem, reflecting that Stats overflows at default panel width once the Sessions, Terminal, and Browser sidekick tabs are present. (`5bef97f`)
- Both eval bootstraps now seed onboarding as completed and dismissed in localStorage so the first-run welcome modal stops overlaying the app and silently swallowing clicks. (`5bef97f`)

## 4:16 AM — iOS camera and photo library permission prompts

Adds the Info.plist usage descriptions Apple flagged in build 4231, so picking or capturing an image no longer trips a TCC crash.

- Info.plist now ships NSCameraUsageDescription and NSPhotoLibraryUsageDescription, so agent image selection and message attachments prompt for permission instead of crashing on Take Photo (the Guideline 2.1a rejection). (`d851c7d`)

## 5:01 AM — Public /support page for the App Store Support URL

A standalone, ungated support route on aura.ai gives reviewers and signed-out users a real destination for the App Store Support URL.

- Adds a top-level /support route, mounted outside AppShell, RequireAuth, and the marketing gate, so aura.ai/support resolves for any visitor — fixing the Guideline 1.5 rejection that flagged https://aura.ai/ as having no support information. (`7b0499a`)
- The page is a lightweight marketing view with headline, support email, and footer note, lazy-loaded and served via the static site's SPA rewrite so the deep link works regardless of auth state. (`7b0499a`)

## 6:26 AM — Server-side delete-account proxy to zOS

A new protected backend endpoint forwards account deletion to zOS, laying the groundwork for the in-app delete flow Apple now requires.

- Adds POST /api/auth/delete-account, which forwards the caller's JWT to zOS POST /api/v2/accounts/delete (the ZERO mobile app's endpoint) and only tears down the local session if the upstream soft-delete actually succeeds — so a failure surfaces an error instead of falsely claiming the account is gone. (`3d8656b`)
- The route is registered behind the auth middleware and verified to reject unauthenticated callers with 401, ensuring the destructive upstream call is never reachable without a valid token. (`3d8656b`)

## 6:49 AM — In-app Delete Account flow for native builds

The Delete Account capability now reaches users: the interface auth store gained a deleteAccount action, and a native-only Delete Account section landed in the You settings pane, completing the Apple 5.1.1(v) requirement.

- The auth store now exposes a deleteAccount action backed by authApi.deleteAccount(); it deletes upstream first and, unlike logout, propagates errors so the local session stays intact on failure and only runs the logout teardown on success. (`ec4c31c`)
- Settings gains a Delete Account section gated to native builds via isNativeApp (mirroring credit purchases), with a confirmation modal whose copy makes the deletion explicitly permanent before invoking the store action. (`a30c08d`)
- Unit tests cover both store paths (success teardown and error propagation) and the settings flow's native gating, confirm interaction, and error display, with the real zui Modal exercised on the TestFlight build. (`ec4c31c`, `a30c08d`)

## Highlights

- Public /support page for the App Store Support URL
- iOS camera and photo library permission prompts
- Full in-app Delete Account flow for native builds
- E2E evals adapted to the new sidekick tabs

