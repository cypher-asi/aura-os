# Clearer chat recovery, mobile release hardening, and a refreshed model lineup

- Date: `2026-09-14`
- Channel: `nightly`
- Version: `0.1.0-nightly.836.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.836.1

Today's nightly tightens how Aura recovers from dropped chat streams, sharpens the language around restarting turns and council roles, and cleans up the model picker so only providers that are actually live are offered. On the platform side, the desktop harness now reliably talks back to the right local server, and the mobile release pipelines gained stronger guardrails for iOS and Android store uploads.

## 9:38 AM — Restart turn button and council role labels get plain-language wording

Chat error affordances and Council Panel copy were rewritten so users understand what restarting a turn actually does and what each council slot contributes.

- Renamed the inline Retry control on dropped messages and the Stuck Stream pill to "Restart turn," with a tooltip clarifying it resends the original prompt from the start rather than resuming unfinished work. (`a4907e2`)
- Replaced the Council Panel's cryptic "slot 0" mechanism subtitles with human-readable descriptions like "1st member compares answers," and let the header wrap on narrow layouts. (`a4907e2`)

## 10:45 AM — Desktop sidecar receives the real bound API address

The managed local harness spawned by the desktop app now explicitly inherits the parent's server URL, preventing it from calling a stale channel or port from its own environment.

- The desktop app now passes its bound server URL into the harness via a new AURA_OS_SERVER_URL environment variable, routed through a shared configure_sidecar_command helper used by both the initial spawn and the fallback retry. (`68f6543`)
- Added an end-to-end test that runs a real child process and asserts the managed harness issues its project and specs callbacks against the parent-provided address, catching cases where inherited .env values would otherwise win. (`68f6543`)

## 2:08 PM — Interrupted chat turns reattach instead of silently resubmitting

The chat stream layer was reworked so a dropped connection can reattach to an in-flight turn and rebuild its view without duplicating tool bubbles or replaying the user's prompt behind their back.

- Introduced a resetStreamForReplay path that clears transient assistant boundaries after the last user message while relying on event-id dedupe for persisted events, so a full replay no longer leaves duplicate intermediate tool calls in the transcript. (`acaddac`)
- The agent chat stream now discovers reattachable active streams and resumes them in place, even across agent switches, instead of migrating the turn to a different agent. (`acaddac`)
- Updated the dropped-stream message from "recovered from history" to "Refresh to check saved progress. Restart turn sends your prompt again," aligning the copy with the new Restart turn semantics. (`acaddac`)

## 11:51 AM — Mobile task hooks stabilized and iOS/Android release lanes hardened

A broad mobile pass tightened the useMobileTasks lifecycle and added guardrails around the native release pipelines for both stores, plus a new mobile-quality workflow and readiness docs.

- Reworked useMobileTasks with expanded test coverage to stabilize task update behavior, and reorganized the mobile shell with a new settings destination helper, extracted public landing/chat views, and a relocated theme toggle. (`ab0ea4e`)
- Android and iOS workflows now default to the production api.aura.ai host, only cancel in-progress runs for pull requests so store uploads are never interrupted, and validate the Android upload keystore secret before decoding it into the runner temp dir. (`ab0ea4e`)
- Expanded Android release track options to include alpha and beta alongside internal and production, and moved iOS build numbering to a deterministic run-number-derived value. (`ab0ea4e`)
- Added a native-release-host validator script, a new mobile-quality workflow, Fastlane test coverage, and a mobile engineering readiness doc to codify the release checklist. (`ab0ea4e`)

## 1:02 PM — Model picker cleanup: retire dead providers and restore DeepSeek routing

The chat model catalog was pruned to remove providers that production reports as unavailable, then DeepSeek and Kimi K3 routing was fixed and repriced against their live Fireworks hosting.

- Hid Claude Mythos 5.1, DeepSeek v4 Pro/Flash, MiniMax M2.7, GLM 5.1, and Qwen3 7 Plus from the model picker, and made saved selections for any of those retired IDs fall back to the default chat model on load. (`3164381`)
- Restored DeepSeek v4 Pro and Flash as live routes with dated variants (deepseek-v4-pro-0813, deepseek-v4-flash-0731) and updated per-million-token pricing to the current Fireworks rates. (`98fe6c1`)
- Aura-managed Kimi K3 now resolves to Fireworks pricing while direct moonshot/kimi-k3 requests keep Moonshot rates, avoiding double-charged cached prompt tokens. (`98fe6c1`)

## Highlights

- Interrupted chat turns reattach without silently resending prompts
- Retired providers hidden and DeepSeek routes restored with updated pricing
- Mobile store lanes hardened across iOS and Android
- Desktop sidecar now inherits the correct bound API address

