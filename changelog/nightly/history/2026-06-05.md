# Marketing site refresh, Telegram channel fixes, and a faster, hardened release pipeline

- Date: `2026-06-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.628.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.628.1

A heavy day of marketing-site work landed a new /code mock desktop and a shared first-screen layout across /code and /agents, while the Telegram channel bridge picked up an IDOR fix and clearer error surfacing. On the platform side, desktop release CI got materially faster and more resilient, macOS DMGs are now notarization-checked before shipping, and a standardized eval-gate framework joined CI to guard chat behavior.

## 10:07 PM — New /code page leads with a mock Projects desktop

The marketing /code page was restructured around an Agents-style centered hero with a full mock of the Projects workspace below it, and the public blog archive got a visual polish pass.

- Rebuilt /code to lead with a centered PageHero and a mock desktop below that reuses the shared MockAuraApp chrome, swapping the landing's scripted DM windows for a static MockProjectsWorkspace mocking the explorer, agent status, task feed, terminal, and sidekick. (`6be27e0`)
- Polished the public blog archive view with refreshed styling and markup. (`8bc84fd`)

## 10:47 PM — Telegram-linked agents now answer with a real model and surface true errors

Fixed a regression where Telegram turns posted with a null model and collapsed every failure into a generic apology, and made the connection greeting use the agent's real name.

- Picker-less Telegram chat now pins the latest frontier model at medium reasoning effort per turn, so agents without a default_model no longer fail with "model name must not be empty". (`55cb5f9`)
- Agent-reported errors are threaded back to the chat via a new ChannelError::Agent variant instead of being swallowed by a generic apology, and the initial greeting now reads "Connected to <agent name>" by carrying the name through pending and durable link records. (`55cb5f9`)

## 10:49 PM — Shared /code and /agents first screen, accent-text legibility, and Telegram link routing from Desktop

A long iteration pass unified the /code and /agents first screen into a shared layout, made the purple accent legible as text across the app, fixed Desktop's Telegram Connect flow against the prod control plane, and closed an IDOR on channel listing.

- Extracted a shared MarketingFirstScreen so /code and /agents align their hero band and stage; the /code mock desktop is now visible above the fold at near-maximized size, while /agents anchors its orb video and agent marquee to the bottom of the first screen with a symmetric top/bottom fade and full-bleed edges. (`90e8d1e`, `7b1ced2`, `08d93d0`, `ebcac06`, `b5d3525`, `2101b43`, `28a9da8`, `08db223`, `bd9dfd6`, `a25dd79`, `9266f8f`)
- Introduced a dedicated --color-accent-text token (brightened to #a855f7 in dark-mode purple) and repointed every accent text usage to it, so links, chips, and status text are readable while accent fills and borders stay unchanged. (`68a3147`)
- Desktop's Telegram Connect now routes channel link/list/disconnect calls to the prod control plane (api.aura.ai) instead of the bundled local server that has no bot configured, and closed an IDOR where any verified user could enumerate or delete another agent's linked chats — both endpoints now scope by JWT-resolved agent ownership. (`3a3b927`)
- Local dev /blog now fetches from the prod blog API by default so real posts render against storage-less dev servers, while prod and native builds keep same-origin behavior. (`2c3b0fe`, `ce8be53`)

## 9:41 AM — Desktop release CI is faster and survives flaky Node setup

A large overhaul of the release pipeline cut redundant work, added a CI performance benchmark, and hardened Node installation against transient network and tool-cache failures.

- Reworked the nightly and stable release workflows alongside a new CI performance benchmark workflow, added preflight, packager-config, and desktop-release-binary verification scripts, and centralized release artifact validation and upload/prune retries. (`776f003`)
- Hardened the shared setup-node action with up to three retries plus an explicit version verification step, keeping the Windows-only DNS reachability gate but skipping it on Linux/macOS to avoid pointless latency. (`776f003`)

## 12:11 PM — Cached nightly desktop binaries and notarized macOS DMGs

The nightly desktop release path now reuses prebuilt binaries when inputs match and gates macOS releases on real notarization and Gatekeeper checks.

- Added a fingerprint-keyed cache of the desktop release binary keyed on Rust sources, Cargo metadata, and release-relevant env/secrets, so unchanged nightly builds skip the Rust toolchain, sccache, and rebuild steps; also replaced the in-place Cargo.toml version sed with a dedicated write-desktop-release-metadata.mjs script and a new release_version module on the desktop app. (`3de45c1`)
- Added a macos-dmg-notarize-validate.sh step that submits each DMG to Apple's notary service and verifies codesign, stapler, and Gatekeeper acceptance across desktop-validate, nightly, and stable release workflows. (`5fabdcc`)
- Made sccache more resilient in desktop CI by setting SCCACHE_IGNORE_SERVER_IO_ERROR=1 so transient cache backend hiccups no longer fail the build. (`5fabdcc`)

## 8:22 PM — Standardized eval gates and tuned CodeQL coverage

Landed a chat-core eval lane with a checked-in baseline and reorganized CodeQL so PR gates stay fast while platform coverage stays broad.

- Added an aura-evals workflow with registry validation, a chat-core Playwright eval suite (mock app, 700+ line scenario set, baseline summary), and bench-smoke entrypoints, plus supporting compare/refresh/summarize scripts and a streams test for the chat stream handler. (`7e4626e`)
- Restructured CodeQL into core, mobile, and Rust workflows: trimmed PR gates, kept heavy Swift analysis off PRs, pinned Rust to no-build mode, and fixed the mobile Java extraction so Android coverage runs cleanly. (`7e4626e`)

## Highlights

- New /code mock Projects desktop and shared marketing first-screen layout
- Telegram channel: IDOR fix, real agent errors, and prod control-plane routing from Desktop
- Faster, retry-hardened desktop release CI with macOS DMG notarization validation
- Standardized chat-core eval gates and CodeQL coverage added to CI

