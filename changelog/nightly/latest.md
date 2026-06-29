# Readable agent nameplates and a Brave News results fix

- Date: `2026-06-29`
- Channel: `nightly`
- Version: `0.1.0-nightly.714.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.714.1

Today's nightly pairs a small but visible polish on the 3D agent profile card with a real bug fix for workspace Brave News searches, which had been silently returning no results on the live server path.

## 8:12 AM — Agent profile card nameplate no longer collides with long names

The 3D agent card's nameplate was redrawn so the role sits on its own line beneath the name instead of as a right-aligned pill that overlapped longer names.

- On the 3D agent profile card, the name now occupies the top line and the role renders as a left-aligned pill on a second line within the same nameplate strip, eliminating the overlap that occurred when an agent's name was long. Name and role type sizes and the pill geometry were retuned to fit the stacked layout. (`c8a6f9b`)

## 10:49 AM — Workspace Brave News searches return results again

The server-side trusted-integration executor was looking for Brave News results under the wrong JSON path, so news queries silently came back empty; it now reads from the correct top-level array.

- Brave's News Search API returns its hits at the top-level `results` array (no `news` wrapper), but the live trusted-integration executor was pointing at `/news/results` and getting nothing back. The transform now uses a vertical-aware pointer — `/results` for news, `/{vertical}/results` for web — so workspace Brave news searches return real results while web search behavior is unchanged. (`dcaad51`)
- Added regression tests covering both the nested `web.results` path and the top-level `results` path for news, locking in the fix against future drift. (`dcaad51`)

## Highlights

- Agent profile cards no longer overlap long names
- Brave News searches now actually return results

