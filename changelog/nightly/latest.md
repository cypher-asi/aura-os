# Aura-managed models, sturdier streams, and a persistent desktop shell

- Date: `2026-04-26`
- Channel: `nightly`
- Version: `0.1.0-nightly.403.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.403.1

A heavy day across the stack: chat agents gained a native image-generation tool while every model request was consolidated onto the Aura proxy, the desktop shell stopped flashing on app switches, and the server hardened auth, harness backpressure, and stream recovery. A large internal split of oversized server and Rust modules sets up cleaner ownership without changing behavior.

## 7:49 PM — Recoverable spec drafts and richer agent stream logs

Streamed spec creation now survives model timeouts, and the server emits clearer agent stream summaries for debugging.

- Streamed spec markdown is preserved when create_spec hits a model timeout, so partial drafts stay recoverable instead of vanishing, and agents are nudged away from oversized spec payloads. (`11cc781`)
- Agent chat handlers now log stream output summaries across bootstrap, persistence, and tool dispatch paths to make production stream debugging easier. (`285f4bc`)

## 8:14 PM — Desktop fails closed on an unhealthy harness sidecar

The desktop app no longer continues with a broken local harness when its startup probe never passes.

- If the managed local harness sidecar never passes its startup health probe, the desktop now kills the process and refuses to proceed instead of silently running against a broken harness. (`e2d0540`)

## 8:18 PM — Smoother task output streaming in the browser

Task output caching no longer thrashes browser storage during streaming updates.

- The IndexedDB connection is reused across operations and task-output cache writes are debounced, eliminating the per-token localStorage parse-and-rewrite that made streaming feel janky. (`bac6cf2`)

## 8:24 PM — Aura-proxied models, generate_image tool, and a persistent desktop shell

The biggest thread of the day: chat agents gained a native image generation tool, all model traffic was unified behind the Aura proxy, the middle panel now persists across app switches, and the server tightened auth, permissions, and harness backpressure.

- Chat agents can now fulfil natural-language requests like "create an image of a cat" through a new provider-less generate_image workspace tool that drains the upstream router SSE and returns a single ImageBlock-shaped result; gpt-image-2 is promoted to the default in both the chat input picker and the Aura 3D Image Generation app, and image-only models are kept out of the chat model picker. (`03c1449`, `1a897b8`)
- All model traffic now resolves through Aura-managed credits: the org_integration BYOK path and direct Anthropic, OpenAI, Gemini, xAI, and OpenRouter catalog entries are removed, harness provider config and billing checks are simplified, and the chat model picker collapses to a single Aura group. (`8b9fbd9`)
- App switches no longer flash the wallpaper: the middle ResponsiveMainLane is lifted into a persistent DesktopShell host that retains DOM identity across navigations, with a bareMainPanel opt-out so the Desktop app keeps its transparent wallpaper-bleed surface. (`c48f160`)
- The Run pane is fixed on two fronts: it now seeds rows from the authoritative project task list so reloads or cleared local storage no longer hide completed or active runs, and it queries the panel store by project instead of the viewed chat's agent id so loop runs show up the moment Run is pressed. (`6c1393c`, `5ba2be2`)
- Server hardening: stale auth fallback is capped and sensitive routes fail closed, harness WebSocket commands are bounded with explicit delivery errors and redacted frame logging, dev-loop runs now receive the same normalized agent permissions as chat sessions, and missing permission bundles default to canonical full access so harness sessions keep process invocation capabilities. (`272818e`, `2af35f3`, `442fd8a`)
- list_agents is promoted to a first-class agent capability so CEO and permission UI bundles can grant the harness tool explicitly, and new agent control callback endpoints expose a dedicated server surface for managing agents. (`9fbbd1d`, `fe50f6a`)
- Floating agent windows hide the "/ for commands" hint via a new ChatPanel compact mode, so narrow desktop agent windows no longer wrap the input info bar onto a second line. (`b9f19d3`)
- Large structural cleanups landed under the hood: the server's app_builder, auth_guard, error, generation, router, and state modules were split into focused submodules, several oversized Rust crates (agents, core entities, network types, sessions, tasks, storage testutil) were broken up, and the interface stream handlers and server-cache stores were reorganized into smaller files and query hooks. No behavior change, but ownership is clearer and future work in these areas should land more safely. (`7b0b4c0`, `1e9b8ee`, `9d3f6f3`, `06af9e7`, `d4e0fa3`, `fbb7520`)

## 1:06 AM — Desktop sidecar build re-triggered after ListAgents fix

A CI nudge to rebuild the desktop sidecar against the updated harness ListAgents capability.

- Re-triggered the desktop sidecar build so the packaged harness picks up the new ListAgents capability landed earlier in the day. (`9cd6bb3`)

## 10:12 AM — Changelog media planner stops duplicating proofs and respects mobile-only work

The release-time changelog media tooling got more discriminating about which commits warrant screenshots.

- The changelog media planner now preserves explicit media targets and de-duplicates model-picker proofs via a new duplicate-surface skip reason, so reconciliations don't repeatedly seed the same screenshot. (`697ed98`)
- Media inference seeding is hardened to skip mobile-only commits and pricing/benchmark plumbing without picker proof, recognize a debug capture surface, and route capture-bridge work through a tested helper, reducing low-signal screenshots in the published changelog. (`4561db0`)

## Highlights

- generate_image tool and gpt-image-2 default
- All model traffic now flows through the Aura proxy
- Persistent middle panel removes app-switch flash
- Harness sidecar fails closed on unhealthy startup
- Run pane restored from authoritative project tasks

