# Release Build Strategy

## Goal

Add a reliable release-build layer for Aura across:

- macOS desktop
- Windows desktop
- Linux desktop
- Android mobile
- iOS mobile

This layer should automate packaging, verification, publishing, and update
delivery without changing normal product behavior for desktop, browser, or
mobile users.

## Non-Goals

This project should not:

- change the normal agent, chat, project, or build-loop product flows
- introduce release-only code paths into the standard user experience unless
  they are explicitly gated for CI or packaging
- replace the existing local-stack eval system
- replace Fastlane for mobile store delivery

## Design Principles

1. Keep functional verification and release verification separate.
2. Reuse shared tests instead of duplicating them per platform.
3. Use native runners for native binaries.
4. Use Docker for service integration, not as the primary desktop packaging tool.
5. Make release automation additive and low-risk to existing product behavior.

## Current State

The repo already contains major pieces of the release system:

- Desktop nightly release workflow:
  [release-nightly.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/release-nightly.yml)
- Desktop stable release workflow:
  [release-stable.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/release-stable.yml)
- Desktop packager metadata:
  [Cargo.toml](/Users/shahrozkhan/Documents/zero/aura-os/apps/aura-os-desktop/Cargo.toml)
- Desktop updater implementation:
  [updater.rs](/Users/shahrozkhan/Documents/zero/aura-os/apps/aura-os-desktop/src/updater.rs)
- Desktop build-time frontend bundling:
  [build.rs](/Users/shahrozkhan/Documents/zero/aura-os/apps/aura-os-desktop/build.rs)
- Android workflow and Fastlane path:
  [android-mobile.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/android-mobile.yml)
- iOS workflow and Fastlane path:
  [ios-mobile.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/ios-mobile.yml)

The repo also already contains strong functional verification via the eval
stack:

- local-stack orchestration:
  [evals/local-stack/README.md](/Users/shahrozkhan/Documents/zero/aura-os/evals/local-stack/README.md)
- Playwright evals:
  [frontend/tests/e2e/evals](/Users/shahrozkhan/Documents/zero/aura-os/frontend/tests/e2e/evals)

For the current operational workflow map, see:

- [release-workflows.md](/Users/shahrozkhan/Documents/zero/aura-os/docs/release-workflows.md)

## Core Insight

We should not build a second testing system for release packaging.

Instead, we should separate:

- functional verification of Aura behavior
- packaging verification of native artifacts
- publishing verification of release delivery

The release system should reuse the existing smoke/eval surface wherever
possible, but run it against different targets:

- dev server target
- local-stack target
- packaged desktop target

## Proposed Architecture

### 1. Functional Layer

Keep the current local-stack and Playwright eval system as the source of truth
for:

- org/agent/project/spec/task flow
- automated build loop correctness
- metrics such as time, tokens, and cost

This remains the best place to answer:

- did Aura work?
- did it build correctly?
- did it regress?

### 2. Desktop Packaging Layer

Add a separate packaged-desktop validation path for:

- macOS builds
- Windows builds
- Linux builds

This layer should verify:

- the binary or installer is produced successfully
- the packaged app launches
- the embedded frontend and backend come up correctly
- key native routes work
- updater configuration is readable and functional

This should not rerun the entire local-stack benchmark inside every packaging
workflow. Instead it should run a small shared smoke subset against the packaged
desktop runtime.

### 3. Mobile Packaging Layer

Keep Fastlane as the shipping mechanism for:

- iOS TestFlight / App Store
- Android Play tracks

But align mobile validation and release conventions with the desktop release
system:

- validate on code changes
- ship on release/manual promotion
- standardize release metadata and reporting

### 4. Publishing Layer

Use:

- GitHub Releases for desktop artifacts
- `gh-pages` or equivalent static manifests for desktop auto-update metadata
- Fastlane for iOS/Android store publishing

## Guardrails

This release project must preserve current product behavior.

That means:

- no desktop runtime behavior changes unless they are required for packaging or
  update correctness
- no mobile runtime behavior changes unless they are required for packaging or
  store delivery
- any CI-only or packaging-only behavior must be behind explicit environment or
  launch flags

## Verification Strategy

### Shared Verification

Create one shared smoke surface that can run against multiple targets:

- browser/dev target
- local-stack target
- packaged desktop target

The shared smoke should verify:

- app launch
- login or host readiness state
- projects/agents shell rendering
- update status route on desktop
- key API responsiveness

### Packaged Desktop Verification

To make packaged desktop verification reliable, add a small CI mode to the
desktop app:

- configurable fixed port for the embedded server
- explicit readiness signal
- optional hidden or CI launch mode

This makes packaged validation straightforward:

1. build the artifact
2. launch the packaged app in CI mode
3. wait for readiness
4. run shared smoke checks against the local URL
5. shut down cleanly

### Release Verification

Release workflows should also verify:

- release artifact naming
- signatures and checksum presence
- update manifest correctness
- GitHub Release asset upload success

## Known Gaps To Address

1. Installer-level smoke verification is still lighter than raw binary smoke
   verification.
2. Desktop release workflows currently duplicate frontend build work in some
   edge cases outside the prebuilt frontend path.
3. There is no dedicated PR packaging validation workflow for desktop.
4. Mobile and desktop release outputs are not yet presented as one coherent
   release system.

## Implementation Phases

### Phase 1: Desktop Release Hardening

- audit and simplify existing nightly/stable workflows
- remove duplicated build work where possible
- make update base URL configurable
- standardize artifact naming and manifest generation

### Phase 2: Packaged Desktop Validation

- add desktop CI mode
- add a new workflow for packaged desktop validation on PRs
- run shared smoke checks against packaged app launches on native runners

### Phase 3: Release Unification

- align nightly and stable desktop release behavior
- add clearer release summaries and artifact reporting
- make it obvious which artifacts belong to which channel and platform

### Phase 4: Mobile Release Alignment

- keep Fastlane for mobile release delivery
- standardize release metadata expectations
- align validation and promotion flow with desktop release conventions

### Phase 5: Extended Confidence

- optionally connect packaged-desktop checks with the local-stack eval system
- optionally add installer-level verification where practical
- optionally add auto-update canary verification

## Recommended Immediate Next Step

Start with desktop release hardening and packaged desktop validation.

That gives the highest leverage because:

- the repo already contains most of the desktop release foundation
- it lowers risk on every push to `main`
- it creates the reusable pattern we can later mirror across mobile

## Success Criteria

We should consider this project successful when:

- every push to `main` can reliably produce desktop nightly artifacts
- stable desktop releases can be cut cleanly from tags or manual dispatch
- packaged desktop artifacts are automatically smoke-tested before release
- updater manifests are valid and signed correctly
- mobile release validation and shipping remain intact
- the release system adds confidence without changing the normal product flows
