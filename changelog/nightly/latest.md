# Clearing the path to App Store approval

- Date: `2026-06-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.583.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.583.1

Today's work is almost entirely focused on unblocking the iOS App Store submission for build 4231. The team shipped the missing pieces App Review flagged — camera and photo permissions, a public support page, in-app account deletion — alongside mobile polish (scrollable settings, a Log Out button, clearer chat guidance) and a fix to keep evals green as the sidekick UI evolves.

## 2:39 AM — Evals adapt to the new sidekick tab layout

End-to-end evals were updated to match the new Stats overflow behavior and to dismiss the first-run welcome modal that was silently intercepting clicks.

- Smoke and workflow evals now open the More menu to assert the Stats menuitem, reflecting that new Sessions/Terminal/Browser sidekick tabs push Stats into the overflow at default panel width. (`5bef97f`)
- Both eval bootstraps now seed onboarding as skipped so the welcome modal no longer overlays the app and swallows clicks during runs. (`5bef97f`)

## 4:16 AM — iOS camera and photo library permissions

Adds the Info.plist usage descriptions whose absence was crashing Take Photo on iOS and triggered an App Review rejection under Guideline 2.1a.

- NSCameraUsageDescription and NSPhotoLibraryUsageDescription are now declared, so agent image selection and message attachments prompt for permission instead of hitting a TCC abort. (`d851c7d`)

## 5:01 AM — Public /support page for App Store reviewers

A standalone, ungated support page now lives at aura.ai/support to satisfy Guideline 1.5, accessible to reviewers and users regardless of auth state.

- New SupportView is mounted as a top-level route outside AppShell and RequireAuth so the deep link resolves for logged-out visitors via the static site's SPA rewrite. (`7b0499a`)
- The page presents the Aura wordmark, a Support headline, and a contact email so App Store Connect's Support URL can point at it once support@aura.ai is live. (`7b0499a`)

## 6:26 AM — Delete-account backend proxy to zOS

A new protected server endpoint forwards account-deletion requests upstream to zOS, laying the groundwork for the in-app deletion flow required by Apple 5.1.1(v).

- POST /api/auth/delete-account is registered and auth-guarded, proxying the caller's JWT to zOS's accounts/delete and tearing down the local session only after the upstream delete succeeds so failures surface instead of silently orphaning state. (`3d8656b`)

## 6:49 AM — Mobile account management lands in the You pane

The client side of the iOS-submission push: Delete Account and Log Out now live in the mobile You settings, the settings screen finally scrolls, and the local-agent chat prompt is clearer.

- The auth store gained a deleteAccount action that calls the new backend, propagates errors so the UI can surface them, and only runs the logout teardown after a successful upstream delete. (`ec4c31c`)
- A native-only Delete Account section with a permanent-deletion confirmation modal now sits at the bottom of the You pane, completing the in-app deletion requirement for iOS submission. (`a30c08d`)
- A native-only Log Out row sits above Delete Account, giving mobile users an accessible sign-out that desktop already had via OrgSettingsPanel. (`0d63c19`)
- Mobile settings screens are now their own scroll viewport, so tall panes like You are reachable below the fold instead of being clipped by the bounded native shell. (`bd3dd4e`)
- The disabled mobile chat input now reads "Remote agent required. Please switch agent" — with a smaller placeholder so the longer guidance fits — making the next step explicit for users and App Review when a local agent is selected. (`cd1a379`)

## Highlights

- iOS in-app account deletion shipped end-to-end (Apple 5.1.1v)
- Camera and photo library permissions added to unblock Take Photo
- Public /support page live for App Store Guideline 1.5
- Mobile settings now scroll and expose Log Out

