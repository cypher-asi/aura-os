# Release Workflows

This document describes the current release-oriented workflows and their role in
the overall build system.

## Principle

Release workflows should add confidence and distribution capability without
changing normal runtime behavior.

That means:

- validation workflows should only verify artifacts and launch behavior
- publishing workflows should only ship already-validated artifacts
- mobile store delivery should remain in Fastlane
- desktop updater delivery should remain in GitHub Releases plus manifest
  publishing

## Desktop

### `Desktop Validate`

Workflow:
[desktop-validate.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/desktop-validate.yml)

Purpose:

- build release desktop binaries on Linux, macOS arm64, macOS x64, and Windows
- launch the built desktop app in CI mode
- verify the embedded local server comes up
- verify the desktop update-status route responds
- package signed desktop artifacts too when the signing secrets are available

This is a validation workflow, not a publishing workflow.

It is intended to run on:

- pull requests that affect desktop/frontend/release files
- selected pushes, including ongoing work on the release-build branch
- manual dispatch when needed

### `Release Nightly`

Workflow:
[release-nightly.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/release-nightly.yml)

Purpose:

- build native desktop artifacts from `main`
- publish a rolling nightly GitHub Release
- generate nightly update manifests
- publish release summaries and checksums

This is the automatic desktop distribution path for `main`.

### `Release Stable`

Workflow:
[release-stable.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/release-stable.yml)

Purpose:

- build native desktop artifacts for a tagged or manually requested version
- publish a stable GitHub Release
- generate stable update manifests
- publish release summaries and checksums

This is the canonical stable desktop shipping path.

## Mobile

### `Android Mobile`

Workflow:
[android-mobile.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/android-mobile.yml)

Purpose:

- validate Android shell builds on code changes
- ship Android builds through Fastlane on manual dispatch

Validation and shipping are intentionally separated:

- automatic validation on relevant changes
- manual promotion to Play tracks

### `iOS Mobile`

Workflow:
[ios-mobile.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/ios-mobile.yml)

Purpose:

- validate iOS shell builds on code changes
- ship iOS builds through Fastlane on manual dispatch

Validation and shipping are intentionally separated:

- automatic validation on relevant changes
- manual promotion to TestFlight / App Store

## Functional Verification

The release system does not replace the functional eval system.

Functional verification remains here:

- [aura-evals.yml](/Users/shahrozkhan/Documents/zero/aura-os/.github/workflows/aura-evals.yml)
- [evals/local-stack/README.md](/Users/shahrozkhan/Documents/zero/aura-os/evals/local-stack/README.md)

That system answers:

- did Aura still work?
- did the build loop still succeed?
- how long did it take?
- how many tokens and how much cost were used?

The release system answers a different question:

- can we build, package, launch, and ship the app artifacts safely?

## Current Recommended Flow

1. Pull request:
   - run functional evals where appropriate
   - run `Desktop Validate` for desktop changes
   - run mobile validation workflows for mobile shell changes
2. Push to `main`:
   - allow nightly desktop releases to build and publish
   - keep mobile validation automatic, but do not auto-ship to stores
3. Stable release:
   - cut a version tag or manual stable run
   - publish desktop stable artifacts
   - manually promote mobile builds through Fastlane lanes

## Known Future Work

- installer-level smoke verification for packaged desktop artifacts
- clearer release dashboards or consolidated summaries across desktop and mobile
