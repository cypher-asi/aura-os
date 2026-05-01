# Cold-start polish, external benchmark lane, and a long SWE-bench reliability push

- Date: `2026-04-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.421.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.421.1

A heavy day across the stack: Aura's desktop boot got noticeably faster and steadier, a brand-new external benchmark lane for SWE-bench Verified and Terminal-Bench 2 landed, and the eval infrastructure went through a multi-hour reliability marathon to keep automation traffic from tripping Cloudflare. Smaller polish hit the chat surface, the pricing modal, and protocol bindings.

## 9:35 PM — Desktop cold-start performance wave

A coordinated push tightened the authenticated cold-open path, deferred heavy work off the critical path, and bounded long-running memory growth in chat.

- Desktop cold opens now reveal an auth-neutral splash while preserving the no-login-flash authenticated route, with startup readiness budgets captured as guardrails so this stays measurable. (`63a3e98`, `9f76ae2`)
- Trimmed the critical path: highlight themes load lazily, Sidekick output panes defer, route/project loaders use lightweight fallbacks, and Projects/Tasks chunks preload on hover. Sidebar churn dropped via the existing virtualizer plus debounced search. (`4993abf`, `3ee409c`)
- Chat transcripts batch non-terminal websocket events per animation frame and cap retained history so long sessions no longer grow unbounded; a duplicate-render and end-of-turn message blink were both fixed afterward. (`4b7565e`, `1eca7c5`, `f88e1aa`, `4df4121`, `879112d`)
- Server logs are quieter by default, fingerprinted interface assets are compressed and cached, and cross-project log aggregation is bounded; domain events are also fanned out via shared, ref-counted payloads instead of per-listener clones. (`a776d74`, `162698d`)
- Sidebar fade bands in the left navigation and Sidekick panel were halved so list content is less obscured. (`b638289`)
- New external benchmark lane scores the full Aura pipeline against SWE-bench Verified and Terminal-Bench 2, with a manual GitHub workflow, cost guard, baselines, PR-comment renderer, and a fail-fast live preflight that exercises auth, spec generation, task extraction, and the dev loop on a tiny fixture before any long run. (`acd1773`, `85290bc`, `d968e0a`, `5a03bfa`, `5f412ea`)
- SWE-bench runs gained --resume support: completed instances are skipped, predictions.jsonl is deduplicated, workspaces are reused when HEAD already matches base_commit, and score.json is synthesized from incremental runs even if the driver was killed. (`89b23f7`, `37f2180`)
- Dev-loop and project-tool sessions now match the chat path's router shape end-to-end: stable v5 session ids per (project, instance, task), threaded org/session ids and template agent identity, full SessionInit-equivalent payload (system prompt, provider overrides, classifier context), and consistent harness URL and env handling. This was the underlying fix for repeated Cloudflare 403s on automation traffic against aura-router. (`3153bd0`, `4ab6828`, `40cd882`, `3901736`, `85aa438`, `ad54c92`, `fc2ca01`)
- Project-tool sessions are now bounded against runaway LLM loops with a max_turns cap, a server-side tokio deadline, and an AbortController-based fetch timeout, applied to both the dedicated endpoints and the chat-route generate_specs/extract_tasks actions. CreateTask/UpdateTask and TransitionTask DTOs accept camelCase and a status alias so harness writes stop 422'ing and looping. (`4d137da`, `4b80362`, `ba31352`, `c6a03cc`)
- Local eval stack got a long stabilization arc: shared auth/token sourcing with the app, dev JWT trust for local services, harness URL overrides so domain writes hit the right port, proxy-only routing, an LLM-path preflight probe with Cloudflare classification, and per-instance harness env that finally mirrors the desktop sidecar. (`b32d0aa`, `bea6a03`, `ba018d5`, `1e50bd6`, `576c900`, `f00ffc8`, `32a9a19`, `9f8c598`, `42503fc`, `984af20`, `1ddf91e`, `8d00651`, `5bb4cb3`)
- SWE-bench task generation was reshaped: prompts now steer toward one patch-producing task per instance, require self-review and the strongest safe local validation before completion, gate completion on the configured Python test command, and document the no-change completion contract for verification-only work. Aggregation now emits machine-readable and markdown postmortems bucketed by failure mode, with retry support for unresolved instances. (`e42f98a`, `0ed8628`, `139dbda`, `d031160`, `9e5bf10`, `07e4753`, `64ca62a`, `2b86cd0`, `5698a2f`, `fc6438b`)
- Cloudflare-blocked SWE-bench runs are now classified, throttled, and excluded from scoring instead of being amplified by parallel scheduling or producing misleading patches; harness log noise was also collapsed to one salient line per tool call. (`a1aa55a`, `310f3c7`, `95d4dfc`, `6ca179b`)
- Image and 3D generation requests now flow through the harness session machinery instead of a separate router proxy, unifying the streaming path used by chat with media generation. (`5e19d27`)
- Harness LLM transport collapsed to AURA proxy only: the wire now carries model overrides instead of a full provider config, and the direct-provider path was removed from both server and local-stack tooling. (`982a677`)
- Local harness chat sessions skip the Aura proxy override and keep failed stream errors visible after history refresh, so the local harness UX stops swallowing errors mid-turn. (`7b003e3`)
- Dev-loop completed tasks now record git push timeout evidence after a local commit so they remain recoverable instead of appearing fully synced when the push hangs. (`3762db7`)
- End-to-end SWE diagnostics: instance routes log session shape on each chat-events stream open, request-profile analyzer and contract reporting libraries landed, and per-run request profiles can be aggregated for postmortem. (`4cffca5`)

## 9:16 AM — Pro tier price restored to $20

The TierSubscriptionModal was rolled back to the $20 Pro price now that the migration is complete.

- Pro tier in the subscription modal is back to $20 after the pricing migration finished. (`cbf003b`)

## 9:57 AM — Per-instance Python venv for native SWE verification

Native Windows SWE-bench runs now bootstrap a compatible per-instance venv before the DoD gate runs, instead of falling back to a global Python that pushes agents toward environment workaround patches.

- SWE-bench's DoD verification on native Windows now provisions a per-instance virtualenv up front so verification runs in a clean, version-matched interpreter rather than the operator's global Python. (`74726ee`)

## 10:29 AM — Legacy pricing note for Zero Pro OG users

Long-time Zero Pro subscribers now see context for their grandfathered pricing in the tier modal and credit history surfaces.

- Added a legacy pricing note for Zero Pro OG users in the tier subscription modal, surfaced it on the Pro card, and renamed the Monthly Allowance row to Monthly Plan Top-Up in credit history. A follow-up moves the legacy note to its own line below the price for cleaner layout. (`d9776a3`, `dadfd29`, `d777b4b`)

## 7:07 PM — SWE verification flow hardening

Spec generation and task extraction now ship scoped tool hints, task extraction fails loudly when no tasks are produced, and local SWE artifacts stay out of git.

- Spec generation and task extraction now pass explicit, scoped tool_hints to the harness so the model stops reaching for unrelated tools, and extract_tasks now returns a clear error when the harness completes without persisting any tasks instead of silently returning empty. (`e22a0b3`)
- Local SWE-bench run artifacts are now ignored by git so per-run output stops cluttering working trees. (`4b95a86`)

## 7:12 PM — Checked-in TypeScript protocol bindings

aura-protocol's ts-rs-generated TypeScript types are now committed, giving the interface a stable, versioned source of truth for wire shapes.

- Checked in 48 generated TypeScript binding files for aura-protocol (SessionInit, SessionModelOverrides, AssistantMessageEnd, GenerationRequest, tool/permission wires, and more), so the interface no longer needs to regenerate them locally to stay in sync with the Rust protocol. (`56e3e85`)

## Highlights

- Desktop cold-open shows an auth-neutral splash and defers heavyweight assets
- New external benchmark lane: SWE-bench Verified + Terminal-Bench 2
- Resume-able SWE-bench runs with live preflight that fails in minutes, not hours
- Dev-loop traffic now matches chat's router shape to stop Cloudflare blocks
- Pro tier price returned to $20 with a legacy note for OG users
- TypeScript protocol bindings are now checked in

