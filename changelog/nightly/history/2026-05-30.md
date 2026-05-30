# Smarter model picker, session cost visibility, and self-healing public chat

- Date: `2026-05-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.571.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.571.1

Today's nightly leans heavily into chat control surfaces: a redesigned model picker with credit multipliers and per-model reasoning effort, a new Session Cost breakdown in the Context popover, and selectable GPT Image quality. Public chat now recovers automatically from stale guest tokens, generated images settle in cleanly, and the marketing site's product page gains live mobile chat mockups. A pair of CI fixes also hardens release builds against transient DNS failures.

## 9:27 PM — Public chat recovery, model picker controls, and product page mockups

A dense late-night batch reshaped the public chat experience, the model picker, and the marketing product page.

- Public chat now self-heals after a server-side guest-secret rotation: a new isGuestAuthError predicate catches 401s and "guest token" rejections, discards the stale cached token, mints a fresh one, and silently retries the turn across desktop, mobile, and the dispatch-media boundary. (`72f8ed3`)
- The chat model picker gained a credit-multiplier badge per model and a hover flyout to pick reasoning effort (Low through Max) for supported models, with the choice persisted per model and forwarded as reasoning_effort on every chat stream request. (`b135e7a`)
- Task checkmarks now update live during dev runs — useProjectLayoutData subscribes to task_updated edges and patches the layout cache, so completions appear immediately whether the user is on the Tasks tab or the Run tab. (`567338e`)
- Marketing /product page replaced empty PhoneShell placeholders with three looping mobile chat mockups driven by the landing hero's typewriter and terminal-stream primitives, and the public chat transcript, sidebar nav, hero video fade, and overlay scrollbar all got targeted visual fixes. (`4f9d48d`, `05a3554`, `5ad826b`, `91af433`, `0a51c5b`)

## 10:32 PM — Executor agent ledger stops dev-run sidebar pileup

A persistent local ledger now tracks system-minted Executor instances so they can be reclaimed even when storage drops their role metadata.

- Ephemeral Executor agents spawned by dev/automation runs no longer pile up as duplicate "Summarize This Me" rows in the projects sidebar: a SettingsStore-backed ledger records every system-minted instance ID on creation, drives the purge by ID so orphans are reclaimed even when aura-storage strips instance_role, and hides ledger-tracked rows from list_agent_instances regardless of what storage returns. (`c895064`)

## 10:32 AM — Calmer media generation: ripple loader and decoded image fade-in

The image generation experience now feels deliberate from placeholder to final frame.

- The image and video generation placeholder swapped its static CSS dot grid for a canvas where dots pulse in flowing ripple waves, so the wait reads as actively working; prefers-reduced-motion still draws a single static frame. (`c5b5017`)
- Generated chat images no longer paint in progressively or grow their frame downward — a new GeneratedImageFrame reserves a square box with a loader, gates the reveal on img.decode(), and fades the finished image in. (`64a35d8`)

## 11:05 AM — Hardened setup-node against runner DNS blips

A local composite action now polls the Node and GitHub registries with backoff before installing, with a targeted carve-out for jobs that check out into subdirectories.

- All first-party workflows now use a local ./.github/actions/setup-node composite that polls api.github.com and nodejs.org with backoff before invoking actions/setup-node, so a transient getaddrinfo ENOTFOUND on self-hosted runners no longer kills build-sidecar on the first attempt; the pinned Node version is centralized in one place. (`4e4d177`)
- The publish-manifests and changelog jobs, which check the repo out into subdirectories on GitHub-hosted runners, were reverted to upstream actions/setup-node@v5 so the composite's path resolution doesn't break them. (`36fc5ac`)

## 11:24 AM — Session Cost popover, image quality picker, and provider-grouped models

A morning of chat-surface work added cost visibility, image quality control, a restructured model picker, and supporting polish on the marketing site.

- The bottom-bar Context popover now includes a Session Cost section showing the active model, cumulative input/output/cached tokens, a weighted average cost per token with a per-type rate overlay, and the total billed cost in dollars — using aura-router's 20% markup so figures match what's actually debited, and hydrating from the backend on reload. (`f697368`)
- GPT Image models gained a quality dropdown (low/medium/high/auto) wired from the chat UI through aura-os-server to aura-router, now defaulting to medium for faster generations and persisting per agent; DALL·E and Gemini keep provider defaults and hide the control. (`1d7d864`)
- The chat model picker was reorganized into collapsible Anthropic / OpenAI / Open Source sections via a shared ModelMenuGroup component reused by desktop and mobile, surfacing Kimi K2.6 and adding Anthropic Haiku 4.5 to the visible list. (`e54c97e`)
- Marketing polish: the Changelog page's four summary stats now always animate from zero to their real values on every visit, and the Feedback page gained an animated submitted/resolved/participant banner computed from an unfiltered fetch so it stays stable as list filters change. (`38e526d`, `e60b3dc`)

## Highlights

- Model picker grouped by provider with credit multipliers and reasoning-effort control
- New Session Cost section breaks down tokens and dollars per chat
- Public chat self-heals after guest-token secret rotations
- GPT Image gains a low/medium/high/auto quality selector
- Self-hosted CI runners ride out DNS blips on setup-node

