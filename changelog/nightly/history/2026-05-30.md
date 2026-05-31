# Model picker controls, session cost visibility, and a private bug report pipeline

- Date: `2026-05-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.576.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.576.1

A heavy interface day for Aura: the chat model picker grew credit multipliers, reasoning-effort tiers, and per-provider grouping; a new Session Cost panel exposes what each conversation is actually billing; and an end-to-end private bug-report flow shipped with consent gating, an admin viewer, and a fix-task workflow. Public chat moved off the harness so aura.ai works without a sidecar, CI was hardened against flaky DNS on self-hosted runners, and WebSocket auth switched to short-lived tickets so JWTs stop landing in URLs.

## 9:27 PM — Model picker gains effort tiers and the public demo chat gets polish

Late-night work introduced per-model reasoning-effort selection, self-healing guest auth, and a richer marketing demo on /product.

- The chat model picker now shows a credit-multiplier badge per model and a hover flyout to pick a reasoning effort (Low/Medium/High/XHigh/Max), persisted per model and forwarded as reasoning_effort on the chat stream. (`b135e7a`)
- Public chat self-heals when a guest JWT secret rotates: a 401 or 'guest token' rejection now discards the stale token, re-mints a fresh one, and silently retries the same turn across desktop, mobile, and the dispatch-media boundary. (`72f8ed3`)
- The /product Agent section replaces empty phone shells with three looping mobile chat mockups that reuse the landing hero's typewriter and tool-stream primitives so the page reads consistently with the desktop demo. (`4f9d48d`)
- Run-tab task checkmarks now update live: useProjectLayoutData subscribes to task_updated edges so completed tasks render without a manual refresh, with a shared isTaskStatus guard across hooks. (`567338e`)
- Several polish fixes landed for the public chat surface and overlay scrollbar — transcripts now fill height and scroll under the floating input bar, the overlay scrollbar thumb is a properly rounded pill that widens on hover, the public nav slides between center and bottom, and the marketing hero video fade no longer clips. (`91af433`, `0a51c5b`, `5ad826b`, `05a3554`)

## 10:32 PM — Executor agent leak fixed with a system-minted instance ledger

Dev-run executor agents no longer pile up in the projects sidebar after server restarts.

- Each ephemeral Executor instance is now tracked in a SettingsStore-backed ledger so the sidebar filter and janitor can purge orphans by ID even when storage strips instance_role/source columns, eliminating the duplicate 'Summarize This Me' rows that survived a dev-server restart mid-run. (`c895064`)

## 10:32 AM — Smoother media generation: animated waiting state and faded reveals

Image and video generation feels more responsive while assets load.

- The image/video generation placeholder swaps its static dot grid for a canvas where dots pulse in flowing ripple waves so the wait reads as active work; reduced-motion users get a single static frame. (`c5b5017`)
- Generated chat images now wait for img.decode() inside a reserved square frame and fade in once fully decoded, so message bubbles stop growing downward as the bitmap progressively paints. (`64a35d8`)

## 11:05 AM — CI hardened against transient DNS failures on self-hosted runners

A targeted setup-node wrapper rolls out across release workflows to absorb getaddrinfo blips.

- A local setup-node composite action now polls api.github.com and nodejs.org with backoff before installing Node, so a transient ENOTFOUND on the self-hosted runners no longer fails build-sidecar; the pinned Node version is centralized across Android, iOS, desktop, evals, and the nightly/stable release workflows. (`4e4d177`)
- Five publish/changelog jobs that check out the repo into subdirectories reverted to the upstream actions/setup-node since the local composite can't be resolved from non-root checkouts and those jobs run on GitHub-hosted runners that never had the DNS issue. (`36fc5ac`)

## 11:24 AM — Session Cost panel, picker overhaul, and a private bug-report pipeline

The afternoon shipped the day's biggest feature set: visible billing in chat, a reorganized model picker wired end-to-end through harness types, a full private bug-report capture/admin flow, and a fix for public chat in the Render deployment.

- A new Session Cost section in the Context popover surfaces the active model, cumulative input/output/cache tokens, a weighted avg cost per token with per-type rate overlay, and the total billed cost in dollars — pricing uses base provider rates plus the 20% router markup so figures match what is actually debited and survive a page reload via a refactored shared context_usage backend module. A follow-up fix folds cache read/write tokens into the displayed total so it reconciles with avg cost per token. (`f697368`, `cfb232a`)
- The chat model picker is reorganized into collapsible Anthropic / OpenAI / Open Source sections with a model-details hover submenu (name, cost multiple, context window), a width-stable scroll wrapper, and effort-scaled credit multipliers shown next to each thinking tier; the selected tier appears on the trigger label (e.g. 'Opus 4.8 XHigh'). (`e54c97e`, `0c1fe62`, `22d102c`, `8b535cc`)
- reasoning_effort is now a typed ReasoningEffort enum across the aura-os <-> harness wire and is folded into the ChatSessionKey, so changing thinking level cold-opens a session that rebuilds its loop config rather than reusing the prior one; Anthropic rates were synced (Opus 4.7 $5/$25, Haiku 4.5 $1/$5) and every model's credit multiplier rebased against Haiku 4.5 = 1x. (`d0aa429`, `a0f8c6a`)
- Image-mode adds a selectable quality dropdown (low/medium/high/auto) for GPT Image models, threaded from chat UI through aura-os-server to aura-router, defaulting to medium for faster generations; the model and quality pickers are now mutually exclusive. (`1d7d864`, `db26a43`)
- Private bug reports shipped end to end: a server-side store with Opus 4.8 triage summary and is_sys_admin gating, an in-browser diagnostics bundle (prompt, transcript, model, ids, breadcrumbs, env) submitted via a required consent modal, and an admin-only Bug Reports app with a sys-admin Resolve button on feedback. A follow-up adds a fix-task workflow that spins a spec+task from a report and auto-resolves the feedback on completion. (`a0d3a16`, `0abe66c`, `a81296a`, `a1cfda1`)
- Public chat no longer requires a bundled harness: the demo endpoint now streams via aura-router's /v1/messages (translating Anthropic deltas into the SSE events the frontend already consumes), and pins PUBLIC_DEMO_MODEL on the session config so the demo works on the single-process Render deployment behind aura.ai. The /models marketing page is also fed from bundled AVAILABLE_MODELS instead of a network call that quietly returned empty. (`5687850`, `cb59c9f`, `cdcc01f`)
- Out-of-org chat sessions now open against their true owner agent id (the server-stamped _agentId) instead of falling back to the CEO chat agent, ending 'session not found' 404s for sessions returned by GET /api/me/sessions after the storage migration. (`59d528a`)
- Settings gained a personal 'You' section (avatar, name, bio, website, location, profile link) as the default first entry on both the modal and the routed page, with the Team group reordered above App and 'Appearance' renamed 'Theme'. (`a043143`)
- Marketing banner stats now actually animate: useCountUp was reworked to always start at 0 and ease to the real target with magnitude-paced timing, a /models gradient banner with five animated catalog metrics was added, and stale 'Loading…' fallbacks were removed from public pages. (`38e526d`, `688cc66`, `8ae820c`, `ce86b37`, `456c843`, `e60b3dc`, `ad102ca`)
- Smaller polish: logout now closes lingering modals, the boot splash is gone on normal startup, autofill 'Saved info' popups are disabled on chat inputs, Simple/Advanced toggle no longer flashes, the public nav pill slides on press, and the invite modal swaps its gift icon for a full-bleed AURA video banner with a hover-only close. (`a857b60`, `dfc17de`, `d3adb7d`, `e771cd8`, `5aad710`, `a0a29b3`, `8518f9b`, `7eee15e`)
- SwarmHarness was migrated to the new two-step POST /v1/agents/:id/run + WS stream contract, replacing the removed POST /sessions handshake that had been failing with 'did not emit session_ready within 20s'. (`1d36c7d`)
- The public landing gained a centered 'Your Private Agent.' typewriter tagline above the desktop widget, a rotating Private/Secure/Decentralized/Open Source ticker in the public taskbar, and themed accent coloring for open menu triggers; profile avatar size was aligned to neighboring taskbar pills. (`8eae17d`, `1fdc7dc`, `be10fb0`, `8210fdc`)

## 4:34 PM — WebSocket connect tickets, faster bug-report send, and cached changelog stats

Evening work focused on auth-surface hardening, the bug-report send path, and a same-origin proxy for the changelog stats card, plus landing-page tagline polish.

- WebSocket auth no longer puts JWTs in URLs: clients now POST /api/auth/ws-ticket with a bearer header to mint a single-use ~30s ticket, then connect with ?ticket=, which the guard redeems and burns. The /ws/events, /ws/terminal, /ws/browser, and remote-agent terminal paths all switched over and the raw ?token= JWT fallback is removed. (`3775739`)
- Bug-report Send stops hanging: the handler persists the report and returns 201 immediately, the Opus triage summary runs in a spawned task that backfills llm_summary, every report is mirrored into the public Feedback app as a 'bug' post (description only — diagnostics stay private), and apiFetch gained an opt-in AbortController timeout so stalled requests surface an error instead of spinning. (`db00a3c`)
- The /changelog commit-count card now hits a same-origin GET /api/public/commit-stats endpoint that fans out to GitHub with an optional GITHUB_API_TOKEN and caches the aggregate for 30 minutes, replacing 14 unauthenticated requests per cold load that reliably tripped GitHub's 60 req/hr/IP limit and rendered 0. (`a889c25`)
- Sys-admin grants now flow from a SYS_ADMIN_EMAILS allowlist at session-build time, resolving the admin email from the typed login/register input, then JWT claims, then the zOS user response, with startup and per-session diagnostics so a missed match is visible in logs. (`7b5e6a6`, `2d78b37`)
- The standard consent-gated Report bug affordance now appears on swarm agent VM errors and connection-loss surfaces (ConnectionTaskbar and the AgentStatusBar Disconnected badge), matching the inline button already used for chat session issues. (`f3496c5`)
- The landing 'Your Private Agent.' tagline was iterated to track persona nav polarity (pure white on dark personas, dark on light), shrink 25% on responsive scales, and remain centered in the gap above the desktop widget at any aspect ratio via a measured CSS variable. The taskbar ticker also became a true vertical slide and split into separate floating pills next to the theme toggle. (`6792219`, `b892373`, `35acb3a`, `68cd7a7`, `d7c224c`, `2ab7428`, `8d5b5f0`, `652569f`, `a1fc5f4`, `f38a15a`)
- Pricing page cleanup: removed the Crusader plan, renamed Mortal to Free at $0/mo, and flattened horizontal padding to match /feedback and /models so the 960px content column lines up across marketing pages. (`108ef6e`, `b9c13b1`, `b53c208`)
- The streaming 'Cooking' shimmer and stuck-stream pill now render above the input bar's top-fade gradient and accept clicks, so the Stop / Retry / Report controls are reachable mid-stream. (`ab5623d`)

## Highlights

- Reasoning effort and credit multipliers in the model picker
- New Session Cost panel with cache-accurate token math
- Private bug reports: capture, consent, admin viewer, fix-task workflow
- Public chat now streams via aura-router with no harness required
- WS auth moved to single-use connect tickets, JWTs out of URLs
- CI resilient to DNS blips on self-hosted runners

