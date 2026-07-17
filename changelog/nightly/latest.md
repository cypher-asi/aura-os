# Project agent mentions land, hosted workspaces get isolated

- Date: `2026-07-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.765.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.765.1

Today's nightly brings a new way to direct chats at specific agents inside a project, tightens how hosted local workspaces are exposed to the server, and hardens the GitHub release upload script against another class of flaky API responses.

## 4:22 AM — Hosted local workspaces isolated from server filesystem

The server no longer treats hosted Harness workspaces as if they lived on its own disk, closing a source of wrong-path bugs in project-bound agent chat.

- Agent instance API responses now omit the server's lookalike workspace path when a hosted local Harness owns the filesystem, so browsers and callers can no longer send back an unusable absolute path. (`9723840`)
- Prompt assembly skips injecting the workspace index block when the server cannot actually read the hosted local runtime's files, preventing misleading context from being stitched into the agent system prompt. (`9723840`)
- Project tool workspace resolution is now fallible end-to-end and routed through a single helper for both bare-agent and instance chat, with new Render deployment docs covering the hosted layout. (`9723840`)

## 3:58 PM — @-mentioning project agents in chat

The project chat composer gains a first-class agent mention flow, letting users target specific teammates in a project and routing those mentions safely through the server.

- A new `@` menu in the chat input bar lets users pick agents from the current project, replacing the older file-only mention menu with a unified MentionMenu across desktop and mobile composers. (`0691146`)
- Selected mentions are sent as structured `agent_mentions` on the chat request, and the project route validates each agent id against the project's user-facing bindings before dispatching to the harness. (`0691146`)
- Cross-agent replies now carry the originating `project_id` through the callback path, so responses from mentioned teammates stay scoped to the right project team. (`0691146`)

## 4:25 PM — Release uploader survives flaky GitHub release lookups

The mobile and desktop release asset reconciler now retries a broader set of GitHub API failures when resolving a release by tag, reducing spurious CI failures during nightly publishing.

- Release tag lookups now go through the retrying `gh_api_with_retry` wrapper and treat GitHub's "Unicorn!" and "No server is currently available" 5xx pages as transient instead of fatal. (`9d73d2c`)
- Malformed HTML-in-JSON responses that surface as `invalid character '<' looking for beginning of value` are now recognized as retryable, so a stray GitHub error page no longer aborts an otherwise-healthy upload run. (`8bc8047`)

## Highlights

- @-mention specific agents inside project chat
- Hosted local workspaces no longer leak server-side paths
- Release asset uploader now retries GitHub API lookup failures

