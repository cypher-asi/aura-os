# Accurate push counts and tougher demo screenshot tooling

- Date: `2026-04-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.333.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.333.1

A quiet nightly with two focused changes: activity feed push cards now report the right commit count on older posts, and the internal tooling that captures changelog demo screenshots got substantially more resilient to messy agent output.

## 1:13 AM — Push cards fall back to commit IDs for legacy feed posts

Activity feed push cards now display a correct commit count even when older posts lack the richer commits metadata.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-push-cards-fall-back-to-commit-ids-for-legacy-feed-posts","slug":"push-cards-fall-back-to-commit-ids-for-legacy-feed-posts","alt":"Push cards fall back to commit IDs for legacy feed posts screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-push-cards-fall-back-to-commit-ids-for-legacy-feed-posts -->

- PushCardBody in the activity feed now uses commitIds.length as a fallback when metadata.commits is missing, so older push posts display the real number of commits instead of '0 commits'. A store-level test covers the partial-metadata case. (`070248d`)

## 8:53 AM — Hardened JSON parsing in changelog demo screenshot pipeline

The internal script that captures agent demo screenshots for changelog media now survives smart quotes, fenced code blocks, trailing commas, and other imperfect model output.

- demo-agent-brief now normalizes curly quotes and BOMs, extracts balanced JSON blocks, strips trailing commas, and falls back to loose per-field extraction (strings, nullable strings, booleans) when strict JSON.parse fails — making agent-brief ingestion far more tolerant of real LLM output. (`eb42a29`)
- Screenshot quality checks, the demo seed planner, and the produce-agent-demo-screenshots runner all received substantial hardening and expanded test coverage, tightening the end-to-end reliability of generating changelog media proofs. (`eb42a29`)

## Highlights

- Push activity cards no longer show 0 commits on legacy posts
- Demo screenshot capture tolerates malformed JSON from agent briefs

