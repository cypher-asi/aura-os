# Clearing App Review blockers and steadying the eval suite

- Date: `2026-06-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.580.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.580.1

Today's nightly is focused on unblocking the iOS App Store submission and keeping the end-to-end eval suite green after the recent sidekick tab redesign. Two App Review rejections from build 4231 were addressed directly — missing camera permissions and a missing Support URL — alongside test fixes that adapt to the new sidebar layout.

## 2:39 AM — Evals adapt to sidekick overflow and onboarding overlay

Smoke and workflow evals were updated to match the new sidekick layout and to stop tripping over the first-run welcome modal.

- Smoke and workflow evals now locate Stats inside the new More overflow menu, reflecting how the Sessions/Terminal/Browser sidekick tabs push Stats out of the top-level row at default panel width. (`5bef97f`)
- Eval bootstraps now seed onboarding as completed and dismissed so the first-run welcome modal no longer overlays the app and silently intercepts clicks during automated runs. (`5bef97f`)

## 4:16 AM — iOS camera and photo library permissions for App Review

Added the Info.plist usage strings required when the in-app image picker reaches the camera or photo library, fixing the TCC crash that got build 4231 rejected under Guideline 2.1a.

- Info.plist now declares NSCameraUsageDescription and NSPhotoLibraryUsageDescription so agent image selection and message attachments prompt for permission instead of crashing when Take Photo is tapped on iOS. (`d851c7d`)

## 5:01 AM — Public /support page for App Store Guideline 1.5

Shipped a standalone, ungated support page on aura.ai so the App Store Connect Support URL points to real contact information regardless of auth state.

- Added a new /support route mounted outside AppShell and RequireAuth, so reviewers and logged-out users can reach a support contact directly at aura.ai/support via the static site's SPA rewrite. (`7b0499a`)
- Introduced a dedicated SupportView with its own marketing styling and a tested Support heading, giving the page a polished standalone presentation rather than reusing the gated app shell. (`7b0499a`)

## Highlights

- iOS camera and photo library permissions added to unblock App Review
- New public /support page satisfies App Store Guideline 1.5
- E2E evals adapted to the new sidekick tab overflow

