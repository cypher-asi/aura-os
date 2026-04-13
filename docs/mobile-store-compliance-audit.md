# Mobile Store Compliance Audit

Last updated: 2026-04-12

This audit summarizes current Apple App Store and Google Play submission readiness
for the native mobile shells under `/interface/ios` and `/interface/android`.

## Current status

- Native billing purchase flows are intentionally disabled in mobile UI.
- Local iOS and Android Fastlane workflows are operational.
- Store upload lanes exist for both platforms.
- We are **not** yet fully submission-ready for either store.

## Verified safe behavior

### Native billing behavior

The native mobile apps intentionally do **not** expose in-app credit purchase
flows or deep-link users into web checkout from native UI.

Relevant files:

- `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/lib/billing.ts`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/components/BuyCreditsModal/BuyCreditsModal.tsx`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/components/BuyCreditsModal/useBuyCreditsData.ts`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/components/OrgSettingsBilling/OrgSettingsBilling.tsx`

Verified tests:

- `src/components/BuyCreditsModal/BuyCreditsModal.test.tsx`
- `src/components/OrgSettingsBilling/OrgSettingsBilling.test.tsx`

Current user-facing native billing message:

> Credit purchases aren't available in the mobile app.

This is safer than exposing external checkout from native.

## Submission blockers

### Shared blocker: account deletion

Both Apple and Google currently require an in-app account deletion initiation
path when users can create accounts in-app.

Current repo state:

- Account creation/login exists in:
  - `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/views/LoginView/LoginView.tsx`
  - `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/views/LoginView/use-login-form.ts`
- I did not find an in-app account deletion flow or backend delete-account API.

Impact:

- **Apple**: likely App Review rejection risk
- **Google Play**: explicit policy blocker

### Google Play blocker: UGC / AI moderation and reporting

The product contains social/feed/comments surfaces and AI-generated outputs, but
I did not find a clear in-app report / block / moderation control path for those
surfaces.

Relevant surfaces:

- `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/apps/feed`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/apps/profile/shared/ProfileCommentsPanel`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/src/hooks/use-chat-stream`

Impact:

- **Google Play**: likely policy blocker until moderation/reporting is addressed

### Apple / Google metadata blockers

The repo-level release checklist is still missing final submission metadata:

- privacy policy URL
- support URL / support email
- age/content rating answers
- review/demo credentials
- review notes / app access instructions
- final store listing copy
- final screenshots / preview assets

See:

- `/Users/shahrozkhan/Documents/zero/aura-os/README.md`

### iOS privacy disclosure follow-up

I did not find a repo-owned `PrivacyInfo.xcprivacy` file under the iOS app.
That does not automatically mean rejection, but it should be reviewed before
submission along with App Store Connect privacy declarations.

## Assets and release plumbing

### Already present

- iOS bundle ID: `tech.zero.aura`
- Android package name: `tech.zero.aura`
- iOS app icon asset catalog present
- Android launcher icons present
- iOS and Android Fastlane lanes present
- iOS and Android Fastlane `preflight` lanes present

Relevant files:

- `/Users/shahrozkhan/Documents/zero/aura-os/interface/capacitor.config.ts`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/ios/fastlane/Appfile`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/ios/fastlane/Fastfile`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/android/fastlane/Appfile`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/android/fastlane/Fastfile`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`
- `/Users/shahrozkhan/Documents/zero/aura-os/interface/android/app/build.gradle`

### Still missing before real store submission

- iOS Fastlane metadata/screenshots bundle
- Android Fastlane metadata/screenshots bundle
- App Store Connect record and final review metadata
- Play Console listing copy, Data safety form, and final screenshots
- reachable production backend reviewers can use

## Recommended next steps

1. Implement a real in-app account deletion flow plus backend support.
2. Add in-app reporting / moderation controls for social and AI-generated
   content, or sharply limit those surfaces in store builds.
3. Complete store metadata:
   - privacy policy URL
   - support URL/email
   - review/demo credentials
   - review notes
   - age/content rating answers
4. Verify iOS privacy disclosures, including whether a `PrivacyInfo.xcprivacy`
   file is needed for bundled SDK behavior.
5. Generate final store screenshots and listing assets once the above blockers
   are resolved.

## Specialist review summary

Apple reviewer: **No-ship**

- Primary blocker: account deletion path missing
- Secondary blocker: privacy / review metadata incomplete

Google Play reviewer: **No-ship**

- Primary blocker: account deletion path missing
- Secondary blocker: UGC / AI moderation and reporting path unclear

Assets / submission reviewer: **Not submission-ready**

- Release plumbing exists
- Final listing assets and store metadata are still incomplete
