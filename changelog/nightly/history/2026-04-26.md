# Aura-managed models, persistent shell, and harness hardening

- Date: `2026-04-26`
- Channel: `nightly`
- Version: `0.1.0-nightly.404.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.404.1

A dense nightly day: chat agents now generate images natively, all model traffic consolidates onto Aura-managed credits, the desktop shell stops flashing between apps, and a sweep of harness, auth, and permission fixes tightens reliability across the server and sidecar.

## 7:49 PM — Spec drafts survive model timeouts

Server-side observability and recovery for streamed spec authoring.

- Streamed spec markdown is now preserved when create_spec is interrupted by a model timeout, so users no longer lose in-progress drafts, and agents are nudged away from oversized spec payloads. (`11cc781`)
- Agent stream output now logs concise summaries on the server, making it easier to trace chat and tool activity across persist, dispatch, and streaming paths. (`285f4bc`)

## 8:14 PM — Desktop fails closed on a broken harness sidecar

The desktop app no longer launches into a half-working state when the local harness can't start.

- If the managed local harness sidecar never passes its startup health probe, the desktop now kills the process instead of proceeding with a broken sidecar, preventing silent failures downstream on Mac, Windows, and Linux builds. (`e2d0540`)

## 8:18 PM — Smoother streaming task output persistence

Reduced jank when long task outputs stream into the cache.

- Task-output cache writes are now debounced and share a single IndexedDB connection, so streaming updates stop repeatedly parsing and rewriting localStorage and the UI feels noticeably smoother during long runs. (`bac6cf2`)

## 8:24 PM — Aura-managed models, generate_image, and a persistent desktop shell

The largest batch of the day: a unified Aura model proxy, a native image-generation tool for chat agents, a flicker-free middle panel, and a wave of harness, permission, and reliability fixes.

- All model traffic now routes through the Aura proxy: the org_integration BYOK path and direct Anthropic, OpenAI, Gemini, xAI, and OpenRouter catalog entries are gone, the chat model picker collapses to a single Aura group, and legacy org-backed agents are migrated through the agent editor. (`8b9fbd9`)
- Chat agents can now fulfill natural-language requests like "create an image of a cat" via a new provider-less generate_image workspace tool, with gpt-image-2 promoted to the default in both the chat picker and the Aura 3D Image Generation app. Image-only models are also kept out of the chat model picker. (`03c1449`, `1a897b8`)
- The middle root panel now stays mounted across app switches: the visible ResponsiveMainLane lives in DesktopShell so navigating between Agents, Notes, Tasks, Aura 3D, and other apps no longer flashes the wallpaper, while the Desktop app keeps its transparent wallpaper-bleed surface via a new bareMainPanel flag. (`c48f160`)
- The Run pane is fixed in two ways: it now seeds rows from the authoritative project task list so reloads or cleared local storage don't hide completed, failed, or active runs, and it queries by project rather than by the viewed chat's agent so loop runs actually appear when Run is pressed. (`6c1393c`, `5ba2be2`)
- Server-side hardening across auth and harness: stale auth fallback is capped, sensitive routes fail closed, harness WebSocket commands are bounded with explicit delivery errors and redacted frame logging, and floating agent windows hide the cramped "/ for commands" hint while keeping image/3D mode indicators. (`272818e`, `b9f19d3`)
- Agent permissions are now consistent end to end: dev-loop runs receive the same normalized capability bundle as chat sessions, missing or empty permission bundles default to full access so harness sessions retain process invocation, list_agents is a first-class capability that can be granted explicitly, and new agent control callback endpoints are exposed. (`2af35f3`, `442fd8a`, `9fbbd1d`, `fe50f6a`)
- Large-scale internal restructuring landed without behavior changes: the aura-os-server app builder, auth guard, error, generation, router, and state modules were split into focused submodules; core Rust crates (agents, browser, core entities, loops, network types, sessions, storage testutil, tasks) were similarly subdivided; and the interface stream handlers, shell, and output components were reorganized, with billing and leaderboard server caches routed through queries and protocol permission types regenerated. (`7b0b4c0`, `1e9b8ee`, `9d3f6f3`, `d4e0fa3`, `06af9e7`, `fbb7520`)

## 1:06 AM — CI rerun for the desktop sidecar after the ListAgents fix

A targeted release-infrastructure nudge to pick up the new harness capability.

- The desktop sidecar build was re-triggered on CI so the nightly bundle picks up the harness ListAgents capability change. (`9cd6bb3`)

## 10:12 AM — Sturdier media planning for the public changelog

The changelog screenshot pipeline gets better at picking real product surfaces and avoiding duplicates.

- The changelog media planner now preserves planner targets across runs, recognizes the Debug app as a seedable capture surface, filters out mobile-only and pricing/benchmark-only commits that lack a visible model-picker proof, and de-duplicates model-picker candidates so screenshot coverage focuses on genuinely user-visible changes. (`697ed98`, `4561db0`, `6102050`)

## Highlights

- generate_image tool and gpt-image-2 default for chat agents
- All model traffic now routes through the Aura proxy
- Middle panel stays mounted across app switches
- Desktop fails closed when the local harness sidecar is unhealthy
- Run pane finally shows loop runs and survives reloads

