# /code marketing page lands, Telegram fixes, and a faster desktop release pipeline

- Date: `2026-06-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.626.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.626.1

A heavy day of marketing-site work rebuilt the /code page around a full mock of the Projects workspace and unified its first-screen layout with /agents. Alongside the visual push, Telegram-linked agents got real error surfacing and a security fix, dark-mode purple text became legible across the app, and the desktop release pipeline picked up retries, caching, and a cleaner version-stamping path.

## 10:07 PM — /code page leads with a Projects workspace mock

The marketing /code page was restructured to mirror the Agents page hero pattern, with a static mock of AURA's Projects workspace sitting below the headline.

- Rebuilt /code around a centered PageHero followed by a MockAuraApp desktop whose center content is a new MockProjectsWorkspace (explorer, agent status, task feed, terminal, and sidekick) instead of the landing page's scripted DM windows. (`6be27e0`)
- Tightened the public blog archive view with layout and styling polish for the marketing site. (`8bc84fd`)

## 10:47 PM — Telegram-linked agents stop failing silently

Fixes for the Telegram channel bridge mean turns actually pick a model, real errors reach the user, and chats greet by the agent's name.

- External Telegram turns now pin the latest frontier model at medium reasoning effort, so agents without a default model no longer fail with an empty model name and a generic apology. (`55cb5f9`)
- Agent-reported failures are surfaced through a new ChannelError::Agent variant instead of being collapsed into the generic message, and the connect handshake greets users with the agent's real name. (`55cb5f9`)

## 10:49 PM — Unified /code and /agents first-screen layout

A run of marketing fixes made the new /code mock desktop actually render at the right size, shared its first-screen layout with /agents, refreshed the hero copy, and routed desktop Telegram links to the cloud control plane.

- Extracted a shared MarketingFirstScreen so /code and /agents use the same centered hero band and content stage, with the /agents orb video and agent marquee moved into the stage to line up with where the /code mock desktop begins. (`b5d3525`, `7b1ced2`)
- Got the /code mock desktop visible and right-sized: gave the stage a definite viewport-derived height so container queries resolve, scaled the window to roughly a maximized footprint, and tuned its start position so it sits half above the fold. (`90e8d1e`, `08d93d0`, `ebcac06`)
- Rewrote the /code hero around "Ship software while you sleep.", positioning AURA as an open-source coding harness built for security, automation, and verifiability. (`9266f8f`)
- Routed desktop Telegram channel link/list/disconnect calls to the prod control plane via a new useControlPlane fetch option, and closed an IDOR where any verified user could enumerate or delete another agent's linked chats. (`3a3b927`)
- Introduced a dedicated --color-accent-text token brightened to #a855f7 for dark-mode purple, so accent text across chat, agents, browser, feedback, notes, and the zui library is now legible while fills and borders stay unchanged. (`68a3147`)

## 11:33 PM — /agents orb video styling and dev blog fetch

Follow-up polish on the /agents hero video produced a symmetric vertical fade and full-bleed framing, and local dev builds now pull real posts from the prod blog API.

- Made the /agents orb video fade symmetrically at the top and bottom by opening the clip box and letting PageHero's background go transparent inside the shared first-screen band, then tightened the gradient mask to 48%-52% so far less of the background loop is visible. (`2101b43`, `28a9da8`, `08db223`, `bd9dfd6`)
- Broke the /agents orb stage out of the shared horizontal gutter so the background video and agent marquee extend edge-to-edge while the hero band keeps its gutter. (`a25dd79`)
- Dev builds of /blog now always fetch from the prod blog origin (default https://api.aura.ai) via a new resolveBlogApiUrl, so the page renders real posts instead of the empty state from an unconfigured local server. (`ce8be53`, `2c3b0fe`)

## 9:41 AM — Hardened desktop release CI with retries and benchmarks

A large overhaul made desktop release workflows faster and more resilient to flaky runners, with a new performance benchmark workflow and tougher Node setup.

- Wrapped actions/setup-node with up to three retries plus a post-install version verification on every platform, and kept the Windows-only registry reachability gate, so transient TLS or DNS hiccups no longer leave runners on a stale preinstalled Node. (`776f003`)
- Added a CI Performance Benchmark workflow plus supporting timing, summary, and preflight verification scripts to measure and protect desktop release timings. (`776f003`)
- Reworked nightly and stable release workflows alongside desktop sidecar prep, artifact validation, and retry-wrapped upload/prune scripts to speed up and stabilize the end-to-end desktop release path. (`776f003`)

## 12:11 PM — Cached desktop binaries and cleaner version stamping

The nightly desktop path now reuses previously built binaries when inputs are unchanged and stamps release metadata through a dedicated script instead of patching Cargo.toml in place.

- Added a fingerprinted desktop release binary cache keyed off Rust sources, Cargo manifests, and signing/control-plane inputs, so the nightly job can skip Rust toolchain setup, sccache, and a full rebuild on cache hits. (`3de45c1`)
- Replaced the sed-based Cargo.toml version patch with a new write-desktop-release-metadata.mjs script and a release_version module in the desktop app, giving release versioning a single, testable code path used by both nightly and the performance benchmark workflow. (`3de45c1`)

## Highlights

- New /code mock desktop showcasing the Projects workspace
- Telegram channel fixes: model pinning, real error messages, IDOR closed
- Purple accent text now legible in dark mode
- Nightly desktop CI is faster and far more retry-tolerant

