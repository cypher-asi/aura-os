# Changelog pipeline slimmed down and gains historical backfills

- Date: `2026-07-13`
- Channel: `nightly`
- Version: `0.1.0-nightly.760.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.760.1

Today's nightly is a release-infrastructure day focused on the changelog pipeline itself: operators can now safely replay historical dates through the current generator, and a large unused media-publishing workflow was retired to simplify the release path.

## 4:04 PM — Historical changelog backfills and media CI retirement

The release changelog workflow gained a validated date override for replaying past days and dropped a large unused media-publishing pipeline, tightening the path from commit to published changelog.

- Operators can now pass a validated YYYY-MM-DD override to the Publish Release Changelog workflow to replay historical days without misdating entries, with strict rejection of malformed or impossible dates like 2026-02-30. (`be35543`)
- Backfill runs now invoke the generator from the current workflow checkout instead of the target repo checkout, so historical replays always use the latest changelog logic rather than whatever generator existed on that date. (`07e3f52`)
- Retired the automated changelog media CI, removing 327 lines across the media publish, changelog publish, and reconcile workflows to simplify the release pipeline. (`5b11528`)

## Highlights

- Manual date override unlocks historical changelog backfills
- Backfills now run through the current generator, not a stale checkout
- Retired ~327 lines of unused changelog media CI

