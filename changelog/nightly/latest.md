# External benchmark lane lands; packaged desktop hardening

- Date: `2026-04-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.423.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.423.1

A heavy day dominated by standing up Aura's external benchmark pipeline (SWE-bench Verified and Terminal-Bench 2) and the long debugging tail that came with it: router/Cloudflare parity with the chat path, harness env alignment with the desktop sidecar, and a much stricter SWE verification flow. On the product side, startup performance got real attention, the packaged desktop got hardened against silent boot failures, and Pro pricing copy was reconciled for legacy subscribers.

## 9:35 PM — External benchmark lane for SWE-bench and Terminal-Bench

A new manual-only benchmark lane scores the full Aura pipeline against SWE-bench Verified and Terminal-Bench 2, with resumable runs, fail-fast preflights, and postmortem reporting.

- Stood up an end-to-end external benchmark lane: a SWE-bench Verified driver and Terminal-Bench 2 integration that share a reusable benchmark-api-runner library, a workflow_dispatch GitHub Actions workflow on self-hosted runners with per-run cost guards, and a PR-comment renderer that diffs scores against committed baselines. (`acd1773`, `85290bc`)
- Added a fail-fast live-pipeline preflight that exercises auth import, agent/project CRUD, SSE spec generation, task extraction, and the dev loop on a tiny fixture before each long run, so broken router/proxy/harness wiring aborts in 1–2 minutes instead of after multiple hours. (`d968e0a`, `5a03bfa`, `5f412ea`)
- SWE-bench runs are now resumable: --resume reuses the most recent run directory, skips already-completed instances, deduplicates predictions.jsonl, reuses workspace clones when HEAD matches base_commit, and synthesizes driver-summary.json from per-instance records when the driver was killed mid-run. (`89b23f7`)
- Surfaced benchmark progress with a tailing harness-log follower that collapses per-token tool snapshots into one salient line per event, and added cached zOS login credentials so repeat manual SWE runs skip the prompt. (`6ca179b`, `95d4dfc`, `37f2180`)
- Tightened SWE verification: no-change task contracts, semantic local validation before completion, mandatory patch self-review, retries of unresolved instances with official failure context, machine-readable + markdown postmortems bucketing failures by mode, and gating completion on the configured Python test command. (`e42f98a`, `139dbda`, `d031160`, `07e4753`, `64ca62a`, `9e5bf10`, `0ed8628`)
- Cold-open performance pass: an auth-neutral splash now paints during desktop boot while the authenticated route preload gate is preserved, highlight themes and Sidekick panes lazy-load, route/project loading frames use lightweight fallbacks, and chat events are batched per animation frame with a paint-containment hint that was later reverted to fix end-of-turn message blink. (`9f76ae2`, `4993abf`, `4b7565e`, `3ee409c`, `63a3e98`, `4df4121`, `879112d`)
- Bounded long chat sessions and tightened server overhead: in-memory chat history and normalized message maps are now capped, domain events are ref-counted across hub fanout, default tracing noise is reduced, fingerprinted interface assets are compressed and cached, and cross-project log aggregation work is bounded. (`1eca7c5`, `f88e1aa`, `162698d`, `a776d74`)
- Resolved a multi-day Cloudflare-403 storm on automation traffic by aligning dev-loop and project-tool sessions with the chat path: spec generation now drives through the chat events stream, project-tool sessions populate system_prompt and provider_config, dev-loop automaton starts carry stable org/session/agent identity (UUIDv5 over project+instance+task), and the harness LLM path was collapsed to AURA proxy only. (`85aa438`, `3153bd0`, `4ab6828`, `40cd882`, `982a677`, `3901736`)
- Hardened harness loop hangs and Cloudflare retry storms: project-tool sessions are capped at max_turns=40 with a server-side tokio deadline and an AbortController-driven fetch timeout on the JS client, chat-route tool actions inherit the same caps, and Cloudflare-blocked SWE runs now fail fast and stop scheduling instead of producing misleading patches. (`4d137da`, `4b80362`, `a1aa55a`, `fc6438b`, `310f3c7`)
- Aligned the local-stack eval harness with the production desktop sidecar spawn: AURA_LISTEN_ADDR, AURA_OS_SERVER_URL, storage/network/orbit URL overrides, --release builds, and dotenvy precedence now match sidecar.rs exactly, and a new preflight-llm.sh probe classifies Cloudflare WAF, JWT, billing, and connectivity failures from a single tiny request. (`32a9a19`, `9f8c598`, `42503fc`, `984af20`, `ad54c92`, `fc2ca01`, `1ddf91e`)
- Wire-format fixes that unblocked harness writes: CreateTaskBody/UpdateTaskBody now accept camelCase plus a dependencyTaskIds alias, TransitionTaskRequest accepts a status alias for new_status, image and 3D generation now route through the harness, and chat correctly preserves stream errors on local harness sessions. (`ba31352`, `c6a03cc`, `5e19d27`, `7b003e3`)
- Bootstrapped local-stack auth: print-auth-token reads from the core app settings store, bootstrap-auth seeds Git-for-Windows helper paths and falls back to AURA_EVAL_USER_EMAIL/PASSWORD via /api/auth/login, dev JWT trust is rendered explicitly for local aura-network and aura-storage, and a stale .gitignore path for stack.env was corrected after the infra/ relocation. (`bea6a03`, `ba018d5`, `1e50bd6`, `576c900`, `f00ffc8`, `8d00651`)
- Dev-loop and harness diagnostics expanded: deeper SWE request-shape logging across chat and dev-loop session config, dev-loop git-push timeout evidence is now persisted so completed tasks stay recoverable, and the dev-loop automaton-start payload now mirrors chat/spec SessionInit fields end-to-end. (`4cffca5`, `3762db7`, `3901736`)
- Polished the desktop shell with halved sidebar/Sidekick fade bands and reverted the Pro tier price to $20 now that the migration is complete. (`b638289`, `cbf003b`)

## 9:57 AM — Per-instance Python venv for native SWE verification

Native Windows SWE-bench runs now bootstrap a compatible per-instance Python virtualenv before the DoD verification step.

- Bootstrap a compatible per-instance Python venv before native Windows SWE verification so the definition-of-done gate stops falling back to global Python and pushing agents toward environment-workaround patches. (`74726ee`)

## 10:29 AM — Legacy pricing note for Zero Pro OG subscribers

The tier modal and credit history now flag legacy pricing for original Pro users alongside a clearer credit label.

- Surface a legacy pricing note on the Pro card for Zero Pro OG users, place it on its own line beneath the price, and rename Monthly Allowance to Monthly Plan Top-Up in org credit history. (`d9776a3`, `dadfd29`, `d777b4b`)

## 7:07 PM — Stricter SWE verification flow and run-artifact hygiene

Spec generation and task extraction get scoped tool hints, task extraction fails loudly when no tasks land, and local SWE run artifacts are no longer tracked.

- Scoped spec-generation and task-extraction tool hints to the relevant project/spec/task surface, made extract_tasks return an explicit error when the harness completes without creating any tasks, and updated ChatPanel handling along with preflight and benchmark runner glue. (`e22a0b3`)
- Added local SWE-bench run artifacts to .gitignore so reports and workspaces stop showing up as untracked files. (`4b95a86`)

## 7:12 PM — Checked-in TypeScript bindings for aura-protocol

Generated ts-rs bindings for the aura-protocol wire types are now committed alongside the Rust crate.

- Committed 48 generated TypeScript binding files for aura-protocol wire types — SessionInit, SessionModelOverrides, AgentPermissionsWire, ToolCallSnapshot, GenerationRequest, and friends — so the interface can consume the harness/protocol shapes without a separate codegen step at build time. (`56e3e85`)

## 9:26 PM — Packaged desktop boot diagnostics and single-instance guard

Production desktop builds now fail loudly on broken frontend bundles and refuse to launch duplicate instances on Windows.

- Added production boot diagnostics and a release-asset validator wired into desktop-validate, release-nightly, and release-stable workflows so a broken packaged frontend bundle fails CI instead of leaving users on an endless splash screen. (`07a20d5`)
- Hardened the packaged desktop launch by avoiding the Vite/Rolldown dynamic CSS chunk crash in production builds and adding a Windows single-instance guard so installer and update launches cannot leave duplicate Aura instances running. (`5ee87d5`)

## Highlights

- External SWE-bench + Terminal-Bench lane shipped end-to-end
- Cold-open splash and chat streaming perf overhaul
- Packaged desktop now fails loudly instead of stalling on a blank splash
- Pro tier reverted to $20 with a legacy-pricing note for OG users

