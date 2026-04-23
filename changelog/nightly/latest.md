# Nightly release pipeline gets a safety net

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.352.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.352.1

Today was a focused release-infrastructure day. The nightly pipeline picked up retry-aware asset pruning, a dedicated workflow to keep dated changelog history in sync with the latest entry, and a manual recovery path for republishing GitHub Pages when things go sideways.

## 9:17 AM — Hardened nightly pruning and changelog history sync

The nightly release workflow moved pruning into a dedicated retry-aware script, gained a new job that mirrors changelog media into dated history entries, and added a manual gh-pages republish path for recovery.

- Nightly asset pruning was extracted into a reusable script with retries and graceful handling of assets that have already disappeared (HTTP 404), so transient GitHub API hiccups no longer fail the release job. (`a7eb25a`, `ac61ac3`)
- A new Sync Release Changelog Media History workflow runs after each changelog publish to copy media into the matching dated history entry on gh-pages, and the publish script now resolves the latest release to its dated history mirror so updates land in both places. (`a7eb25a`, `d81834c`)
- Added a manually triggered Republish GitHub Pages workflow, backed by an allow-empty commit mode in the gh-pages push helper, giving operators a clean way to force a Pages rebuild with an optional reason note. (`ca9eaa8`)

## Highlights

- Retry-aware nightly asset pruning tolerates vanished assets
- Dated changelog history now mirrors the latest release automatically
- New one-click workflow to republish GitHub Pages for recovery

