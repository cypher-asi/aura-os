# Hardening the nightly release pipeline and changelog media

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.354.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.354.1

Today was a release-infrastructure day. The nightly pipeline picked up a more resilient asset-prune path, a new gh-pages recovery workflow, and a history-aware sync job, while the branded changelog media renderer was reworked to let real product screenshots dominate the frame without being clipped.

## 9:17 AM — Resilient nightly prune and changelog history sync

The nightly release workflow was refactored around reusable, retry-aware scripts, and a new job keeps dated history entries in sync with the latest changelog media.

- Moved nightly release-asset pruning into a dedicated retry-aware script and taught it to shrug off assets that have already disappeared (HTTP 404) instead of failing the whole run. (`a7eb25a`, `ac61ac3`)
- Added a Sync Release Changelog Media History workflow that mirrors freshly published media from latest.json into the matching dated history entry on gh-pages, with a step summary reporting how many slots were updated. (`a7eb25a`, `d81834c`)
- Added a manual Republish GitHub Pages workflow and extended the gh-pages commit helper with an allow-empty mode so Pages can be forcibly re-pushed when a deploy is lost without changing content. (`ca9eaa8`)
- Taught the changelog media publisher to resolve the dated history mirror for the latest release, so history entries stay in lockstep with the most recent published media instead of drifting. (`d81834c`)
- Reworked the branded screenshot card to preserve the real screenshot's aspect ratio, let widescreen captures fill more of the canvas, add a safety inset so product edges aren't clipped by the frame, and bumped the default OpenAI image quality to high. (`2217600`, `43ac905`)

## Highlights

- Nightly asset prune now survives missing and flaky GitHub API responses
- New gh-pages republish and history-sync workflows
- Changelog media frames product screenshots at their true aspect ratio

