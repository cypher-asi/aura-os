# Model picker depth, session cost insight, and chat self-healing

- Date: `2026-05-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.572.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.572.1

Today's nightly puts richer controls and visibility into the chat surface — a reworked model picker with credit multipliers, per-model thinking levels, and provider grouping, plus a new Session Cost panel that shows exactly what each turn is billing. On the reliability side, public chat now silently recovers from expired guest tokens, dev runs stop leaving behind ghost executor agents in the sidebar, and CI rides out transient DNS blips on self-hosted runners.

## 9:27 PM — Model picker upgrades, marketing polish, and resilient public chat

Late-evening work expanded the chat model picker with credit and effort controls, fleshed out the /product marketing page with live mobile mockups, and made public chat recover automatically from stale guest tokens.

- The chat model picker now shows a credit-multiplier badge next to each model and a hover flyout for picking a reasoning effort (Low/Medium/High/XHigh/Max); the choice persists per model and is forwarded as reasoning_effort on the stream request. (`b135e7a`)
- Public chat now self-heals after a guest-token secret rotation: a new isGuestAuthError predicate catches 401 / "guest token" failures across PublicChatView, MobilePublicChatView, and the dispatch-media boundary, discards the stale token, re-mints a fresh one, and silently retries the turn once. (`72f8ed3`)
- The /product agent section gained three live looping mobile chat mockups inside the PhoneShells, each texting a different AURA agent and reusing the landing hero's typewriter and tool-stream primitives so the marketing page stays consistent with the desktop demo. (`4f9d48d`)
- Project task checkmarks now update in real time during dev runs: useProjectLayoutData subscribes to task_updated edges and patches the layout cache, so completed tasks reflect immediately even when the user is watching the Run tab instead of the Tasks tab. (`567338e`)
- A cluster of smaller polish landed across the marketing hero fade, public-chat transcript height, public-nav slide behavior, and the overlay scrollbar — the scrollbar thumb is now a rounded pill that grows on hover/drag instead of a flat clipped rectangle. (`05a3554`, `5ad826b`, `91af433`, `0a51c5b`)

## 10:32 PM — Ghost executor agents in the projects sidebar

A storage-independent ledger now tracks system-minted Loop and Executor instances so ephemeral dev-run rows can't leak into the projects sidebar.

- Each dev/automation task run was leaving a permanent duplicate "Summarize This Me" row in the sidebar when aura-storage stripped the instance_role/source columns; a new SettingsStore-backed ledger of system-minted instance IDs now drives both the list filter and the executor purge, so infrastructure rows are reclaimed and hidden regardless of what storage echoes back. (`c895064`)

## 10:32 AM — Lively loading state and smoother image reveals in chat

Media generation now feels actively working while it loads, and finished images mount cleanly instead of painting in progressively.

- The image/video generation placeholder swapped its static CSS dot grid for a canvas that pulses dots in flowing ripple waves, with a single static frame under prefers-reduced-motion and a getContext guard for jsdom tests. (`c5b5017`)
- Generated chat images no longer paint in line-by-line: a new GeneratedImageFrame reserves a square box with a loader and gates the FadeInImage reveal on img.decode(), so the bitmap fades in fully decoded instead of growing the frame downward as it downloads. (`64a35d8`)

## 11:05 AM — CI setup-node hardened against transient DNS failures

A new composite action retries reachability to api.github.com and nodejs.org before installing Node, keeping self-hosted runner builds alive through brief egress blips.

- A local ./.github/actions/setup-node composite now polls api.github.com and nodejs.org with backoff before invoking actions/setup-node, so a transient getaddrinfo ENOTFOUND on self-hosted runners no longer kills build-sidecar on the first attempt; the pinned Node version is centralized and all first-party workflows were migrated. (`4e4d177`)
- Five publish-manifests and changelog jobs that check out the repo into subdirectories were reverted to upstream actions/setup-node@v5, since the local composite can't be resolved from those paths and those jobs run on GitHub-hosted runners that never had the DNS issue. (`36fc5ac`)

## 11:24 AM — Session Cost panel, GPT Image quality control, and end-to-end thinking levels

Late-morning work delivered the day's biggest chat-surface push: a new Session Cost section under the Context popover, a quality picker for GPT Image generations, provider-grouped model picker sections, and full wiring of reasoning effort from the UI through to the harness.

- A new Session Cost section sits under the Context popover showing the active model, cumulative input/output/total tokens, a weighted Avg. Cost per Token with a per-type rate overlay, and the total billed cost in dollars — pricing uses base provider rates plus aura-router's 20% markup so figures match what is actually debited, and the backend context-usage endpoint hydrates the panel on reload. (`f697368`)
- Follow-up tweaks fold cache read/write tokens into the Session Cost "Tokens Consumed / Total" so it matches the basis of Total Token Cost, add a cache sub-row for attribution, and lower the streaming "cooking" indicator so its gradient backdrop stops painting over the context popover. (`cfb232a`)
- Image mode for GPT Image models now exposes a quality dropdown (low/medium/high/auto) threaded from the chat UI through aura-os-server to aura-router; the default drops from always-high to medium for faster generations, the pick persists per agent and globally, and DALL-E/Gemini keep their provider defaults. (`1d7d864`)
- The chat model picker reorganized into collapsible Anthropic / OpenAI / Open Source sections (surfacing Kimi K2.6 and Anthropic Haiku 4.5), and a new ModelMenuScroll wraps the menu with the shared overlay scrollbar while locking its natural width so collapsing a section no longer shrinks it. (`e54c97e`, `22d102c`)
- Reasoning effort is now wired end-to-end: reasoning_effort joins SendChatRequest, SessionConfig, and ModelSelection, the chosen tier appears in the trigger label (e.g. "Opus 4.8 XHigh"), and the effort is folded into ChatSessionKey so changing thinking level cold-opens a session with the new effort instead of reusing the prior one. (`22d102c`)
- Smaller marketing-side polish: the public changelog's four summary stats now consistently animate from 0 to their real targets on every visit instead of snapping in or ramping to a fake 1000 placeholder, and the feedback page gained an animated submitted/resolved/participant summary banner driven by an unfiltered fetch. (`38e526d`, `e60b3dc`)

## Highlights

- Model picker gains credit multipliers and per-model thinking levels
- New Session Cost panel breaks down tokens and billed dollars
- Public chat self-heals after guest token rotation
- Self-hosted CI rides out transient DNS failures

