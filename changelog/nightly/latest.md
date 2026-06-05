# Marketing first-screen rebuild, Telegram fixes, and a faster nightly release pipeline

- Date: `2026-06-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.625.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.625.1

A heavy day on two fronts: the marketing site got a new shared first-screen layout — a mock Projects desktop on /code and a redesigned orb stage on /agents — while the backend tightened Telegram channel handling (including an IDOR fix) and the desktop release pipeline got materially faster and more resilient on hosted runners.

## 10:07 PM — Mock Projects desktop lands on the /code marketing page

The /code page was restructured around a centered hero with a full mock of the Projects workspace rendered inside the shared MockAuraApp chrome.

- Replaced the old product-screen stack on /code with an Agents-style centered PageHero followed by a mock desktop that reuses the MockAuraApp titlebar, taskbar, and wallpaper, framing a new static MockProjectsWorkspace (explorer, agent status, task feed, terminal, sidekick). (`6be27e0`)
- Polished the public blog archive view as a small companion pass alongside the /code rework. (`8bc84fd`)

## 10:47 PM — Telegram-linked agents stop failing with empty-model errors

Picker-less Telegram chats now pin a default model and surface real agent errors instead of a generic apology, and greet users with the agent's real name.

- Telegram turns no longer POST a null model: the external chat surface now pins the latest frontier model at medium reasoning effort, so agents without a default_model stop failing the harness turn with "model name must not be empty". (`55cb5f9`)
- Added a ChannelError::Agent variant so agent-reported failures reach the chat with their real message instead of being collapsed into a generic apology, and the connect greeting now uses the agent's actual name via the pending and durable link records. (`55cb5f9`)

## 10:49 PM — Shared first-screen layout for /code and /agents, plus accent-text legibility fix

Iterated the new /code first screen into a shared MarketingFirstScreen with /agents, fixed desktop Telegram linking from the bundled local server, and made purple accent text readable on dark surfaces.

- Extracted a shared MarketingFirstScreen (centered hero band + content stage) so /code and /agents line up vertically: /code hosts the enlarged mock desktop at ~96% of a viewport-tall container starting halfway down the screen, while /agents anchors the orb video and agent marquee to the bottom of the first screen instead of pulling them below the fold with a negative-margin peek. (`90e8d1e`, `7b1ced2`, `08d93d0`, `ebcac06`, `9266f8f`, `b5d3525`)
- Desktop Telegram linking now works: channel link/list/disconnect calls are routed to the prod control-plane via a new useControlPlane fetch option and VITE_NATIVE_DEFAULT_HOST baked into the desktop build, so Connect no longer 503s against the bundled local server that has no bot configured. (`3a3b927`)
- Closed an IDOR in the channels API: list_channels and disconnect_channel now resolve the agent against the caller's JWT, and disconnect verifies the target link actually belongs to that agent before deleting — previously any verified user could enumerate or delete another agent's linked chats. (`3a3b927`)
- Introduced a dedicated --color-accent-text token (brightened to #a855f7 for dark-mode purple) and repointed accent text usages across agents, chat, browser, feedback, notes, settings, and the zui vendor components so accent text is legible while fills, chips, and borders are unchanged. (`68a3147`)

## 11:33 PM — /agents orb fade tuning and dev-mode blog routed to prod

Finished off the /agents hero with symmetric video fades and a full-bleed stage, and made the dev /blog page render real posts by always pointing at the prod blog API.

- Refined the /agents orb video: opened the clip box to fade symmetrically at top and bottom through the hero band, tightened the gradient mask from 30–70% down to 48–52% so much less of the background loop shows, and broke the stage out of the shared first-screen gutter so the video and AgentMarquee extend edge-to-edge. (`2101b43`, `28a9da8`, `08db223`, `bd9dfd6`, `a25dd79`)
- Dev builds of the marketing /blog now always fetch from the prod blog origin (default https://api.aura.ai) via a new resolveBlogApiUrl, so the page stops rendering the empty "No posts yet" state when the local server has no storage configured; prod and native builds keep same-origin behavior. (`ce8be53`, `2c3b0fe`)

## 9:41 AM — Desktop release CI hardened with Node retries and a perf benchmark workflow

A large overhaul of the desktop release pipeline: setup-node retries for all platforms, a new CI performance benchmark workflow, and consolidated release validation scripts.

- actions/setup-node is now retried up to three times with backoff on every platform and verifies the resolved Node version afterward, so transient TLS or manifest-download failures stop silently leaving runners on the preinstalled Node and failing later parity checks. (`776f003`)
- Added a dedicated ci-performance-benchmark workflow plus shared timing and summary scripts (perf-timer, ci-perf-summary, gh-run-timing-summary) to measure and track release-pipeline performance over time. (`776f003`)
- Reworked the nightly and stable release workflows with new preflight verification, desktop artifact validation, packager-config patching, and retrying upload/prune scripts to make release runs more resilient end-to-end. (`776f003`)

## 12:11 PM — Cached desktop binary path speeds up the nightly release

The nightly desktop release now reuses a cached release binary keyed on the relevant Rust sources and signing inputs, skipping Rust setup, sccache, and rebuilds on cache hits.

- Nightly release jobs compute a fingerprint over signing keys and control-plane URLs and use it (alongside hashed Rust sources and Cargo manifests) as the key for a new desktop-release-bin cache, skipping Rust toolchain setup, the Swatinem cache, and sccache configuration when the binary can be restored. (`3de45c1`)
- Replaced the ad-hoc sed-based Cargo.toml version patching with a dedicated write-desktop-release-metadata.mjs script and added a new release_version module in the desktop app, giving the release a single source of truth for the version it ships and reports. (`3de45c1`)

## Highlights

- New /code mock desktop and shared first-screen layout with /agents
- Telegram channel linking fixed on desktop, IDOR closed
- Purple accent text now legible across the app
- Nightly desktop release path cached, retried, and meaningfully faster

