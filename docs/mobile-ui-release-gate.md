# Mobile UI Release Gate

This document is the release gate for mobile UI work in Aura OS.

We do not call a mobile feature "done" unless it passes the discoverability, usability, verification, and desktop-safety checks below.

## Purpose

This gate exists to prevent four recurring mistakes:

1. A feature works by direct URL or hidden navigation, but not from the place a real user would expect it.
2. A desktop UI pattern gets reused on mobile even though it is awkward, noisy, or hard to complete on a phone.
3. A mobile change is validated in one shell only and then claimed as complete.
4. A mobile change silently regresses desktop because the code path was shared.

## Core Rule

No mobile UI decision is final until it is reviewed by a mobile UX specialist and then re-verified across mobile web, native, and desktop-safe paths.

## Required Review Lanes

Every meaningful mobile UI change must pass through these three lanes:

1. `Mobile UX review`
   The proposed UI is shown to a mobile-focused reviewer or sub-agent with real screenshots, not just code.

2. `Mobile reachability review`
   The feature is checked from the context where a user naturally needs it, especially from inside a project.

3. `Desktop regression review`
   Shared routing, shell selection, forms, and navigation are checked to confirm desktop behavior did not degrade.

## Hard Metrics

Any feature fails the release gate if it misses any `critical` metric.

### Discoverability

1. `critical` A user can find the feature from the context where they need it in 1 tap, or 2 taps maximum if the second tap is clearly labeled.
2. `critical` The feature is reachable from project context if the value is project-scoped.
3. `important` The feature does not rely on a hidden route, special redirect, or debugging path to be usable.

### Mobile Fit

4. `critical` The mobile UI uses a mobile-appropriate container.
Desktop floating modal overlays with a still-readable background fail by default.
5. `critical` The main action and back/close action are thumb-reachable and visually obvious.
6. `important` The first step contains only the minimum fields needed to create value.
7. `important` Advanced settings are deferred behind a secondary action or a follow-up screen.
8. `important` Background distraction is removed or heavily suppressed while the user is in a focused task.

### Navigation Continuity

9. `critical` The user always knows where they came from, what context they are acting in, and where they will land after success.
10. `critical` Existing project navigation is not removed or obscured without an intentional and tested replacement.

### Verification

11. `critical` The feature is validated in mobile web and native if the feature is expected to work in both.
12. `critical` The entry point, main flow, success state, and return path are all screenshot-verified.
13. `important` Verification must use real navigation paths, not just direct route entry.

### Desktop Safety

14. `critical` Desktop behavior is preserved by branching in mobile-only routes, shells, or components whenever possible.
15. `critical` Shared routing, shell selection, forms, and agent flows are re-tested after the change.
16. `important` Desktop screenshots or focused desktop E2E checks are reviewed before claiming completion.

## Mobile UX Review Rubric

Before implementation is accepted, the mobile UX reviewer must answer:

1. Is this reachable from where the user needs it?
2. Is this the right container for a phone?
3. Is the first screen too dense?
4. Is the primary action obvious?
5. Can the user recover if they back out?
6. Does the screen preserve project context?
7. Does this force a desktop mental model onto mobile?
8. Is the flow still valid in native, not just browser mobile?

If the answer is "no" to any of the first five questions, the feature is not ready to ship.

## Verification Matrix

When touching shared mobile/desktop routes, shells, navigation, or forms, the minimum verification matrix is:

### Mobile Web

1. Entry path from project context
2. Entry path from global app switcher if applicable
3. Main task flow
4. Success state
5. Return path
6. Screenshot capture for each step

### Native

1. App launches into the expected signed-in state
2. Entry path is reachable through real navigation
3. Main task flow is visually confirmed
4. Screenshot capture for each step
5. If the native shell cannot complete a backend-dependent branch in the current environment, the changed navigation, entry point, and container still need screenshot proof and the limitation must be stated explicitly.

### Desktop

1. Desktop shell still mounts
2. Project root behavior still matches desktop expectations
3. Shared forms still work on desktop
4. Shared agent/project navigation still works
5. Desktop screenshots or focused desktop E2E checks still pass

## Minimum Blocking Checks

Before claiming a mobile UI task is done:

1. `npm run build`
2. Focused unit tests for changed components
3. Focused mobile Playwright behavior tests
4. Focused mobile screenshot pass
5. Focused desktop responsive or desktop E2E checks
6. Native launch and screenshot confirmation if native is in scope
7. Specialist sign-off from:
   - a mobile UX reviewer
   - a desktop-regression reviewer
   - a release/verification reviewer when native or release-facing docs changed

## Claim Rules

We may say:

- `implemented`
  The code is in place.
- `web-verified`
  Mobile web flow is screenshot-verified.
- `native-verified`
  Native flow is screenshot-verified.
- `desktop-safe`
  Desktop checks passed after the change.

We may not say:

- `done`
- `functional`
- `parity`
- `verified`

unless all required lanes and metrics above have passed for the scope being claimed.

## Current Known Failures

As of this release pass, these failures remain active:

1. Native iOS app-switcher routing is still unreliable, which can limit clean native verification of some global mobile flows.
2. Mobile remote files currently ship as a read-only preview surface. Editing still belongs on desktop until a true remote write path exists.

## Working Rule For Future Changes

Before I implement a mobile UI decision:

1. Capture the current UI state.
2. Send the screenshot and proposed direction to a mobile UX specialist sub-agent.
3. Check discoverability from project context.
4. Implement only the smallest mobile-only change that preserves desktop behavior.
5. Run the mobile, native, and desktop verification matrix.
6. Do not claim parity or completion unless the gate is fully green.

## Example Scope Notes

For mobile project-agent and remote-files work, the shared release gate should usually call out only durable product constraints, not branch-specific proof claims:

1. Project-context agent actions should be discoverable from the active project.
2. Mobile project agent creation should reuse shared editor behavior whenever possible while preserving mobile-specific guardrails.
3. Mobile project files should stay in the project context instead of redirecting away.
4. Desktop-specific behavior should remain on the desktop path even when the viewport is narrow.

Typical intentional or environment-dependent limitations for this scope:

1. Mobile file access may be preview-only until a true remote write path is productized and verified.
2. Remote file preview requires at least one real remote file in the target workspace; empty workspaces can only prove the list state.
