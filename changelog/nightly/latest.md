# Model picker overhaul, session cost, and a private bug-report pipeline

- Date: `2026-05-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.575.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.575.1

A heavy day across the chat surface and marketing site: the model picker gained credit multipliers, reasoning-effort tiers, and provider grouping; the Context popover now shows real session cost; and a new consent-gated bug-report flow ships end-to-end from the user's Report button into an admin viewer that can spawn fix-it tasks. Public chat was also rescued from a router-versus-harness mismatch that was breaking the demo on aura.ai.

## 9:27 PM — Reasoning-effort model picker and self-healing public chat

Late-night work introduced per-model credit multipliers and a reasoning-effort flyout, while fixing a class of stuck-guest sessions and polishing the marketing surface.

- The chat model picker now shows a credit-multiplier badge per model and a hover flyout to choose a Low/Medium/High/XHigh/Max reasoning effort, persisted per model and forwarded as reasoning_effort on every send. (`b135e7a`)
- Public chat now self-heals when a stale guest token gets rejected: a 401 or 'guest token' error triggers a silent re-mint and one retry across desktop, mobile, and the dispatch-media boundary, ending the permanent stuck state caused by GUEST_JWT_SECRET rotations. (`72f8ed3`)
- Project task checkmarks now update in real time during dev runs by also patching the layout cache on task_updated events, so users no longer need to refresh the Tasks tab after watching a Run. (`567338e`)
- Marketing polish: the /product agent section gained three looping mobile chat mockups, the orb hero video fades cleanly into the page, public sidebar nav slides between center and bottom, the transcript fills full height under a floating input bar, and the overlay scrollbar thumb is rounded and grows on hover. (`4f9d48d`, `05a3554`, `5ad826b`, `91af433`, `0a51c5b`)

## 10:32 PM — Executor agent ledger stops dev-run orphans

A persistent ledger in SettingsStore keeps ephemeral Executor agents from accumulating in the projects sidebar when storage strips role columns.

- System-minted Loop/Executor instance IDs are now tracked in a storage-independent ledger so the sidebar filter and janitor can reliably purge dev-run executors even when aura-storage drops instance_role and source columns, ending the duplicate 'Summarize This Me' rows that survived server restarts. (`c895064`)

## 10:32 AM — Smoother media generation and decoded image reveals

The wait state and the moment images appear in chat both got tangibly nicer.

- The image/video generation placeholder now animates a canvas-based ripple of pulsing dots instead of a static panning grid, so the wait reads as active work (with a single static frame under prefers-reduced-motion). (`c5b5017`)
- Generated chat images now reserve a square frame and fade in only after img.decode() resolves, eliminating the progressive top-down paint that grew the message bubble downward. (`64a35d8`)

## 11:05 AM — Self-hosted runner DNS resilience for setup-node

Release Infrastructure gained a retrying setup-node wrapper to tolerate transient DNS blips, with a targeted carve-out for subdirectory checkouts.

- A new local setup-node composite action polls api.github.com and nodejs.org with backoff before installing, so transient ENOTFOUND errors on self-hosted runners no longer fail build-sidecar on the first attempt; all first-party workflows were migrated and the Node version is now centrally pinned. (`4e4d177`)
- Five publish/changelog jobs that check the repo out into subdirectories were reverted to upstream actions/setup-node@v5, since the local composite cannot resolve from those paths and those jobs run on GitHub-hosted runners that never had the DNS issue. (`36fc5ac`)

## 11:24 AM — Session Cost, grouped model picker, and the private bug-report pipeline

The day's largest batch shipped a Session Cost section in the Context popover, restructured the model picker around providers and effort tiers, fixed several deployment-blocking public-chat bugs, and stood up an end-to-end private bug-report flow with an admin viewer and fix-task workflow.

- The Context popover gained a Session Cost section showing the model, cumulative input/output/cache tokens, a weighted Avg. Cost per Token with input/output/cached rate overlay, and a dollar total computed from base provider rates plus aura-router's 20% markup; the backend context-usage endpoint now surfaces cumulative tokens and provider so the section hydrates on reload. (`f697368`, `cfb232a`, `2e446c4`)
- The model picker was reorganized into collapsible Anthropic / OpenAI / Open Source sections with a custom-scrollbar menu, hover submenus showing each model's cost multiple and context window, effort-scaled credit costs per tier, and an Anthropic pricing refresh (Opus 4.7 to $5/$25, Haiku 4.5 to $1/$5) with credit multipliers rebased on output $/MTok anchored at Haiku 4.5 = 1x. (`e54c97e`, `22d102c`, `0c1fe62`, `8b535cc`, `a0f8c6a`)
- Reasoning effort is now a typed ReasoningEffort enum on the aura-os <-> harness wire and is folded into the chat session key, so changing thinking level cold-opens a session that rebuilds its loop config; the selected tier also appears in the trigger label (e.g. 'Opus 4.8 XHigh') on desktop and mobile. (`d0aa429`, `170487f`)
- Image mode gained a quality dropdown (low/medium/high/auto) for GPT Image models — defaulting to medium for faster generations, persisted per agent and globally, threaded through to OpenAI via aura-router — and is now mutually exclusive with the model picker so only one menu opens at a time. (`1d7d864`, `db26a43`)
- Two production-only public-chat failures were fixed: the public surface now pins PUBLIC_DEMO_MODEL on its session config and streams replies by proxying directly to aura-router's /v1/messages, replacing the local-harness handshake that had no harness in the single-process Render deployment. (`cb59c9f`, `5687850`)
- A private bug-reports pipeline shipped end to end: a consent-gated Report bug modal assembles prompt/transcript/model/ids/breadcrumbs/env diagnostics and posts to a new /api/bug-reports endpoint with Opus 4.8 triage summarization, an admin-only Bug Reports app renders the list and details (gated via is_sys_admin threaded through AuthSessionResponse), and a fix-task workflow can spec, run, and auto-resolve the linked feedback on completion. (`a0d3a16`, `0abe66c`, `a81296a`, `a1cfda1`)
- Settings gained a personal 'You' section with inline avatar/name/bio/website/location editing as the new default tab, the modal nav reordered Team above App, and 'Appearance' was renamed to 'Theme'. (`a043143`)
- Cross-org chat sessions now open by their true owner agent: the chat-app left panel navigates and fetches using each session row's server-stamped _agentId instead of falling back to the CEO chat agent, fixing 'session not found' 404s after the storage 0015 migration. (`59d528a`)
- Reliability and polish across the app: logout now also clears open modals so the settings panel no longer lingers, the boot splash is gone for normal startup (kept only as a boot-error fallback), the Simple/Advanced mode flip is committed in a single flushSync to remove the app flash, and the swarm harness was migrated to the new POST /v1/run plus WS stream contract to fix 'session_ready within 20s' errors. (`a857b60`, `dfc17de`, `e771cd8`, `1d36c7d`)
- Marketing site: the /models page now renders from bundled AVAILABLE_MODELS constants instead of an empty public API, the Changelog/Feedback/Models banners count from 0 with a visible loading ramp on every visit, the public nav pill slides on pointerdown rather than waiting for route commit, and a gradient summary banner with five animated metrics landed on /models. (`cdcc01f`, `38e526d`, `456c843`, `8ae820c`, `ce86b37`, `5aad710`, `688cc66`, `e60b3dc`, `1fdc7dc`)

## 4:34 PM — Landing tagline, asynchronous bug-report send, and cached commit stats

Evening polish centered the new landing tagline across viewports, made the bug-report Send action non-blocking with Feedback mirroring, and rescued the changelog stats card from GitHub's unauthenticated rate limit.

- A 'Your Private Agent.' tagline now sits in the public landing hero, type-styled to match /product, vertically centered in the live gap above the mock desktop widget on any viewport, color-matched to the active persona's nav polarity, and scaled 25% smaller than the product header. (`6792219`, `d7c224c`, `68cd7a7`, `35acb3a`, `f38a15a`, `b892373`)
- The public bottom-left taskbar now cycles 'Private. / Secure. / Decentralized. / Open Source.' as a vertical ticker (outgoing word slides up, incoming slides in from the bottom) and runs even when OS animations are off, after a sequence of fixes to layer sizing and gating. (`2ab7428`, `8d5b5f0`, `652569f`)
- The bug-report Send action no longer blocks on Opus triage: reports are persisted and 201'd immediately while the LLM summary backfills in a spawned task, every report is mirrored into the Feedback app as a public Bug post (description only — diagnostics stay private), apiFetch gained an opt-in AbortController timeout, and the modal now shows an inline 'Report sent' confirmation. (`db00a3c`)
- The standard consent-gated Report bug affordance now appears on the swarm agent VM error card and on connection-loss surfaces (ConnectionTaskbar and the AgentStatusBar Disconnected badge), matching the inline option already used for chat session issues. (`f3496c5`)
- Changelog commit counts now load via a cached same-origin /api/public/commit-stats proxy that attaches an optional GITHUB_API_TOKEN (5000 req/hr) and caches aggregates for 30 minutes, replacing 14 unauthenticated browser requests per load that reliably hit GitHub's 60 req/hr cap and rendered 0. (`a889c25`)
- Pricing page cleanup removed the Crusader plan and renamed Mortal to Free at $0/mo, with horizontal padding aligned to sibling marketing pages so the column width matches /feedback at every breakpoint. (`108ef6e`, `b9c13b1`, `b53c208`)
- Selected taskbar and sidekick tab buttons now render in the theme accent color (including the drag overlay and the 'more' menu's selected items), and the THE GRID bolt icon gained a pulsing halo. (`87a308b`, `97a4c68`)

## Highlights

- Per-model reasoning effort with credit multipliers in the picker
- Session Cost panel with real provider rates
- Private, consent-gated bug reports with admin triage and fix tasks
- Public demo chat fixed to stream via aura-router
- CI hardened against transient DNS flakes on self-hosted runners

