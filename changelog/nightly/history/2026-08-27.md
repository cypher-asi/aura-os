# Command palette, source-control workbench, and hosted Preview routing

- Date: `2026-08-27`
- Channel: `nightly`
- Version: `0.1.0-nightly.809.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.809.1

Today's nightly lands two sizable interface additions — a global command palette and a native source-control workbench — alongside a server fix that lets the Preview browser reach dev servers running in a separately hosted local harness.

## 7:23 AM — Global command palette on Cmd/Ctrl+K

A first-class launcher spanning recent chats, apps, projects, agents, and menu actions arrives in the Aura shell.

- Added a global command palette wired into AuraShell that searches recent chats, apps, projects, agents, and menu actions with keyboard navigation, disabled-action filtering, and a `>` prefix for action-only results. (`3cdf448`)
- Extended the MenuBar registry and a new UI modal store so the palette reuses canonical Aura routes and existing action handlers rather than introducing a parallel navigation system. (`3cdf448`)
- Published a T3 Code reference audit documenting the gaps that motivated the palette and the source-control workbench, and confirming no upstream source was copied in. (`3cdf448`)

## 9:52 AM — Preview browser routes to hosted local harness

The remote Preview proxy now knows how to tunnel loopback dev-server URLs into a separately hosted local harness, not just a swarm agent.

- Taught the browser spawn path to start a hosted-harness Preview proxy when a project is selected, failing closed with a clear service-unavailable error when the hosted tunnel is missing its transport auth. (`8529187`)
- Added a `hosted_preview_target` accessor on the harness gateway that only exposes hosted (non-loopback) bases with a transport bearer, keeping desktop loopback harnesses on their existing direct path. (`8529187`)
- Generalized the remote preview proxy with a `PreviewTunnelTarget` abstraction so swarm agents and hosted harnesses share one SOCKS-over-WebSocket tunneling path to the machine that owns the dev server. (`8529187`)

## 7:27 PM — Native source-control workbench in the Sidekick

A provider-neutral Git workbench lands in the Sidekick with status, diffs, staging, commits, and best-effort PR linking.

- Introduced a `source_control` server handler exposing project-scoped Git status, staged/worktree diffs, stage/unstage, and commit operations with bounded limits on file counts, diff bytes, path batches, and commit message size. (`a0cbf0d`)
- Shipped a SourceControlWorkbench component and Sidekick taskbar entry that render branch, ahead/behind, changed files, and diffs, with an optional linked pull request surfaced as provider-tagged metadata. (`a0cbf0d`)
- Kept the HTTP contract provider-neutral so GitHub detection is best-effort today and additional review adapters (GitLab, Bitbucket, Azure DevOps) can slot in without changing the workbench response shape. (`a0cbf0d`)

## Highlights

- Global Cmd/Ctrl+K command palette across chats, projects, agents, and actions
- New provider-neutral source-control workbench with status, diffs, staging, and commits
- Preview browser now tunnels correctly to hosted local harness dev servers

