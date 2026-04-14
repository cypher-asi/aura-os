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
[desktop-validate.yml](../.github/workflows/desktop-validate.yml)

Purpose:

- build release desktop binaries on Linux, macOS arm64, macOS x64, and Windows
- launch the built desktop app in CI mode
- verify the embedded local server comes up
- verify the desktop update-status route responds
- package signed desktop artifacts too when the signing secrets are available

This is a validation workflow, not a publishing workflow.

It is intended to run on:

- pull requests that affect desktop/interface/release files
- selected pushes, including ongoing work on the release-build branch
- manual dispatch when needed

### `Release Nightly`

Workflow:
[release-nightly.yml](../.github/workflows/release-nightly.yml)

Purpose:

- build native desktop artifacts from `main`
- publish a rolling nightly GitHub Release
- generate nightly update manifests from updater-friendly bundles
- publish release summaries and checksums

This is the automatic desktop distribution path for `main`.

### `Release Stable`

Workflow:
[release-stable.yml](../.github/workflows/release-stable.yml)

Purpose:

- build native desktop artifacts for a tagged or manually requested version
- publish a stable GitHub Release
- generate stable update manifests from updater-friendly bundles
- publish release summaries and checksums

This is the canonical stable desktop shipping path.

## Mobile

### `Android Mobile`

Workflow:
[android-mobile.yml](../.github/workflows/android-mobile.yml)

Purpose:

- validate Android shell builds on code changes
- ship Android builds through Fastlane on manual dispatch

Validation and shipping are intentionally separated:

- automatic validation on relevant changes
- manual promotion to Play tracks

### `iOS Mobile`

Workflow:
[ios-mobile.yml](../.github/workflows/ios-mobile.yml)

Purpose:

- validate iOS shell builds on code changes
- ship iOS builds through Fastlane on manual dispatch

Validation and shipping are intentionally separated:

- automatic validation on relevant changes
- manual promotion to TestFlight / App Store

## Functional Verification

The release system does not replace the functional eval system.

Functional verification remains here:

- [aura-evals.yml](../.github/workflows/aura-evals.yml)
- [local-stack README](../infra/evals/local-stack/README.md)

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

## Local Update Smoke

There is now a dedicated local script for exercising the packaged macOS updater
path with a real signed `.app.tar.gz` bundle and the same per-channel manifest
shape that `gh-pages` publishes:

- `aura-os-desktop-release-flow/infra/scripts/release/desktop-local-auto-update-smoke.mjs` in the sibling release-flow repo

It is intended for validating the "can the packaged desktop app discover,
download, and install the published update bundle?" question that the lighter CI
smoke does not fully answer.

Expected inputs:

- an installed `.app` bundle for the older desktop version
- a signed newer `.app.tar.gz` updater bundle
- the matching `.sig` file for that updater bundle
- the expected target version

The script spins up a local manifest server, launches the packaged app with a
local updater base URL override, triggers an immediate re-check through the
desktop API, and waits for the bundle version on disk to change to the target
version.

## Mobile Release Reporting

Android and iOS workflows now emit lightweight release summaries and upload any
discovered build artifacts in addition to their normal validation or Fastlane
steps. This keeps the shipping path the same while making it easier to inspect
what each run produced.

Desktop nightly and stable publish jobs also validate generated updater
manifests before pushing them to `gh-pages`, so broken channel metadata is less
likely to slip through unnoticed.

`Release Nightly` now supports manual validation runs through
`workflow_dispatch`. Those runs build and package the nightly artifacts and
generate preview manifests by default, but they only publish the GitHub release
and `gh-pages` manifests if `publish_live` is explicitly enabled.

Pushes to `codex/release-build-system` also run the nightly workflow in preview
mode. That gives us a branch-safe way to validate the matrix build, packaging,
artifact summaries, and manifest generation without publishing the shared
nightly release or updating `gh-pages`.

The desktop workflows currently target Apple Silicon with `macos-latest` and
Intel with `macos-15-intel`, which matches GitHub's current standard
GitHub-hosted macOS runner labels for arm64 and x64 builds.

The desktop runtime now treats update checks as a background concern:

- startup does not block on the update endpoint
- the app polls for updates after launch on a background task
- when a verified update is found, Aura marks it as available and waits for the
  user to approve installation
- the selected update channel is persisted locally so stable/nightly does not
  reset on restart
- the update manifests therefore need to point at updater-compatible payloads
  such as `.app.tar.gz`, `.AppImage`, and NSIS installers rather than only the
  user-facing installer formats
