# Editable skills, Loop Engineering mode, and a sturdier chat turn

- Date: `2026-06-18`
- Channel: `nightly`
- Version: `0.1.0-nightly.695.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.695.1

A substantial day for Aura: user-authored skills become editable end-to-end, a new Loop Engineering automation mode lands, and the chat turn gets meaningfully more resilient — from billing pre-flights that survive a cold start to an input bar that no longer eats rapid multiline prompts.

## 8:12 AM — Editable user skills, retried credit pre-flights, and stronger eval probes

A morning block focused on making user-authored skills first-class and the chat turn more tolerant of upstream hiccups, alongside tighter observability for multi-agent workflows.

- User-authored skills are now editable end-to-end: a new PUT /api/harness/skills/mine/{name} endpoint rewrites SKILL.md through a shared frontmatter renderer, and the Agents panel gains an Edit skill action backed by a pre-filled editor modal that preserves allowed_tools, model, and context fields the UI doesn't surface. The edit path also fails loud with a 502 if the harness re-register fails, so disk and the in-memory registry can't silently diverge behind a 200. (`2e93d47`)
- Chat turns no longer 502 on a single billing blip: require_credits now retries transient transport errors and 5xx responses with short 100ms/250ms backoffs, while definitive answers like insufficient credits return immediately. Only positive results are cached, so a momentary outage can't linger as a stale negative. (`6e18142`)
- Multi-agent workflow status probes now assert against persisted child-thread evidence (sessionId, childRunId, session subagent thread match/completion) instead of softer context-utilization heuristics, making the subagent and A2A roundtrip checks far harder to false-pass. (`827f924`)
- Functional eval CI is faster and more predictable: smoke, workflow-e2e, chat-core, and live-benchmark jobs now run inside the prebuilt Playwright container with browser installs skipped, every job has an explicit timeout, in-progress runs auto-cancel on new pushes, and the local runner prints per-step durations. (`978e0a1`)

## 10:51 PM — Loop Engineering mode and a fix for swallowed multiline prompts

Late-night work introduces a new automation mode and resolves a long-standing chat input race where fast typing after Enter could be lost.

- New Loop Engineering automation mode: start_loop accepts a loop_engineering configuration, the dev_loop runtime carries it through RunRequest and surfaces an active loop_engineering state on LoopStatusResponse, and the Automation bar gains a dedicated LoopEngineeringPanel plus Sidekick taskbar wiring. Final reports are required and prompt text is properly escaped before reaching the harness. (`31545eb`)
- The chat input bar no longer drops the second line when you press Enter and immediately keep typing: Enter now waits a 100ms grace window before submitting, rapid text arriving during that window is folded back in as a newline, and clicking Send during the grace period can't double-submit. (`31ba337`)

## Highlights

- Edit your own skills directly from the Agents panel
- New Loop Engineering automation mode with live status surfacing
- Chat turns survive transient billing blips instead of 502-ing
- Rapid Enter-then-type no longer drops the second line

