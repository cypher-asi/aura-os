# Release pipeline hardening and sharper changelog media

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.354.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.354.1

Today's nightly was an infrastructure-focused day: the release pipeline picked up safer asset pruning and a gh-pages recovery path, while the auto-generated changelog media got a noticeably cleaner, better-framed look on the published site.

## 9:17 AM — Safer nightly asset prune and gh-pages recovery

The nightly release workflow moved its asset cleanup into a dedicated retry-aware script, gained a manual gh-pages republish escape hatch, and learned to sync generated changelog media into the right historical entry.

- Nightly asset pruning was extracted into a standalone retry-capable script that tolerates already-deleted assets (HTTP 404) and retries transient GitHub API failures, so a flaky prune step no longer fails the release. (`a7eb25a`, `ac61ac3`)
- Added a new Sync Release Changelog Media History workflow that reconciles latest changelog media into dated gh-pages history files after publish, reconcile, and media-publish runs complete successfully. (`a7eb25a`, `d81834c`)
- Introduced a manual Republish GitHub Pages workflow with an optional reason input, backed by a gh-pages commit helper that can now create an allow-empty commit to force a fresh Pages deploy when content has not changed. (`ca9eaa8`)
- When publishing media for the latest release, the script now prefers the dated history mirror (e.g. 2026-04-22.json) over latest.json so history entries stay in sync with the canonical published record. (`d81834c`)
- Reworked the branded changelog screenshot card: it now preserves the screenshot's real aspect ratio instead of forcing 16:9, lets widescreen captures dominate the canvas, keeps a safety inset so product edges aren't clipped by the frame, and pushes background energy toward the edges with a darker, quieter central field and higher default image quality. (`2217600`, `43ac905`)

## Highlights

- Nightly asset prune now retries and tolerates vanished assets
- New manual gh-pages republish recovery workflow
- Changelog media respects screenshot aspect ratio with safer framing
- Media updates now mirror into dated history entries

