# Marketing site rebuild, Telegram hardening, and a faster notarized release pipeline

- Date: `2026-06-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.627.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.627.1

Today's nightly is dominated by a ground-up rework of the marketing first screen on /code and /agents, paired with a security and reliability pass on Telegram-linked agents and a substantial speedup and hardening of the desktop release pipeline — now with macOS notarization gated before publish.

## 10:07 PM — /code page leads with a mock Projects desktop

The marketing /code page was restructured around a centered hero and a static mock of the Projects workspace, and the public blog archive got a polish pass.

- Rebuilt /code to lead with an Agents-style centered PageHero followed by a full mock desktop that reuses the shared MockAuraApp chrome and frames a new MockProjectsWorkspace (explorer, agent status, task feed, terminal, and sidekick) in place of the landing's scripted DM windows. (`6be27e0`)
- Polished the public blog archive view with refreshed styles and markup. (`8bc84fd`)

## 10:47 PM — Telegram-linked agents stop failing silently

Channel turns from Telegram now pin a working model, surface real agent errors, and greet users by the agent's actual name.

- Telegram turns now pin the latest frontier model at medium reasoning effort instead of POSTing model: null, fixing the "model name must not be empty" failure for agents without a default_model. (`55cb5f9`)
- Added a ChannelError::Agent variant so agent-reported errors flow back to the chat instead of collapsing into a generic apology, and threaded the agent's real name through pending and durable link records so users see "Connected to <name>". (`55cb5f9`)

## 10:49 PM — Shared first-screen layout, readable purple accent, and Telegram from desktop

Iterated the /code mock desktop into a shared first-screen layout with /agents, fixed an unreadable purple accent across the app, and unblocked Telegram linking from the desktop build while closing an IDOR.

- Iterated the /code first screen so the mock desktop is visible and correctly sized — giving the stage a definite viewport-derived height so container-query units resolve, enlarging the frame to roughly a real maximized window, tuning its start position, and updating the hero copy to "Ship software while you sleep." (`90e8d1e`, `08d93d0`, `ebcac06`, `9266f8f`)
- Extracted a shared MarketingFirstScreen component used by both /code and /agents so hero text and stage content align across the two pages, and rebuilt the /agents hero as a body-height flex column that anchors the orb video and agent marquee to the bottom of the first screen instead of relying on a negative-margin peek. (`7b1ced2`, `b5d3525`)
- Introduced a dedicated --color-accent-text token (brightened to #a855f7 for dark-mode purple) and repointed accent text usages across chat, agents, browser, feedback, notes, billing, and shared zui components so accent text becomes legible while fills, chips, and borders stay unchanged. (`68a3147`)
- Routed desktop Telegram channel link/list/disconnect calls to the prod control-plane via a new useControlPlane fetch option and baked VITE_NATIVE_DEFAULT_HOST into the desktop build, fixing the 503 Connect failures, and closed an IDOR by scoping list_channels and disconnect_channel to the caller's agent ownership. (`3a3b927`)

## 11:33 PM — /agents orb video fade and full-bleed marquee, plus prod blog in dev

Finished the /agents hero treatment with a symmetric video fade and a full-bleed marquee, and pointed the dev blog at production so local builds show real posts.

- Reworked the /agents orb video so its gradient mask fades symmetrically at the top and bottom — opening the clip box vertically, letting the hero band background go transparent inside the shared first-screen so the top fade isn't hard-cut, then tightening the visible band from 30–70% down to 48–52%. (`2101b43`, `28a9da8`, `08db223`, `bd9dfd6`)
- Broke the /agents orb stage out of the shared first-screen gutter so the background video and agent marquee extend edge-to-edge while the hero band keeps its gutter and /code is unaffected. (`a25dd79`)
- Pointed the /blog endpoints at the prod blog origin in dev builds so local shells render real posts instead of the empty state from a storage-less local server, while prod and native builds keep same-origin behavior. (`ce8be53`, `2c3b0fe`)

## 9:41 AM — Desktop release CI overhaul with retryable Node setup

A large pass on release workflows shortens the desktop release path and makes it tolerant of transient runner failures.

- Rebuilt the nightly and stable desktop release workflows for speed, added a new CI performance benchmark workflow, and introduced helper scripts for run-timing summaries, perf timing, packager config patching, release binary verification, and preflight checks. (`776f003`)
- Hardened the shared setup-node action with up to three retries and a post-install version check, plus the existing Windows-only registry-reachability gate, so transient TLS or DNS failures no longer leave runners on a wrong Node version. (`776f003`)

## 12:11 PM — Cached desktop binaries and gated macOS DMG notarization

Nightly desktop builds skip rebuilding when inputs are unchanged, and macOS DMGs are now notarized and validated before any release is published.

- Cached the built desktop release binary in nightly CI keyed on Rust sources and bundle env fingerprint, skipping the Rust toolchain, sccache, and full rebuild on cache hits, and replaced the in-place Cargo.toml version sed with a dedicated write-desktop-release-metadata script plus a new release_version module in the desktop app. (`3de45c1`)
- Added a macos-dmg-notarize-validate.sh step wired into desktop-validate, release-nightly, and release-stable that submits each macOS DMG to Apple's notary service and re-checks codesign, stapler, and Gatekeeper before artifacts are collected. (`5fabdcc`)
- Set SCCACHE_IGNORE_SERVER_IO_ERROR across desktop CI so transient sccache backend hiccups fall back gracefully instead of failing the build. (`5fabdcc`)

## Highlights

- New mock Projects desktop on /code
- Shared first-screen layout across /code and /agents
- Telegram agent turns no longer fail silently
- Desktop channel IDOR closed
- Nightly desktop builds cache binaries and validate DMG notarization

