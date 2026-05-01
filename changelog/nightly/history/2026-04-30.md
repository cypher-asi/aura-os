# External benchmark lane lands; desktop boot and SWE-bench reliability hardened

- Date: `2026-04-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.422.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.422.1

Today's nightly is dominated by a sweeping push to make Aura measurable against public coding benchmarks and to close the long tail of issues that surfaced once the eval pipeline started running for real. Alongside that, the desktop got a faster authenticated cold open, chat trimmed memory and visual jitter, and the packaged desktop now refuses to ship with a broken frontend bundle.

## 9:35 PM — SWE-bench and Terminal-Bench scoring lane goes live

A new external-benchmarks pipeline scores the full Aura org→spec→tasks→loop flow against SWE-bench Verified and Terminal-Bench 2, with the long tail of router, auth, harness, and prompt fixes needed to actually finish runs.

- Stood up the external benchmark lane: a SWE-bench Verified driver and Terminal-Bench 2 integration sharing a reusable benchmark-api-runner library, a manual-only GitHub workflow with cost guards and artifact uploads, and a PR-comment renderer for score deltas against committed baselines. (`acd1773`, `85290bc`)
- Added a fail-fast live-pipeline preflight that exercises auth, spec generation, task extraction, and the dev loop on a tiny fixture before each long benchmark run, plus a `--resume` mode for SWE-bench that skips already-completed instances and reuses prior run directories after a crash. (`d968e0a`, `89b23f7`, `5a03bfa`, `5f412ea`)
- Aligned project-tool sessions (spec generation, summary, task extraction) with the chat path so harness requests carry the same system prompt, provider config, and per-session billing context, eliminating the Cloudflare 403s that had been killing post-tool-result LLM calls during eval runs. (`95d4dfc`, `37f2180`, `3153bd0`, `4ab6828`, `40cd882`, `3901736`)
- Capped runaway tool loops and tightened error surfaces: project-tool sessions now bound max_turns and have server-side deadlines, the JS benchmark client uses an AbortController-backed fetch timeout, and the chat-route generate_specs/extract_tasks actions are also gated so the model can't loop list_specs→create_spec for minutes. (`4d137da`, `4b80362`, `4cffca5`)
- Fixed the local-stack harness wiring to mirror desktop sidecar behavior: AURA_LISTEN_ADDR matches the real desktop spawn, control-plane URLs (server, storage, network, orbit) are stamped from the running stack, and the harness now inherits LLM routing from its own .env so eval traffic stops getting amplified into Cloudflare retry storms. (`32a9a19`, `9f8c598`, `42503fc`, `984af20`, `ad54c92`, `fc2ca01`)
- Closed wire-format gaps that were silently failing eval writes: CreateTaskBody/UpdateTaskBody now accept camelCase, TransitionTaskRequest accepts a `status` alias, and the harness's create_task/transition_task calls land cleanly instead of looping on 422s. (`ba31352`, `c6a03cc`)
- Collapsed the harness LLM path to AURA proxy only — direct-provider routing, routing_mode, and api_key fields are gone from SessionConfig, replaced by a slim SessionModelOverrides — and reshaped image and 3D generation to flow through the same harness session as chat. (`982a677`, `5e19d27`)
- Sharpened SWE-bench output quality: prompts now require semantic local validation, patch self-review, and a no-change completion contract for verification-only tasks; runs can retry unresolved instances with official failure context; and aggregation emits machine-readable plus markdown postmortems bucketed by failure mode. (`e42f98a`, `0ed8628`, `139dbda`, `d031160`, `07e4753`, `64ca62a`, `9e5bf10`, `310f3c7`, `fc6438b`, `a1aa55a`, `2b86cd0`)
- Improved authenticated cold-open and runtime perf on desktop: a branded splash now renders before app-ready while still gating on the authenticated route, startup defers highlight themes and sidekick panes, the server quiets default tracing and caches fingerprinted assets, and event hub fanout shares ref-counted payloads instead of cloning per listener. (`9f76ae2`, `4993abf`, `3ee409c`, `a776d74`, `162698d`, `63a3e98`, `b638289`)
- Tightened chat reliability and memory: per-frame batching of websocket events for long transcripts, bounded retained history and normalized message maps, removal of the paint-containment hint that caused end-of-turn message blink, and a fix for duplicate live assistant rendering in project chats. (`4b7565e`, `1eca7c5`, `f88e1aa`, `4df4121`, `879112d`, `7b003e3`)
- Pro tier pricing reverted to $20 after the migration, with the surrounding subscription modal preparing for the legacy-pricing note shown to OG users. (`cbf003b`)

## 9:57 AM — Native Windows SWE-bench verification gets a per-instance Python venv

SWE-bench DoD verification on native Windows now bootstraps a compatible per-instance virtualenv before running tests, so agents stop producing patches that work around a missing global Python.

- Bootstrap a per-instance Python venv before native Windows SWE-bench verification so the DoD gate uses a compatible interpreter instead of falling back to the global Python and pushing agents into environment-workaround patches. (`74726ee`)

## 10:29 AM — Legacy-price note for Zero Pro OG users in the tier modal

Subscription UI now calls out the original Pro pricing for OG users and renames the credit history label to better describe what it represents.

- Added a legacy-price note on the Pro card in the tier subscription modal for Zero Pro OG users, with a follow-up tweak to render it on its own line beneath the price. (`d9776a3`, `dadfd29`, `d777b4b`)
- Renamed "Monthly Allowance" to "Monthly Plan Top-Up" in the org credit history view to better describe what users are seeing. (`dadfd29`)

## 7:07 PM — SWE-bench verification flow hardened end-to-end

A second pass on the SWE-bench verification flow tightens spec/task tool hints, the live preflight, and the chat panel, and stops local SWE run artifacts from polluting the working tree.

- Scoped tool hints for spec generation and task extraction to the project-and-spec surface (no run_command, no create_task during spec gen), required task extraction to actually produce tasks before reporting success, and tightened the live-pipeline preflight and chat panel along the same path. (`e22a0b3`)
- Added local SWE run output directories to .gitignore so eval artifacts no longer show up as untracked files in the repo. (`4b95a86`)

## 7:12 PM — TypeScript bindings for aura-protocol checked in

Generated TypeScript types for the harness wire protocol are now committed alongside the Rust crate, giving the interface a stable, reviewable source of truth for session, tool, and generation messages.

- Checked in 48 ts-rs–generated TypeScript bindings under crates/aura-protocol/bindings/ covering SessionInit, SessionModelOverrides, agent permissions, tool approvals, generation messages, and the inbound/outbound message envelopes — making protocol drift visible in code review instead of only at runtime. (`56e3e85`)

## 9:26 PM — Packaged desktop boot failures now fail CI instead of users

A new boot-diagnostics layer plus release-asset validation in the nightly and stable workflows means a broken packaged frontend bundle is caught in CI rather than leaving users staring at an endless splash.

- Added production boot diagnostics and a boot-shell module on the interface side, wired init-script changes on the desktop app, and introduced release-asset validation scripts plus a desktop-validate workflow so nightly and stable releases reject builds whose packaged frontend bundle won't actually start. (`07a20d5`)

## Highlights

- SWE-bench Verified and Terminal-Bench 2 scoring lanes now wired end-to-end
- Desktop cold open shows a branded splash without flashing a logged-out state
- Packaged desktop boot failures now fail CI instead of stranding users on a splash
- Pro tier pricing reverted to $20 with legacy note for OG users
- Chat trims retained history and stops end-of-turn message blink

