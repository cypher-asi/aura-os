# Mobile iOS goes first-class, model traffic unifies on Aura

- Date: `2026-04-26`
- Channel: `nightly`
- Version: `0.1.0-nightly.407.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.407.1

A heavy day across the stack: a brand-new first-class iOS experience landed alongside a desktop-isolation follow-up, agents now route exclusively through the Aura proxy, and a wide reliability sweep tightened streaming, permissions, and the harness sidecar. Server and Rust internals were also reorganized to keep the platform maintainable as it grows.

## 7:49 PM — Recoverable spec drafts and richer agent stream logs

Streaming spec creation now survives model timeouts, and server-side agent stream output gained summary logging for easier debugging.

- Streamed spec markdown is preserved when create_spec times out, so users no longer lose drafted specs to model interruptions, with guidance to keep payload sizes in check. (`11cc781`)
- Agent chat streaming, persistence, and tool dispatch paths now emit output summaries to make production agent runs easier to trace. (`285f4bc`)

## 8:14 PM — Desktop harness sidecar fails closed on unhealthy startup

The desktop app no longer continues with a broken local harness when the startup health probe never passes.

- The managed local harness sidecar is now killed if it never passes its startup health check, preventing the desktop from booting into a silently broken agent runtime. (`e2d0540`)

## 8:18 PM — Aura proxy becomes the only path for model traffic

A wide-ranging session covering a unified model-routing refactor, persistent middle panel, run-pane fixes, permission plumbing, and large internal module splits.

- All chat agents now route through the Aura-managed proxy: the BYOK org_integration auth path and direct Anthropic/OpenAI/Gemini/xAI/OpenRouter catalog entries were removed, the chat model picker collapsed to a single Aura group, and image-only models are filtered out of the chat picker. (`8b9fbd9`, `1a897b8`)
- gpt-image-2 is now the default image model and a new provider-less generate_image tool lets chat agents fulfill natural-language image requests without needing the /image slash command, with mock-router tests covering the streaming happy path and error cases. (`03c1449`)
- The middle panel is lifted into the desktop shell and stays mounted across app switches, eliminating the wallpaper-flash size snap during navigation; a new bareMainPanel flag preserves the Desktop app's transparent surface. (`c48f160`, `9d3f6f3`)
- Run pane reliability improved: completed/failed/active runs are seeded from the authoritative project task list so reloads no longer hide history, and the pane now scopes by project so loop runs show up regardless of which chat agent is being viewed. (`6c1393c`, `5ba2be2`)
- Task output streaming feels smoother: a shared IndexedDB connection plus debounced cache writes stop streaming updates from repeatedly parsing and rewriting localStorage. (`bac6cf2`)
- Server hardening capped stale auth fallbacks, made sensitive routes fail closed, and bounded harness WebSocket commands with explicit delivery errors and redacted frame logging. (`272818e`)
- Agent permissions are now consistent across surfaces: dev-loop runs receive the same normalized capability bundle as chat sessions, missing permission bundles default to canonical full access, list_agents is a first-class capability, and new agent control callback endpoints expose runtime hooks. (`2af35f3`, `442fd8a`, `9fbbd1d`, `fe50f6a`, `fbb7520`)
- Floating agent windows hide the '/ for commands' hint via a new compact ChatPanel/ChatInputBar flag so the input bar stops wrapping in narrow surfaces, while image/3D mode indicators remain. (`b9f19d3`)
- Large server, crate, and interface modules were broken up — app_builder, auth_guard, error, generation, router, core entities, sessions, storage testutil, task service, and stream handlers — and billing/leaderboard caches were moved behind queries, keeping the codebase navigable as the platform grows. (`7b0b4c0`, `1e9b8ee`, `d4e0fa3`, `06af9e7`)

## 1:06 AM — CI re-trigger after harness ListAgents fix

A pipeline re-run picked up the new list_agents capability for the desktop sidecar build.

- Desktop sidecar build was re-triggered to ensure the harness ListAgents fix is included in shipped artifacts. (`9cd6bb3`)

## 10:12 AM — Changelog media planner gets smarter and more accurate

A focused pass on the changelog media tooling improved how surfaces are inferred, seeded, and validated, reducing missed or wrong screenshots in release notes.

- Media planner now preserves declared targets, hardens inference seeding, broadens surface coverage, and learns from historical misses via a lessons store, while filtering out token-only candidates that produced low-signal matches. (`697ed98`, `4561db0`, `6102050`, `7941c91`, `80889ff`)

## 4:16 PM — First-class iOS mobile views with desktop isolation

A dedicated mobile iOS experience shipped with its own shell, screens, and chat surfaces, followed by an isolation pass that prevents mobile changes from leaking into the desktop layout.

- iOS becomes a first-class target with a Capacitor config, AppDelegate, dedicated mobile chat header and input bar, and full project screens for Agents, Files, Process, and Stats — validated against an iPhone simulator sign-off matrix covering navigation, drawers, keyboard behavior, and tab transitions. (`8b9c310`)
- Mobile code was relocated under interface/src/mobile (shell, navigation, screens, chat, files), with new MobileSettingsView and MobileChatPanel; the desktop SettingsView was restored after a regression where the mobile settings screen had replaced it on /projects/settings. (`e688532`)
- A mobile-boundary test and route-level isMobileLayout switch enforce that desktop routes never render mobile chrome, backed by a desktop regression sign-off matrix across agents, projects, files, tasks, run, process, stats, feed, profile, integrations, and settings. (`e688532`)

## Highlights

- First-class iOS mobile experience
- All model traffic unified through the Aura proxy
- Desktop harness sidecar fails closed on bad health
- Natural-language image generation via new tool
- Server and crate modules restructured for maintainability

