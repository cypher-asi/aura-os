# Project agent mentions land, with safer hosted workspaces and remote availability

- Date: `2026-07-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.766.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.766.1

Today's nightly centers on a new way to bring specific agents into a project chat with @-mentions, backed by server-side plumbing to keep hosted local workspaces properly isolated. The interface also learns when a remote agent is offline before you hit send, and the release upload pipeline gets more patient with flaky GitHub API responses.

## 4:22 AM — Hosted local workspaces get their own filesystem boundary

The server now stops advertising its own workspace paths for hosted local runtimes, so browsers and the Harness stay on the authoritative filesystem.

- When a hosted local Harness is available, the agent instance API no longer returns a lookalike server-side workspace path that callers used to send back to the Harness by mistake. (`9723840`)
- Prompt construction and workspace resolution now go through a mode-aware path so aura-os-server only reads and injects a workspace index block when it actually owns the files, avoiding cross-namespace prompt pollution in hosted local mode. (`9723840`)
- Adds Render deployment notes and refactors the projects session helpers so both bare-agent and instance chat routes resolve project workspaces through one path that can fail cleanly. (`9723840`)

## 3:58 PM — @-mention project agents from the chat composer

The chat input bar gains a project-team mention menu so users can direct a message at specific agents on a project, with matching validation on the server.

- The chat composer now offers a project agent mention menu alongside file mentions, with a new shared MentionMenu component replacing the file-only variant and reworked input trigger handling for the `@` cue. (`0691146`)
- SendChatRequest carries structured agent mentions, and the project chat route validates each `agent_id` and `agent_instance_id` against the project's user-facing bindings before the message reaches the harness. (`0691146`)
- Cross-agent replies now carry the originating project id end to end, keeping mention-driven conversations bound to the right project team and persistence context. (`0691146`)
- The mobile chat input bar picks up the same mention affordance so `@` works consistently across desktop and mobile. (`0691146`)

## 4:25 PM — Release uploader tolerates flaky GitHub API responses

The nightly asset uploader now retries release-lookup failures from GitHub, including 5xx pages and malformed JSON, instead of aborting the whole publish.

- Resolving a release by tag now goes through the retry helper and recognizes transient failures like HTTP 5xx, "No server is currently available", and Unicorn! error pages, with a covering test that asserts the lookup is retried. (`9d73d2c`)
- Adds the "invalid character looking for beginning of value" signature to the retryable set so an HTML error page returned in place of JSON no longer fails the upload on the first try. (`8bc8047`)

## 6:38 PM — Chat blocks sending when a remote agent is offline

The agent chat panel now reflects live remote-agent status, disabling send and dimming unavailable agents in the mention menu before a message goes out.

- AgentChatPanel subscribes to the profile status store, registers the current remote agent for live updates, and disables send with a clear "This remote agent is offline. Start it before sending a message." reason when the agent is stopped. (`0277cf6`)
- A new shared `resolveAgentChatAvailability` helper centralizes the local-vs-remote availability rules used by both the send button and the mention menu. (`0277cf6`)
- The mention menu visually marks unavailable agents with a dimmed, not-allowed style so users can see which teammates can actually receive a message. (`0277cf6`)

## Highlights

- @-mention specific project agents from the chat composer
- Hosted local workspaces no longer leak server-side paths
- Remote-agent chat blocks sending when the agent is offline
- Release uploader retries GitHub 5xx and malformed responses

