# Changelog Media Browser Use Plan

This is the operating plan for the clean changelog media pipeline. Keep this file updated when the implementation changes so the direction survives context compaction.

## Non-Negotiables

- Do not rebuild the old Browserbase pipeline.
- Do not use Playwright, Stagehand, or handcrafted scenario packs for changelog media capture.
- Do not add feature-specific screenshot scripts when a new product feature ships.
- Do not publish broken, placeholder, stale, mobile, blurry, cropped, zoomed, or generated-looking product media.
- Desktop web screenshots only for this phase. Mobile commits can still appear in the changelog, but they do not get media.

## Target Flow

1. The release changelog is generated first from commits and artifacts.
2. A generated Aura sitemap is created from the current codebase.
3. Anthropic receives the changelog entries, commit/file context, and sitemap, then writes a media plan.
4. The media plan filters out non-visual work before Browser Use is called.
5. Browser Use Cloud runs only for shortlisted desktop visual candidates, using an Opus-tier model.
6. Browser Use authenticates through the safe capture-login path and navigates using sitemap hints.
7. The screenshot is accepted only if it is real desktop Aura UI, relevant, non-empty, non-mobile, and crisp enough to publish.
8. Successful media can be attached to the changelog. Failed or skipped media must not break the changelog or show broken images.

## Inference Responsibilities

- Anthropic is responsible for deciding whether a changelog entry deserves media.
- The generated sitemap is responsible for explaining where product surfaces live.
- Browser Use is responsible for navigating and capturing, not for classifying every changelog bullet.
- The quality gate is responsible for preventing weak captures from reaching GitHub Pages.

## Browser Use Rules

- Use Browser Use Cloud, not Browserbase.
- Use Browser Use Agent with `claude-opus-4.6` by default.
- Use structured output for capture decisions.
- Use `sensitiveData` for capture auth secrets.
- Bound Browser Use runs with an explicit timeout and cost cap. The SDK default can wait for hours, which is not acceptable for release CI.
- Do not crop, zoom, stylize, or re-render the product screenshot.
- Preserve native Browser Use screenshot pixels.

## Quality Policy

- The product screenshot is the proof. It must remain real Aura UI at native scale.
- Branding is a deterministic SVG presentation card around the screenshot, not a generated replacement for the UI.
- Generated imagery must not rewrite product text, invent UI, hide proof, or compensate for a weak capture.
- Long titles and subtitles must wrap inside bounded layout regions before media can publish.
- A branded asset must pass structural layout checks before it is considered publish-ready.
- The final branded PNG must pass the same independent vision gate as the raw screenshot before it can publish.
- If CI only knows the public frontend URL, the evaluator should resolve the API origin from explicit env first, then from the deployed frontend bundle, before falling back to the frontend origin.

## Implemented Safeguards

- Planner calls are chunked so large changelogs are classified completely instead of dropping entries from an oversized prompt.
- Omitted entries get a focused rescue pass; if still omitted, they are safely skipped and recorded instead of being sent to Browser Use.
- Candidate caps preserve coverage by moving lower-priority media candidates into explicit skipped records.
- Browser Use runs only after Anthropic classifies an entry as desktop, visual, sitemap-backed, and worth a screenshot.
- Raw screenshots, branded media cards, and final branded PNG previews all have separate quality gates.

## What To Improve Next

- Expand generated sitemap coverage by adding stable `data-agent-*` proof handles to real product surfaces.
- Investigate Browser Use-native high-resolution final screenshot capture without falling back to Playwright.
- Wire publish/backfill only after the Browser Use path keeps passing broad inference audits and live UI/UX quality review.
