# Session cost insights, smarter model picker, and a self-healing public demo

- Date: `2026-05-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.574.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.574.1

Today's nightly leans heavily on the chat surface: a brand-new Session Cost breakdown lands in the context popover, the model picker gains provider grouping, credit multipliers, and per-model reasoning effort, and the public demo chat is rebuilt to survive token rotations and run without a harness. Marketing pages got animated stats and live mobile mockups, while CI picked up resilience against flaky DNS on self-hosted runners.

## 9:27 PM — Public chat self-healing and model picker foundations

Late-night work hardened the public chat surface, added the first credit-multiplier and reasoning-effort controls to the model picker, and polished marketing visuals.

- Public chat now silently re-mints guest tokens after a 401, so visitors stuck behind a rotated GUEST_JWT_SECRET no longer see a permanently broken desktop or mobile demo — the failed turn is retried once with a fresh token via a new isGuestAuthError predicate. (`72f8ed3`)
- The chat model picker gained a credit-multiplier badge per model plus a hover flyout to choose a reasoning effort (Low/Medium/High/XHigh/Max), persisted per model and forwarded as reasoning_effort on the stream request. (`b135e7a`)
- The /product page replaces empty PhoneShell placeholders with three looping mobile chat mockups, each showing a different AURA agent typing replies and streaming tool cards — reusing the landing hero's typewriter and terminal-stream primitives. (`4f9d48d`)
- Projects dev runs now tick task checkmarks live: useProjectLayoutData subscribes to task_updated edges so the Tasks tab reflects completion on its next mount regardless of which sidekick tab was active during the run. (`567338e`)
- Smaller chat and marketing polish: the public chat transcript fills the full height and flows under the floating input bar, the overlay scrollbar thumb is now a rounded pill that widens on hover, the public sidebar nav slides between center and bottom, and the marketing hero video's bottom fade no longer leaves a hard cut. (`91af433`, `0a51c5b`, `5ad826b`, `05a3554`)

## 10:32 PM — Executor agents stop piling up in the projects sidebar

A storage-independent ledger keeps ephemeral dev/automation Executor agents from leaking into the sidebar across server restarts.

- Each ad-hoc dev run's ephemeral Executor instance is now tracked in a SettingsStore-backed ledger and purged by ID, so when aura-storage strips the instance_role/source columns the sidebar filter and janitor still find and reclaim the orphans — eliminating the duplicate 'Summarize This Me' rows that survived a dev server restart mid-run. (`c895064`)

## 10:32 AM — Smoother loading states for generated media

The image/video placeholder feels actively working, and generated chat images now reveal as a finished frame instead of painting in line-by-line.

- The media generation placeholder swaps its static panning dot grid for a canvas where dots pulse in ripple waves, while still respecting prefers-reduced-motion with a single static frame and guarding getContext for jsdom. (`c5b5017`)
- Generated chat images now wait on img.decode() inside a new GeneratedImageFrame with a reserved square box, so they fade in fully rendered instead of growing downward as the bitmap downloads. (`64a35d8`)

## 11:05 AM — Self-hosted CI runners survive transient DNS blips

A local setup-node composite wraps the upstream action with retries to stop flaky DNS from failing builds, with a targeted carve-out for jobs that check out into subdirectories.

- All first-party workflows now route through a new .github/actions/setup-node composite that polls api.github.com and nodejs.org with backoff before installing, so a transient 'getaddrinfo ENOTFOUND' on self-hosted runners no longer fails build-sidecar on the first attempt — and it centralizes the pinned Node version across Android, iOS, desktop, evals, and release workflows. (`4e4d177`)
- The publish-manifests and changelog jobs that check out into subdirectories revert to actions/setup-node@v5, since the local composite can't be resolved from a non-root workspace and those GitHub-hosted runners never had the DNS issue. (`36fc5ac`)

## 11:24 AM — Session Cost, grouped model picker, and a router-backed public demo

A long afternoon thread reshaped chat economics and model selection while finally moving public demo chat onto aura-router and fixing cross-org session navigation.

- A new Session Cost section beneath Context Composition in the bottom-bar popover shows the model, cumulative input/output/cache tokens, a weighted Avg. Cost per Token with a per-type rate overlay, and total billed cost in dollars — using base provider rates plus aura-router's 20% markup so figures match what is actually debited. A follow-up reconciles the Tokens Consumed total with cache reads/writes and lowers the streaming indicator so it stops painting over the popover. (`f697368`, `cfb232a`, `2e446c4`)
- The chat model picker is now organized into collapsible Anthropic / OpenAI / Open Source sections (surfacing Kimi K2.6 and Haiku 4.5), with a custom-scrolled menu that locks natural width, model details — name, cost multiple, context window — in a hover submenu, and the selected thinking tier shown in the trigger label (e.g. 'Opus 4.8 XHigh'). (`e54c97e`, `22d102c`, `0c1fe62`, `8b535cc`)
- Reasoning effort is now a real wire contract: SendChatRequest / SessionConfig / ModelSelection carry a typed ReasoningEffort enum (minimal/low/medium/high/max, with lenient parsing of legacy 'xhigh'), and the effort folds into the ChatSessionKey so changing the thinking level cold-opens a session rather than reusing the prior loop config. (`22d102c`, `d0aa429`)
- Anthropic per-token rates are realigned to the pricing page (Opus 4.7 → $5/$25, Haiku 4.5 → $1/$5), and every chat model's credit multiplier is rebased on output $/MTok anchored at Haiku 4.5 = 1x, with the effort-scaled multiplier surfaced next to each tier in the picker flyout. (`a0f8c6a`, `8b535cc`)
- GPT Image models pick up a low/medium/high/auto quality dropdown threaded from the chat UI through aura-os-server to aura-router; the default drops from always-high to medium for faster generations, the pick persists per agent and globally, and the model/quality dropdowns are now mutually exclusive in image mode. (`1d7d864`, `db26a43`)
- The public demo chat is fully rebuilt: it now proxies directly to aura-router's /v1/messages — translating Anthropic content_block_delta frames into the SSE events the frontend expects — so the single-process Render deployment behind aura.ai no longer fails with 'public demo agent failed to start a session'. A separate fix also pins PUBLIC_DEMO_MODEL on the session config so turns stop erroring out with 'model name must not be empty'. (`5687850`, `cb59c9f`)
- Chat history navigation now opens cross-agent sessions by the row's server-stamped _agentId instead of resolving through the org-scoped agents list, so sessions owned by out-of-org agents (post migration 0015) stop 404-ing as 'session not found' and stop falling back to the CEO chat agent. (`59d528a`)
- Settings get a personal 'You' section (avatar, name, bio, website, location, inline-editable) as the default first entry in both the modal and routed settings page, with the Team group moved above App and Appearance renamed to Theme. (`a043143`)
- Marketing pages get animated summary banners: the Feedback page gains submitted/resolved/participant totals, the /models page gets a hot-pink gradient banner with five animated catalog metrics, the changelog stats count up reliably on every visit (including small integers and revisits), and the public sidebar pill now slides on pointer-down instead of waiting for route commit. (`e60b3dc`, `688cc66`, `38e526d`, `456c843`, `8ae820c`, `5aad710`)
- Chat composer cleanups: the browser's 'Saved info' autofill popup is suppressed on both the public chat input and the shared InputBarShell textarea, public chat bubbles drop their border, and the cold-start 'Starting chat…' hint is removed. (`d3adb7d`, `a709f7b`, `93e7761`)
- The /product hero headline updates to 'Your Private Agent.' and the typewriter test is updated to match. (`1fdc7dc`)

## 2:46 PM — Public /models page renders from bundled catalog

The marketing models page no longer silently empties when aura-network is unset.

- /models is now driven by the same AVAILABLE_MODELS constants the rest of the app ships with via a new buildMarketingModelEntries() builder, replacing the /api/public/models fetch that silently degraded to an empty list in public mode. (`cdcc01f`)

## Highlights

- Session Cost panel in the Context popover
- Model picker: provider groups, credit multipliers, and per-model reasoning effort
- Public demo chat now self-heals and runs without a harness
- Selectable image quality for GPT Image models
- Marketing /product page gains live mobile chat mockups

