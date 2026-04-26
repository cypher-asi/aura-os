# Aura-managed model routing, persistent shell, and harness hardening

- Date: `2026-04-26`
- Channel: `nightly`
- Version: `0.1.0-nightly.406.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.406.1

A dense nightly: model traffic now flows through Aura's managed proxy with a single chat picker, the desktop shell keeps its middle panel mounted across app switches, and a wave of server and harness fixes tighten auth, permissions, and sidecar startup. Big internal module splits set the stage without changing behavior, and the changelog media planner got smarter at filtering noisy candidates.

## 7:49 PM — Recoverable spec drafts when the model times out

Streamed spec markdown is now preserved across model timeouts, with extra server-side telemetry on agent stream output.

- create_spec drafts are kept recoverable when a model timeout interrupts streaming, and agents are nudged away from oversized spec payloads so partial work isn't lost. (`11cc781`)
- Server-side agent stream output now emits summary logs to make it easier to diagnose chat and tool flows in production. (`285f4bc`)

## 8:14 PM — Desktop fails closed on an unhealthy harness sidecar

The desktop app no longer continues with a broken local harness when its startup health probe never passes.

- If the managed local harness sidecar fails its startup health probe, the desktop now kills the process and refuses to proceed instead of silently running against a wedged sidecar. (`e2d0540`)

## 8:18 PM — Smoother task output streaming in the browser

Task-output persistence stops thrashing storage during streaming updates.

- Task-output cache writes are now debounced and reuse a single IndexedDB connection across browser storage operations, removing the per-token localStorage parse/rewrite churn that caused jank during streaming. (`bac6cf2`)

## 8:24 PM — Aura-managed model proxy, persistent shell, and a generate_image tool

The day's biggest batch reshapes model routing, the desktop shell, and agent capabilities, alongside large internal module splits and a sweep of reliability fixes.

- All model traffic now routes through the Aura proxy: the org_integration BYOK path and direct Anthropic/OpenAI/Gemini/xAI/OpenRouter catalog entries are removed, the agent editor migrates legacy org-backed agents, and the chat model picker collapses to a single Aura group. (`8b9fbd9`, `1a897b8`)
- Image generation defaults to gpt-image-2 across the chat input and the Aura 3D Image Generation app, and a new provider-less generate_image workspace tool lets chat agents fulfil natural-language image requests without invoking the /image slash command. (`03c1449`)
- The desktop shell now hosts a persistent ResponsiveMainLane so the middle panel keeps DOM identity across app switches, eliminating the wallpaper-through-flash; a new bareMainPanel flag preserves the Desktop app's transparent surface. (`c48f160`, `9d3f6f3`)
- Server hardening: stale auth fallback is capped with sensitive routes failing closed, harness WebSocket commands are bounded with explicit delivery errors and redacted frame logging, and dev-loop runs now receive the same normalized agent permissions as chat sessions, with missing bundles defaulting to full access. (`272818e`, `2af35f3`, `442fd8a`)
- Run pane fixes: rows are seeded from the authoritative project task list so reloads don't hide completed or active runs, and loop runs now show up regardless of which chat the user is viewing because the panel queries by project rather than agentInstanceId. (`6c1393c`, `5ba2be2`)
- Agent capabilities gain a first-class list_agents permission with new control callback endpoints and synced wire types, so CEO and permission UI bundles can grant the harness tool explicitly. Floating agent windows also drop the '/ for commands' hint to keep narrow input bars on a single line. (`fe50f6a`, `9fbbd1d`, `fbb7520`, `b9f19d3`)
- Large structural cleanups land without behavior changes: the aura-os-server crate splits app_builder, auth_guard, error, generation, router, and state into focused modules; core Rust crates break up entities, permissions, sessions, and tasks; and the interface splits stream handlers and routes server caches through queries. (`7b0b4c0`, `1e9b8ee`, `d4e0fa3`, `06af9e7`)

## 1:06 AM — Sidecar build re-triggered after the ListAgents harness fix

A no-op CI nudge to rebuild the desktop sidecar against the new list_agents capability.

- Re-triggered the desktop sidecar build so the packaged harness picks up the new ListAgents capability wired earlier in the day. (`9cd6bb3`)

## 10:12 AM — Smarter changelog media planner targeting

The changelog media planner gets better at picking publishable proof shots and ignoring noisy candidates.

- Media planner now preserves intended targets, skips mobile-only and pricing/benchmark plumbing without picker proof, deduplicates model-picker surfaces, and learns from historical media misses via a lessons file. Token-only candidates are also filtered out. (`697ed98`, `4561db0`, `6102050`, `7941c91`, `80889ff`)
- The Debug app is now a recognized seeded capture surface, with capture-bridge gaining hardened seeding for run history, event timelines, counters, and the sidekick inspector. (`4561db0`, `6102050`)

## Highlights

- Image generation defaults to gpt-image-2 with a new generate_image agent tool
- All model traffic routes through the Aura proxy, collapsing the chat picker
- Middle panel persists across app switches, eliminating the wallpaper flash
- Desktop fails closed when the local harness sidecar never gets healthy
- Stale auth, harness backpressure, and dev-loop permissions tightened

