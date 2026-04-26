# Aura-managed model routing, persistent shell, and tighter agent permissions

- Date: `2026-04-26`
- Channel: `nightly`
- Version: `0.1.0-nightly.402.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.402.1

A dense nightly that consolidates model traffic behind the Aura proxy, eliminates the wallpaper flash when switching apps, and hardens the agent runtime — from harness sidecar startup to permission defaults. The bulk of the day is a long Interface and Core Rust thread, with a small late patch to changelog tooling.

## 7:49 PM — Spec drafts survive model timeouts

Streamed spec markdown is now recoverable when create_spec stalls, plus richer agent stream logging on the server.

- Timed-out spec drafts are preserved instead of discarded, so a model timeout during create_spec no longer wipes the in-progress markdown, and agents are nudged away from oversized spec payloads. (`11cc781`)
- Server-side agent streaming now logs output summaries across the chat, persistence, and tool dispatch paths to make stuck or malformed runs easier to diagnose. (`285f4bc`)

## 8:14 PM — Desktop fails closed on an unhealthy harness sidecar

The desktop app no longer continues with a broken local harness when the startup probe never passes.

- If the managed local harness sidecar fails its startup health probe, the desktop now kills the process and aborts launch instead of proceeding with a half-initialized backend. (`e2d0540`)

## 8:18 PM — Smoother task output streaming in the browser

IndexedDB and cache writes were reworked to remove jank during long task streams.

- Browser storage now reuses a single shared IndexedDB connection and debounces task-output cache writes, so streaming updates stop repeatedly reopening the DB and rewriting localStorage on every chunk. (`bac6cf2`)

## 8:24 PM — Aura-proxied models, persistent shell, and a hardened agent runtime

The night's main thread: model routing collapses to the Aura proxy, the desktop shell keeps the middle panel mounted across navigations, image generation gets a first-class agent tool, and server/harness internals are tightened around permissions, backpressure, and module boundaries.

- All model traffic now routes through the Aura proxy: the org_integration BYOK path and direct Anthropic/OpenAI/Gemini/xAI/OpenRouter catalog entries are gone, the chat model picker collapses to a single Aura group, and legacy org-backed agents are migrated in the editor. (`8b9fbd9`)
- Switching apps no longer flashes the wallpaper through: the visible main lane is lifted into DesktopShell so the middle panel keeps DOM identity across navigations, with a bareMainPanel escape hatch for the Desktop app's transparent surface. (`c48f160`)
- Image generation gets a first-class agent capability: gpt-image-2 is now the default in IMAGE_MODELS and the chat/aura3d pickers, a provider-less generate_image workspace tool lets agents fulfil prompts like "create an image of a cat" without the /image slash command, and image-only models are filtered out of the chat model picker. (`03c1449`, `1a897b8`)
- Agent permissions are tightened end-to-end: list_agents is exposed as a first-class capability for CEO and permission UI bundles, dev-loop runs receive the same normalized permission bundle as chat sessions, and missing or empty permissions default to the canonical full-access set so harness sessions get process invocation unless explicitly narrowed. (`9fbbd1d`, `2af35f3`, `442fd8a`, `fbb7520`)
- Server and harness reliability: stale auth fallback is bounded, sensitive routes fail closed, harness WebSocket commands gain bounded backpressure with explicit delivery errors and redacted frame logging, and new agent control callback endpoints land alongside the runtime changes. (`272818e`, `fe50f6a`)
- Run pane regressions are fixed: rows are seeded from the authoritative project task list so reloads and cleared local storage no longer hide completed/failed/active runs, and the pane is now project-scoped so loop runs show up regardless of which chat agent is being viewed. (`6c1393c`, `5ba2be2`)
- Agent input bar polish: the "/ for commands" hint is suppressed in narrow floating agent windows so the orbit/environment indicators stop wrapping onto a second line, while image and 3D mode labels are kept. (`b9f19d3`)
- Large internal restructuring: oversized server modules (app_builder, auth_guard, error, router, generation, state) and Rust crates (entities, permissions, sessions, tasks, network types) are split into focused submodules, stream handlers and event subscriptions are broken up on the interface side, and shell/output components are clarified — preserving behavior while shrinking the largest files. (`7b0b4c0`, `1e9b8ee`, `d4e0fa3`, `9d3f6f3`, `06af9e7`)

## 1:06 AM — Desktop sidecar build re-triggered after harness ListAgents fix

A CI nudge to rebuild desktop sidecars against the new list_agents capability.

- Re-triggered the desktop sidecar build so installers pick up the harness ListAgents capability landed earlier in the day. (`9cd6bb3`)

## 10:12 AM — Changelog media planner preserves seeded targets

A small fix to the changelog tooling that drives release media planning.

- The changelog media planner now preserves its seeded targets instead of dropping them, keeping release media plans stable across runs. (`697ed98`)

## Highlights

- All model traffic now routes through the Aura proxy
- Middle panel stays mounted across app switches — no more wallpaper flash
- Desktop fails closed when the local harness sidecar is unhealthy
- Spec drafts survive model timeouts; Run pane shows loop tasks again

