# Android reaches release readiness with a signed bundle lane

- Date: `2026-09-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.838.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.838.1

Today's nightly is an Android-focused milestone: the mobile app closes out its release-readiness checklist with real navigation, capability-aware setup, and friendlier chat errors, and CI gains a dedicated signed App Bundle lane for manual Play Console uploads.

## 1:13 PM — Android app closes out release-readiness checklist

A broad mobile push lands persistent navigation, friendlier chat errors, capability-aware agent setup, and a proper Android hardware-back behavior, alongside CI fixes needed to keep the Android build green.

- Chat now has persistent mobile navigation and project screens expose task and project creation directly from the nav, closing several usability gaps around getting into and around the mobile app. (`ad4d78f`)
- Android's hardware back button now cooperates with the in-app SPA router: MainActivity inspects the History API's index and pops the React Router route before falling through to Android's activity back, so back no longer unexpectedly exits the app during in-app navigation. (`ad4d78f`)
- Hosted agent setup is now capability-aware, and chat error bubbles collapse noisy technical details behind a summary so mobile users see a readable message instead of a wall of stack trace. (`ad4d78f`)
- Android CI was realigned with current runtimes by pinning the setup-android action to install only the SDK packages we actually need, working around the removal of the legacy `tools` package in command-line tools v20 that had been breaking the mobile and nightly release workflows. (`ad4d78f`)

## 6:18 PM — Signed Android App Bundle lane for manual Play uploads

A new Fastlane lane and CI option produce a signed .aab artifact you can hand-upload to the Play Console without wiring up Play API credentials.

- Added a `signed_bundle` Fastlane lane that builds a signed Android App Bundle and surfaces its path, giving operators a way to ship to Google Play manually when Play API credentials aren't available. (`297f1c7`)
- The Android mobile workflow exposes the new `signed_bundle` choice (mapped to the `bundle` channel), and the release-secrets verifier now recognizes the lane and enforces the standard signing variables. (`297f1c7`)
- README release docs document the new lane alongside `preflight`, `beta`, and `release`, so the manual Play Console path is discoverable. (`297f1c7`)

## Highlights

- Android release readiness completed
- Persistent Chat nav and hardware back button on Android
- New signed .aab lane for manual Play Console uploads

