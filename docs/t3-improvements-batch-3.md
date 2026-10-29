# T3 improvements, batch 3

T3 reference: `pingdotgg/t3code` at
`6d450a4284852af137b2f3407fddd89eb76e7644`, refreshed October 29, 2026.
The feature branches start at Aura main `73aad900adb43fc8051bd55d31ad38c3cb94946a`.
The combined branch also retains batch 2, which is being merged first.

| Improvement | Source branch | Original implementation | T3 reference |
| --- | --- | --- | --- |
| Fit photos to their actual encoded byte budget | `codex/t3-photo-byte-budget` | `f5049d7a8` (implementation), `781e314ce` (real browser regression) | [Photo-library PNG resizing](https://github.com/pingdotgg/t3code/commit/7632c3dc7039953cc50282e1bc339e1bf11f2ffc) |
| Inspect release changes before installing | `codex/t3-update-release-notes` | `f8af86e5a` | [Release notes in update controls](https://github.com/pingdotgg/t3code/commit/b5fc7bedfe5c84d523273fc8269010e416e9cb6c) |

The photo path checks real encoded Blob sizes after every resize, with at most
four encoding attempts. Each retry shrinks pixel dimensions with headroom and
retains aspect ratio. The result uses the encoder's actual MIME type. Images at
or below the existing 1,100,000-byte budget remain unchanged. Failed or still
oversized encodes produce the existing per-file attachment notice instead of
silently uploading the oversized original. Preview URLs are allocated only
after a usable result exists. Existing upload retry and cancellation remain intact.

Both update-control layouts offer a 44px release-details link for known
versions. It targets the immutable GitHub release for the offered version;
unknown versions omit the link while retaining installation. Desktop's existing
external-window handler opens it in the user's browser. The stable and immutable
nightly publication steps now request GitHub-generated notes, appended after
the existing build/platform metadata, providing merged-PR entries and a comparison
link. The mutable nightly alias retains its existing publication behavior.
This uses the action's documented
[generate_release_notes input](https://github.com/softprops/action-gh-release/tree/v2#inputs).

Validation before batching:

- 24 photo/intake unit tests passed, including bounded failure, PNG fallback,
  unavailable canvas, empty output, and the exact byte limit.
- Real Chromium and WebKit tests created a large PNG, selected it in the mobile
  composer, and verified the uploaded JPEG bytes at a local HTTP receiver were
  within the budget. These run in the existing mobile-readiness suite.
- All 21 update-control tests passed, covering both layouts, stable/nightly/v
  prefixed versions, encoded tags, unknown versions, failures, and installation.
- Production builds and TypeScript passed. Photo files passed ESLint; UpdateControl
  retains its single pre-existing `react-refresh/only-export-components` diagnostic.
- A browser fixture rendering the real update components at 390px had no page
  overflow and measured 44px release link targets. Native devices remain untested.
- Both release workflows parsed as YAML and all 31 partial-publication/manifest
  regression tests passed. Native signing, versions, and release triggers are unchanged.

Only the combined branch gets a PR. Use a normal merge commit, retaining the
source branches and original implementation commits, for one publication cycle.
