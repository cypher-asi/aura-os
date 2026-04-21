# Demo Screenshot Pipeline

Aura now has an agent-first screenshot pipeline for changelog media.

The default changelog path is no longer "write a Playwright scenario for every
feature." Instead, the pipeline:

1. reads a story prompt or changelog entry
2. combines the changelog, changed files, and source-derived app metadata to
   infer the most likely proof screen
3. boots a trusted seeded demo session with fake but visually correct data
4. decides whether to reuse the baseline seeded world, create live in the UI,
   or preseed one entity for a stable proof state
5. lets a browser agent navigate and attempt the feature flow
6. scores the captured frame for proof quality, placeholder/empty-state risk,
   desktop-layout correctness, and composition
7. applies one bounded correction pass when the first proof frame is weak
8. reuses the `validate-proof` frame and skips the optional `capture-proof`
   phase when the validated frame is already production quality
9. applies a small deterministic repair pass when the agent gets close but
   misses an obvious labeled action
10. captures framed screenshots from the resulting proof state
11. disables direct agent `goto` navigation by default so the proof is reached
   through visible UI, not hidden route jumps
12. scopes Stagehand replay cache to the current run by default so one story
   does not silently inherit another story's cached path

This keeps the maintenance burden low while still giving us a reliable last
mile for changelog media.

The seeded demo lane still matters, but it now acts as the data/control plane
under the agent instead of being the only capture path.

The important shift is that the planner no longer depends on a fixed
"feature capability registry." It inspects:

- the inferred target app from the brief
- changed-file evidence and source labels like `data-agent-*`, routes, and
  `aria-label`s
- the baseline seeded entities already present in the demo world

That means a new changelog feature can usually ride the same generic path
without someone first authoring a matching scenario entry.

The runner now also records a per-phase quality report, so a phase is not
treated as successful just because the agent stopped somewhere plausible. The
frame also needs to avoid:

- placeholder routes
- obvious empty states
- mobile-only layouts
- visible runtime error surfaces
- weak, loose full-page compositions

## Commands

```bash
cd interface
npm run demo:screenshots:agent -- \
  --prompt "Open the Feedback app, create a new idea about a feedback inbox, and leave the created idea visible."
```

Changelog-driven orchestration:

```bash
cd interface
npm run demo:screenshots:agent -- \
  --changelog https://cypher-asi.github.io/aura-os/changelog/nightly/latest.md \
  --base-url https://your-preview-host.example.com \
  --provider browserbase
```

Useful flags:

- `--list`
- `--profile agent-shell-explorer`
- `--base-url http://127.0.0.1:5173`
- `--provider local`
- `--provider browserbase`
- `--stagehand-cache-mode run`
- `--stagehand-cache-mode persistent`
- `--allow-agent-goto`
- `--changelog https://cypher-asi.github.io/aura-os/changelog/nightly/latest.md`
- `--channel nightly`
- `--prompt "Show the feedback board and leave the created idea visible"`

The reliability defaults are:

- Stagehand cache mode: `run`
- Agent `goto` tool: disabled

That means runs do not share replayed navigation across stories unless you
explicitly opt into `--stagehand-cache-mode persistent`, and the agent is
expected to move through the app using the same visible controls a user would.

## Current Modes

The current primary profile is:

- `agent-shell-explorer`

It provides:

- a seeded desktop shell
- app launcher metadata via `data-agent-*` attributes
- deterministic fake API responses for feedback, notes, org, and project data
- enough structure for an agent to discover the right app and leave a useful
  proof screen behind

The older deterministic profile still exists:

- `feedback-thread-proof`

That remains useful as a fallback or for very controlled before/after shots.

## Why No Real Auth

For changelog captures, auth is not the product story we want to show.
So the runner does not log in through the UI and does not require a real user
account.

Instead it uses the same auth primitives the app already trusts at boot:

- `window.__AURA_BOOT_AUTH__`
- `aura-session`
- `aura-jwt`
- `aura-idb:auth:session`

That means the page loads directly into the shell with a fake but trusted demo
session.

The runner also injects a runtime screenshot bridge flag before app code loads,
so seeded profiles can run against local dev or a hosted preview without
depending on a dev-only build.

## How Fake Data Works

The first version keeps seed data in the runner itself and intercepts `/api/*`
requests with deterministic responses.

That means the data does not need to be production-valid. It only needs to be
visually correct enough to tell the feature story.

Profiles can use three kinds of steps:

- `assertions`: conditions that must already be true before the step runs
- `actions`: deterministic interactions such as `click`, `fill`, or `script`
- `assertionsAfter`: conditions that must become true after the step runs

And screenshots can target one or more named UI regions with optional padding,
so changelog assets can focus on the meaningful pane instead of grabbing the
entire desktop shell every time.

This is the recommended CI path for changelog media:

1. detect a feature-worthy change
2. generate a short story brief
3. run the agent against a seeded preview in Browserbase
4. repair any obvious last-mile action using labeled UI hooks
5. publish the resulting screenshots or composed video

The release changelog flow now supports a placeholder-based handoff:

1. `publish-release-changelog.yml` writes hidden `AURA_CHANGELOG_MEDIA` slot markers
   into markdown only for entries that look visually demonstrable
2. `publish-release-changelog-media.yml` runs later, finds those pending slots,
   captures proof screenshots, copies them into `gh-pages/assets/changelog/...`,
   and replaces the slot marker body with the final image markdown
3. if capture fails, the changelog text still publishes and the slot remains
   pending for a rerun instead of blocking release notes

The repo now includes a dedicated workflow for that orchestration:

- `.github/workflows/publish-release-changelog-media.yml`

It fetches the changelog, asks Anthropic to pick the best seeded profile,
builds an app-aware capture brief, derives a seed/setup plan from source plus
baseline demo data, runs the agent in Browserbase, and uploads or publishes the
resulting screenshots.

For CI you should set:

- `ANTHROPIC_API_KEY`
- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- repository variable `AURA_DEMO_SCREENSHOT_BASE_URL` for the preview or live
  app URL that Browserbase should open during changelog media capture
- optional repository variable `AURA_CHANGELOG_MEDIA_DEPLOY_WAIT_MINUTES`
  to delay media capture after changelog publish while the deployed frontend
  catches up; defaults to `5`

The media workflow now intentionally waits before opening the deployed app.
That reduces the race where changelog media runs against a still-old frontend
bundle even though the changelog itself has already published.

For manual reruns you can override that delay with the workflow-dispatch input:

- `deploy_wait_minutes`

## Browserbase

If `BROWSERBASE_API_KEY` is set, the runner creates a Browserbase session and
connects through Playwright over CDP. Otherwise it runs locally.

Example hosted run:

```bash
cd interface
AURA_DEMO_SCREENSHOT_BASE_URL=https://your-preview-host.example.com \
BROWSERBASE_API_KEY=... \
BROWSERBASE_PROJECT_ID=... \
npm run demo:screenshots:capture -- --profile feedback-thread-proof --provider browserbase
```

If your Browserbase plan supports it, you can opt into advanced stealth for
the agent-first runner without changing code:

```bash
AURA_DEMO_BROWSERBASE_ADVANCED_STEALTH=1 npm run demo:screenshots:agent -- ...
```

The output manifest includes:

- mode
- auth mode
- data mode
- provider
- Browserbase session id
- Browserbase inspector URL
- screenshot paths
