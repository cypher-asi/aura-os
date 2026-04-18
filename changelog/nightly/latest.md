# Multimodel support, smarter context handoff, and more resilient desktop packaging

- Date: `2026-04-18`
- Channel: `nightly`
- Version: `0.1.0-nightly.289.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/nightly

Today's nightly focused on a broad multimodel overhaul: hosted agents now route through AURA Proxy, model selection is wired end-to-end from the chat bar through dev-loop and task runs, and the model picker itself got a significant visual refresh. Alongside the product work, release infrastructure picked up automatic retry logic for transient Mac and Linux packaging failures.

## 12:15 AM — AURA Proxy routing and end-to-end model wiring

Hosted agents are now exclusively routed through AURA Proxy, and the actively selected model is propagated into dev-loop starts, task runs, and harness sessions.

- Hosted Aura agents now use AURA Proxy as the sole credential and billing path — the agent editor UI was simplified to reflect this, removing the previous dual-choice between 'Managed by Aura' and an org integration. (`f365b85`)
- The active model selection is now forwarded when starting or resuming a dev loop and when triggering manual task runs, so the model chosen in the UI is consistently used throughout execution. (`f4b5c6d`, `8ec261b`, `ea19f01`, `9c67479`)
- Aura-managed proxy hints are now sent to harness sessions at runtime, and Fireworks-backed OSS model aliases are exposed for selection. (`76e0e4c`, `f093cef`)

## 12:15 AM — Model catalog refresh and chat picker redesign

The model catalog was updated with current providers and Opus 4.6, the multimodel release candidate was narrowed, and the chat model picker received a significant layout and UX overhaul.

- The managed model catalog was refreshed to reflect current providers, and Opus 4.6 is now available in all Aura model pickers. (`f80524e`, `287a3aa`)
- The chat model picker was redesigned with grouped sections, section labels, a scrollable dropdown (capped at 280px), and a 'show more' affordance — making it easier to navigate a growing model list. (`494aa64`)
- When switching models mid-session, the agent now receives a snapshot of recent project specs and tasks as continuity context, preventing loss of project state across restarts or model changes. (`f2dc6b4`)
- Session event pagination was fixed to auto-paginate through full history when no explicit limit is set, preventing silent truncation at the previous 100-event server default. (`3a2dc62`)

## 2:10 AM — Mac desktop packaging reliability fix

Release Infrastructure: macOS DMG builds now automatically retry on transient hdiutil 'Resource busy' failures across nightly, stable, and validation workflows.

- All three desktop CI workflows (validate, nightly, stable) now detect and retry the intermittent macOS hdiutil 'Resource busy' error that was causing DMG packaging to fail spuriously on Mac. (`afa57d8`)

## 10:05 AM — Linux packaging retry and changelog tooling improvements

Release Infrastructure: Linux AppRun download failures now also trigger an automatic retry, and nightly changelog validation was relaxed to reduce false-positive failures.

- Linux AppImage builds now retry automatically when the AppRun binary download returns a 5xx error, complementing the earlier macOS DMG retry logic and making desktop packaging more resilient on both platforms. (`dcf5cb6`)
- Nightly changelog generation was made more permissive: strict model allowlist enforcement was downgraded from a hard error to a warning, and overly rigid rubric checks were removed to reduce unnecessary CI failures. (`e8dd6ba`, `e96e6a2`)

## Highlights

- Hosted agents now route through AURA Proxy
- Active model selection honored across chat, loops, and task runs
- Opus 4.6 added to model pickers; Fireworks-backed OSS aliases exposed
- Chat model picker redesigned with grouped sections and scrollable dropdown
- Project specs and tasks injected as continuity context on model switch
- Mac DMG and Linux AppRun packaging failures now auto-retry in CI

