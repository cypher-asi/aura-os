# Mobile engineering readiness

This change addresses reproducible mobile bugs and release-pipeline mistakes on
`acaddac37f2184125086b079d07745579caecd4c`. It does not change agent roles,
project ownership, workspace isolation, or billing architecture.

## Changes

- Derive mobile task state without an effect that repeatedly copies newly
  allocated arrays. Preserve live task updates while the initial request is
  pending, filter other-project events, and ignore late requests after navigation.
- Allow agent creation from the mobile layout even when a tablet reports a
  desktop user agent.
- Apply native purchase restrictions to subscription entry points and the modal
  itself. Web subscription controls remain available.
- Keep browser speech recognition disabled inside Capacitor until the native
  dictation path has been verified on devices. Add iOS permission descriptions.
- Bound the phone team-settings navigation height so its selected panel stays
  visible.
- Resolve mobile lint and module-boundary failures, including relocating the
  existing mobile theme and public-chat components into `src/mobile`.
- Use one iOS build-number calculation for push and manual runs, avoid cancelling
  active store-upload runs, honor Android release status, validate release API
  origins, and resolve Fastlane metadata from the lane files' locations. README
  placeholders no longer count as store metadata. Guard keystore materialization
  and use the canonical API host fallback in mobile workflows.
- Run focused mobile lint, unit, browser, and release-lane checks in CI.

## Verification

The original task-hook regression exhausted a bounded worker heap. The fixed
suite covers newly allocated inputs, context refreshes, task-event ordering,
project switching, and failed requests. Mobile lint previously reported 11 errors
and two warnings; it now passes with zero warnings.

Commands from `interface`:

```sh
npm run lint:mobile
npm run test:mobile
npm run build
npm run test:mobile:e2e
node --test scripts/validate-native-release-host.test.mjs
ruby scripts/tests/mobile-fastlane-test.rb
```

The unit selection contains 139 tests. The browser readiness selection contains
10 cases across Chromium and WebKit, covering phone navigation, tablet creation,
native/web billing, and the native voice guard. Tests exercise the production
frontend with deterministic API fixtures, not production accounts. Manual Chrome
inspection at 390 × 844 verified that phone Billing content is visible and native
purchase controls are absent. The release tests include four host checks and four
Fastlane tests with 19 assertions; uploads and signing are stubbed.

## Remaining work

This is not physical iOS/Android device validation or a store submission. Native
voice remains off pending that validation. Store branding, real listing assets,
privacy-manifest review, moderation controls, and broader security/storage review
need their own scoped work. The older complete PWA browser suite also contains
stale login/chat UI expectations; the new CI selection is a focused regression
suite, not a claim that every legacy browser test passes.
