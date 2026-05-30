# Model picker gets a thinking dial, Session Cost lands in chat

- Date: `2026-05-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.573.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.573.1

A heavy day for the chat surface: the model picker grew vendor-grouped sections, per-model reasoning effort tiers wired end-to-end into the harness, and a new Session Cost readout that shows exactly what each turn is billing. Marketing pages picked up live mobile chat mockups and animated summary banners, public chat self-heals after token rotations, and CI shrugs off transient DNS flakes on the self-hosted runners.

## 9:27 PM — Public chat resilience, model picker effort tiers, and /product mobile mockups

A late-night batch shipped guest-token self-healing on public chat, the first cut of per-model reasoning effort in the picker, and live mobile chat mockups on the marketing product page, alongside scrollbar and transcript polish.

- Public chat now self-heals after a guest-token rotation: a 401 or "guest token" error triggers a silent re-mint and one retry across PublicChatView, MobilePublicChatView, and the dispatch-media boundary, unsticking visitors whose cached tokens were signed against an old GUEST_JWT_SECRET. (`72f8ed3`)
- Model picker gained credit-multiplier badges and a hover flyout for picking reasoning effort (Low/Medium/High/XHigh/Max) per supported model, with the choice persisted and forwarded as reasoning_effort on the chat stream. (`b135e7a`)
- The /product Agent section now hosts three looping mobile chat mockups inside its PhoneShells, reusing the landing hero's typewriter and tool-card primitives so each phone reads as a distinct AURA agent. (`4f9d48d`)
- Public chat and surrounding UI got tighter: the transcript fills full height and scrolls beneath the floating input, the public-nav slides between center and bottom on sidebar toggle, the marketing hero video fade no longer clips mid-page, the overlay scrollbar renders a properly rounded pill that grows on hover, and Tasks-tab checkmarks update live during dev runs. (`91af433`, `5ad826b`, `05a3554`, `0a51c5b`, `567338e`)

## 10:32 PM — Executor agent pileup fixed via local instance ledger

A storage-independent ledger keeps system-minted Loop/Executor instances out of the projects sidebar even when aura-storage drops their role columns.

- Dev/automation runs no longer leave permanent duplicate "Summarize This Me" rows in the projects sidebar: aura-os-server now tracks system-minted Loop/Executor instance IDs in SettingsStore and uses that ledger to filter the sidebar list and drive the executor janitor, so ephemeral rows are reclaimed even when storage strips instance_role/source on read. (`c895064`)

## 10:32 AM — Smoother waits and reveals for generated media

The image/video generation placeholder now animates as a ripple, and finished images fade in only after they have fully decoded.

- The media generation placeholder swapped its static CSS dot grid for a canvas where dots pulse in ripple waves, reading as actively working while respecting prefers-reduced-motion. (`c5b5017`)
- Generated chat images now mount inside a reserved square GeneratedImageFrame and only fade in after img.decode() resolves, eliminating the progressive top-down paint as the bitmap downloads. (`64a35d8`)

## 11:05 AM — setup-node hardened against self-hosted DNS blips

A local composite action retries reachability to api.github.com and nodejs.org before installing Node, with hosted-runner jobs reverted to the upstream action where the composite cannot resolve.

- Introduced a local ./.github/actions/setup-node composite that polls api.github.com and nodejs.org with backoff before running actions/setup-node, so transient 'getaddrinfo ENOTFOUND' on the self-hosted runners no longer fails build-sidecar on the first attempt; the pinned Node version is now centralized across every first-party workflow. (`4e4d177`)
- Reverted the five publish-manifests and changelog jobs back to actions/setup-node@v5, since they check out into subdirectories where the local composite cannot be resolved and run on hosted ubuntu-latest runners that never had the DNS issue. (`36fc5ac`)

## 11:24 AM — Session Cost, vendor-grouped models, and end-to-end thinking-level control

The chat input bar got a full economics pass: a Session Cost panel, vendor-grouped model picker, effort tiers wired into the harness, GPT Image quality control, and refreshed Anthropic pricing.

- Added a Session Cost section to the Context popover showing model, cumulative input/output/cache tokens, a weighted average cost per token with an input/output/cached rate overlay, and the total billed cost in dollars; pricing includes the aura-router 20% markup and the backend now surfaces cumulative tokens/model/provider so the panel hydrates after reload. (`f697368`, `cfb232a`)
- Reorganized the chat model picker into collapsible Anthropic / OpenAI / Open Source sections, surfaced Kimi K2.6 and Haiku 4.5, and wrapped the menu in a custom overlay scrollbar that locks its natural width so collapsing a vendor section no longer shrinks it. (`e54c97e`, `22d102c`)
- Reasoning effort is now a first-class wire field: ChatInputBar shows the selected tier in the trigger label, the picker displays effort-scaled credit costs, and reasoning_effort flows through SendChatRequest, SessionConfig, and the typed ReasoningEffort enum into the harness — with the effort folded into ChatSessionKey so changing tiers cold-opens a new session instead of reusing one pinned to the old level. (`22d102c`, `8b535cc`, `d0aa429`)
- GPT Image models gained a low/medium/high/auto quality dropdown that persists per agent and globally, defaulting to medium for faster generations; the model and quality pickers are now mutually exclusive in image mode, and Anthropic per-token rates were synced (Opus 4.7 to $5/$25, Haiku 4.5 to $1/$5) with every chat model's credit multiplier rebased against Haiku 4.5 = 1x. (`1d7d864`, `db26a43`, `a0f8c6a`)
- Marketing summary banners and small-count animations were tightened: the changelog stats now ease from zero to real values on every visit, small integer counts pace across the full animation window instead of snapping, the Feedback page gained an animated submitted/resolved/participants banner, and /models picked up a matching hot-pink banner with five catalog metrics. (`38e526d`, `456c843`, `e60b3dc`, `688cc66`)
- Public demo chat no longer fails with "model name must not be empty": the harness session is now opened with a pinned PUBLIC_DEMO_MODEL since the public surface has no client-side picker, and the cold-start ChatAppRoute drops its 'Starting chat...' hint for a cleaner spinner. (`cb59c9f`, `93e7761`, `2e446c4`)

## 1:43 PM — Model details flyout and a sharper /product headline

The model picker flyout now opens for every row with model details, and the /product hero takes on a sharper headline.

- The model picker flyout now opens for every row with a header listing model name, cost multiplier, and context window (new contextWindow field plus a formatContextWindow helper), keeping the reasoning-effort selector underneath. (`0c1fe62`)
- The /product hero headline now reads "Your Private Agent.", with the typewriter test assertion updated to match. (`1fdc7dc`)

## Highlights

- Per-model reasoning effort tiers, wired through to the harness
- Session Cost panel with real token + dollar billing
- Public chat self-heals after guest-token rotations
- Live mobile chat mockups on the /product page
- CI rides out transient DNS failures on self-hosted runners

