# Session identity hardening and clearer chat error surfaces

- Date: `2026-08-31`
- Channel: `nightly`
- Version: `0.1.0-nightly.823.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.823.1

Today's nightly focuses on backend correctness and interface clarity: dev-loop automaton runs now demand a stable session ID up front, hosted workspace file requests no longer cross-contaminate between users on Aura Web, and both desktop chat and the mobile input bar do a better job explaining what went wrong and what's required to send.

## 12:35 AM — Dev-loop automaton runs require a stable session ID

The automaton start contract now treats aura_session_id as mandatory instead of optional, so router and billing telemetry can reliably distinguish concurrent dev-loop runs.

- Promoted aura_session_id from Option<String> to a required String across the harness AutomatonStartParams and dev-loop start params, ensuring bootstrap and continuation requests always carry an X-Aura-Session-Id header rather than being silently rejected downstream. (`c649557`)
- Updated server-side identity validation and shape logging to check for a non-empty session string, and refreshed harness tests to cover the new non-optional contract. (`c649557`)

## 7:26 AM — Hosted workspace file auth no longer leaks across concurrent web users

Fixed a cross-user auth race on Aura Web where hosted workspace file requests could be re-issued under another user's cached JWT and return spurious 404s.

- Hosted workspace file handlers now resolve the parent agent using the incoming request's JWT via the network client instead of AgentInstanceService, which pulled from a process-wide SettingsStore that concurrent users were overwriting. (`10890eb`)
- Added a dedicated hosted_workspace_auth_race integration test that exercises overlapping requests from two different user tokens to lock in the fix. (`10890eb`)

## 8:21 AM — Clearer tool error panels and remote-agent guidance in chat

Chat tool blocks now render structured error responses with retry timing and guidance, and the mobile input bar explains when sending requires a remote agent while making tap-to-send more reliable.

- Generic tool blocks parse errored results into a titled panel with message, retry-after countdown, guidance list, and HTTP/code metadata instead of dumping raw JSON, backed by new parseToolError and formatRetryDelay utilities. (`b4fcc96`)
- MobileChatInputBar gained a disabled-state notice and a remote-required status indicator that clarifies when a remote agent is needed, plus stabilized tap-send behavior covered by a new test suite. (`f010d68`)

## Highlights

- Dev-loop starts now require a stable X-Aura-Session-Id
- Hosted file auth race between concurrent web users fixed
- Tool errors in chat render as structured, actionable panels
- Mobile chat input clearly explains when a remote agent is required

