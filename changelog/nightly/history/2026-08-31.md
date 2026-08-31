# Session identity hardening for dev loops and hosted web files

- Date: `2026-08-31`
- Channel: `nightly`
- Version: `0.1.0-nightly.821.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.821.1

A focused backend day for Aura: dev-loop automaton starts now demand a stable session identifier up front, and Aura Web's hosted workspace file endpoint no longer leaks across concurrent users' sessions. Both changes tighten authorization boundaries around multi-user server flows.

## 12:35 AM — Dev-loop automaton starts require a session ID up front

The automaton start contract now treats aura_session_id as mandatory rather than optional, so dev-loop bootstraps can't reach the model-request layer without a stable identifier for Cloudflare bucketing and billing telemetry.

- Made aura_session_id a non-optional String on AutomatonStartParams and updated the server-side validator, harness identity checks, and dev-loop start params to always assemble one via stable_dev_loop_session_id, eliminating a class of silent None paths that could bypass the X-Aura-Session-Id requirement. (`c649557`)
- Refreshed harness and handler tests to cover the new required-field shape, including rejection paths when the session ID is blank, so regressions to the optional form are caught at build time. (`c649557`)

## 7:26 AM — Hosted workspace file requests no longer cross user sessions on Aura Web

Fixed a cross-user auth race in the hosted workspace files handler where concurrent Aura Web requests could resolve an agent instance under another user's cached JWT and return a spurious 404.

- Stopped calling AgentInstanceService::get_instance inside ensure_hosted_local_instance, which was reading a process-wide SettingsStore JWT that concurrent web users could overwrite. The handler now resolves the parent agent using the request's own JWT via the network client (or the local agent service when offline) before checking HarnessMode::Local. (`10890eb`)
- Added a dedicated hosted_workspace_auth_race integration test that drives interleaved requests from two users to lock in the request-scoped auth behavior and prevent the shared-session regression from returning. (`10890eb`)

## Highlights

- Automaton starts require a stable X-Aura-Session-Id
- Fixed cross-user auth race in hosted workspace files on Aura Web

