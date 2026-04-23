# GPT-5.5 support lands alongside hardened nightly release plumbing

- Date: `2026-04-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.356.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.356.1

Today's nightly brings GPT-5.5 to the model picker with an expanded pricing table, plus a significant round of release infrastructure work that makes nightly publishes, changelog media, and GitHub Pages republishes far more resilient.

## 9:17 AM — Hardened nightly publish pipeline and changelog media polish

A focused morning pass on release infrastructure made nightly pruning retry-safe, added recovery workflows for gh-pages and changelog history, and sharpened how branded changelog screenshots are framed.

- Nightly asset pruning moved into a dedicated retrying script and now gracefully skips assets that 404 mid-delete, so transient GitHub API hiccups no longer fail a nightly release. (`a7eb25a`, `ac61ac3`)
- Added a Sync Release Changelog Media History workflow plus a manual Republish GitHub Pages workflow with allow-empty commits, giving operators a clean recovery path when Pages drifts or needs a forced redeploy. (`a7eb25a`, `ca9eaa8`)
- Published changelog media now mirrors into the correct dated history entry when the latest release has already been archived, keeping per-date history JSON and Markdown in sync with the latest doc. (`d81834c`)
- Branded screenshot cards preserve the real screenshot's aspect ratio, claim more of the canvas, add a safety inset so product edges aren't clipped, and bump OpenAI image quality to high for a cleaner changelog look. (`2217600`, `43ac905`)

## 11:43 AM — GPT-5.5 in the model picker and ZERO Pro usage reporting

Aura gained first-class GPT-5.5 support with a richer per-model pricing schedule, and the server now forwards ZERO Pro status alongside usage reports.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-gpt-5-5-in-the-model-picker-and-zero-pro-usage-reporting","slug":"gpt-5-5-in-the-model-picker-and-zero-pro-usage-reporting","alt":"GPT-5.5 in the model picker and ZERO Pro usage reporting screenshot","status":"published","assetPath":"assets/changelog/nightly/0.1.0-nightly.356.1/entry-gpt-5-5-in-the-model-picker-and-zero-pro-usage-reporting.png","screenshotSource":"openai-polish","originalScreenshotSource":"capture-proof","polishProvider":"openai","polishModel":"gpt-image-2","polishJudgeModel":"gpt-4.1-mini","polishScore":90,"updatedAt":"2026-04-23T19:40:14.822Z","storyTitle":"GPT-5.5 in the Chat Input Model Picker"} -->
![GPT-5.5 in the model picker and ZERO Pro usage reporting screenshot](../../assets/changelog/nightly/0.1.0-nightly.356.1/entry-gpt-5-5-in-the-model-picker-and-zero-pro-usage-reporting.png)
<!-- AURA_CHANGELOG_MEDIA:END entry-gpt-5-5-in-the-model-picker-and-zero-pro-usage-reporting -->

- GPT-5.5 is available from the chat input model picker, backed by a rebuilt fee schedule that tracks input, output, cache-write and cache-read rates for the full GPT-5.4/5.5 family next to existing Claude models. (`d9d82e9`)
- Usage reports sent from the dev loop now include a zero_pro_user flag sourced from the cached session, letting the network service distinguish ZERO Pro accounts when recording automaton usage. (`b2847a4`)

## Highlights

- GPT-5.5 model support with expanded OpenAI pricing
- Nightly asset pruning now retries and tolerates missing files
- New gh-pages republish and changelog history sync workflows
- Changelog media framing preserves screenshot aspect and avoids edge clipping

