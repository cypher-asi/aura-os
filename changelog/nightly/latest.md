# Brave news search starts returning results again

- Date: `2026-06-29`
- Channel: `nightly`
- Version: `0.1.0-nightly.715.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.715.1

A small but high-impact day: workspace Brave news searches that had been silently coming back empty now return real headlines, backed by a corrected parser and a matching test fixture. The 3D agent profile card also got a layout fix so long agent names no longer collide with the role pill.

## 8:12 AM — Agent profile card nameplate stacks name and role

The 3D agent profile card stopped overlapping long names with the role pill by moving the role onto its own line beneath the name.

- Reworked the agent profile card nameplate so the name sits on a top line and the role renders as a left-aligned pill underneath, eliminating the collision that occurred when long agent names ran into the previously right-aligned, vertically centered role pill. (`c8a6f9b`)
- Tightened nameplate typography for the new layout — name drops from 123px to 104px and the role pill shrinks to 48px text in a slimmer 72px pill — so both lines fit cleanly within the same strip in light and dark themes. (`c8a6f9b`)

## 10:49 AM — Brave news search now reads results from the correct envelope

Workspace Brave news searches were silently returning empty because the server-side parser looked under the wrong JSON path. The trusted-integration executor now uses a vertical-aware pointer.

- Fixed a silent-empty bug in workspace Brave search: the server-side trusted-integration executor was reading news results from `/news/results`, but Brave's News API returns them at the top-level `results` array. News queries now use `/results` while web queries continue to read from `web.results`. (`dcaad51`)
- Added regression tests covering both verticals — including the previously untested news path — so the correct pointer is locked in against future envelope changes. (`dcaad51`)

## 2:40 PM — Brave provider mock realigned with the live news envelope

The integration provider mock was updated to mirror Brave's real top-level news response shape, restoring the assert_brave_actions end-to-end test.

- Updated the Brave provider mock to emit news results at the top level with an `envelope type: "news"` payload, matching the real API and the corrected parser so the assert_brave_actions integration test passes again. (`63be9a3`)

## Highlights

- Brave news search no longer returns silently empty results
- Agent profile card nameplate redesigned for long names
- Regression tests added for both Brave web and news verticals

