# Sharper tool errors, safer hosted auth, and a quieter Windows Git

- Date: `2026-08-31`
- Channel: `nightly`
- Version: `0.1.0-nightly.824.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.824.1

Today's nightly focuses on trust and clarity: chat surfaces tool failures in a way people can actually act on, mobile makes it obvious when a remote agent is required, and the server side closes a cross-user auth race on Aura Web while calming Windows Desktop's flashing Git consoles. Under the hood, dev-loop sessions now require a stable identity so telemetry and rate limits stay coherent across restarts.

## 12:35 AM — Dev-loop runs get a mandatory, stable session identity

Automaton start parameters now require a session ID up front so dev-loop restarts stay coherent with rate limiting and telemetry.

- `aura_session_id` is now a required string on `AutomatonStartParams` rather than an optional field, so dev-loop bootstrap and continuation requests can't reach the harness without one and Cloudflare's per-session rate bucket stops resetting on every restart. (`c649557`)
- Server- and harness-side identity validation, start-params assembly, and tests were updated together so the stable dev-loop session ID flows end-to-end into the outbound `X-Aura-Session-Id` header. (`c649557`)

## 7:26 AM — Hosted workspace files stop crossing user auth boundaries

A concurrency bug on Aura Web that could resolve a hosted file request under another user's token has been fixed by scoping agent lookups to the incoming JWT.

- Hosted workspace file handlers no longer route through `AgentInstanceService::get_instance`, which shared a process-wide cached session and could re-issue a correctly authorized request under a different user's token, producing false 404s on Aura Web under concurrent load. (`10890eb`)
- The handler now resolves the parent agent using the request's own JWT via the network client (or the local agent service as a fallback) and a new auth-race integration test locks in the behavior. (`10890eb`)

## 8:21 AM — Clearer tool errors in chat and a more honest mobile composer

Chat now renders structured tool error responses, and the mobile input bar makes it obvious when a remote agent is required before you can send.

- Generic tool blocks now parse error results into a dedicated response card with a title, message, HTTP status/code metadata, guidance bullets, and a formatted "Try again in…" hint when the tool returns a retry delay. (`b4fcc96`)
- The mobile chat input bar gains a disabled-state notice and a "remote required" status pill so users understand why send is unavailable, backed by a new test suite covering tap-to-send behavior. (`f010d68`)

## 10:12 AM — No more flashing Git console windows on Windows Desktop

Source Control's Git invocations now run headless on Windows, matching how Safe Workspace already handles its Git operations.

- Every Git child process spawned by the Source Control handler now sets `CREATE_NO_WINDOW` on Windows, so staging and committing no longer pop transient console windows out of the Aura Desktop GUI process. (`32d48cd`)

## Highlights

- Structured tool error cards in chat with retry timing and guidance
- Hosted workspace file auth no longer leaks across concurrent Web users
- No more flashing Git console windows on Windows Desktop
- Dev-loop session IDs are now mandatory and stable across restarts

