# T3 Code reference audit

Last reviewed: 2026-08-26

Upstream: <https://github.com/pingdotgg/t3code>

Reviewed commit: `a3a8cbd60539b4af4de8f96c892dbd07a2b6c041`

Local checkout: `../t3code`

## Bottom line

T3 Code is not an agent harness in the same sense as Aura Harness. It is a polished control plane
around provider CLIs: the server owns provider processes, threads, workspaces, Git, terminals, and
filesystem access, while web, desktop, and mobile clients control it through a shared typed RPC
contract. That makes it a useful reference for Aura OS's operator experience and control-plane
boundaries, but not a replacement for Aura's agent runtime.

Aura is already materially stronger in persistent agent identity, memory, skills, capability-scoped
permissions, multi-agent orchestration, task/process workflows, marketplace/integration surfaces,
remote swarm execution, and eval/debug tooling. The largest useful gaps are the everyday coding
control surfaces around those capabilities: global discovery, source-control/review UX, session
organization and search, a uniform runtime-adapter boundary, resource attribution, and rollback-safe
updates.

No T3 source was copied into Aura for this audit. The command palette added alongside this document
is a fresh implementation built on Aura's existing app, project, agent, session, menu, and modal
registries. T3 is MIT licensed, but any future direct source reuse must still preserve its license
and attribution.

## What T3 currently provides

| Area | T3 implementation | Relevance to Aura |
| --- | --- | --- |
| Provider control | Built-in Codex, Claude, Cursor, Grok, and OpenCode drivers behind instance and adapter registries. Common orchestration code addresses a thread rather than a provider. | High. Aura exposes adapter/model metadata, but provider execution still crosses several harness-specific paths. Adopt a narrower, explicit adapter contract rather than provider conditionals leaking upward. |
| Client/server boundary | The server is the execution boundary for provider processes, Git, terminals, and files. Clients share non-visual connection, auth, cached environment, and domain-state code. | High architectural value. Keep filesystem and process authority server-side, and continue moving duplicated web/mobile connection behavior into shared runtime modules. |
| Orchestration model | Commands are serialized, idempotent through durable receipts, converted to persisted events, and projected transactionally. Follow-up provider and checkpoint work runs in drainable workers. | Medium/high. Aura already streams rich domain events and has durable task/process state. Borrow the receipt, transactional projection, and deterministic drain patterns where retries currently risk duplicating work; do not rewrite all Aura state as an event store. |
| Workspace safety | Each turn is bracketed with hidden-Git-ref checkpoints. T3 exposes exact turn/thread diffs and coordinated workspace plus conversation reverts. It also supports current-checkout or worktree mode. | High, and already underway. Aura's in-progress safe-workspace implementation uses isolated worktrees and shadow-repository checkpoints. Finish and harden that design rather than replacing it with T3 code. |
| Source control | Native clone/publish, branch operations, PR/MR creation, linked reviews, local checkout, line-level review requests, and in-app review editing for GitHub, GitLab, Bitbucket, and Azure DevOps. | Highest remaining product gap. Aura has Git tools and provider integrations, but lacks one first-class, provider-neutral source-control/review workbench. |
| Global discovery | A command palette spans actions, projects, branches, threads, user messages, and final agent responses across connected environments. File-name and file-content search have separate modes. | High. The first Aura slice is now implemented for cached chats, apps, projects, agents, and actions. Server-backed message/content search and file search remain. |
| Keybindings | Server-backed editable rules, conflict reporting, context expressions, per-command defaults, and project script commands. | Medium. Aura has a centralized menu/shortcut registry but no editing or conflict UI. Build on that registry after the palette settles. |
| Thread lifecycle | Pin/reorder, snooze, settle/restore, archive, rename/regenerate title, drafts, background submission, PR linking, pagination, and cross-message search. | High. Aura has sessions, summaries, rollover, costs, and agent/task context, but its organization controls are much thinner. |
| Permission modes | Per-thread Supervised, Auto-accept edits, Auto, and Full access modes map to each provider's native approval/sandbox behavior. | Medium. Aura's capability policy is deeper and should remain authoritative. Add quick per-session presets that compile down to Aura permissions instead of introducing a parallel policy system. |
| Remote environments | Direct pairing, Tailscale publishing, managed relay endpoints, and desktop-managed SSH all resolve to the same environment and RPC model. | Selective. Aura's confidential swarm is a deliberate product difference. Reuse the normalized environment/connection-lifecycle ideas, but do not bolt T3's machine-pairing model onto the swarm abstraction. |
| Coding surfaces | Terminal, filesystem, Git diff, preview/browser, attachments, tool activity, approvals, questions, and subagent/workflow observability live beside the conversation. | Medium. Aura already has terminal, files, browser/media, sidekick panels, and subagent/council views. The missing unification is mainly source control and cross-surface navigation. |
| Usage and diagnostics | Provider transcript usage is aggregated across environments. A bounded native sidecar attributes CPU/memory/process-tree costs, augmented by Electron host telemetry. | Medium/high. Aura has token, cost, eval, and stability telemetry, but little host/process attribution. A bounded sidecar is a good isolation pattern. |
| Updating | Immutable server versions, compatibility-aware selection, database snapshotting (including SQLite WAL/SHM), health checks, promotion, and rollback. | Medium/high for desktop and remote-host reliability. Adapt the state-snapshot and health-gated promotion pattern to Aura's Rust server packaging. |
| Multi-client UX | Web, Electron desktop, and native mobile share contracts and runtime behavior while retaining platform-specific shells. | Medium. Aura already has desktop/web/mobile surfaces; the shared non-visual runtime boundary is the useful reference. |

Primary T3 sources reviewed:

- `docs/internals/overview.md` — RPC boundary, event-sourced orchestration, drivers, workers, and checkpoints
- `docs/internals/providers.md` — driver/adapter/instance registry separation
- `docs/internals/remote.md` — environment identity, pairing, Tailscale, relay, and SSH
- `docs/internals/resource-telemetry.md` — bounded native process monitoring
- `docs/internals/server-updates.md` — version staging, database snapshots, health gates, and rollback
- `docs/user/keybindings.md` — command palette search and editable keybinding rules
- `docs/user/source-control.md` — multi-provider source-control and review features
- `docs/user/permission-modes.md` — thread-scoped runtime permission presets

## Gap and adoption order

### P0 — finish the safety foundation

Complete Aura's existing safe-workspace work and verify the entire turn bracket: provisioning,
baseline capture, per-turn capture, diff retrieval, restore, cleanup, and remote-agent behavior. Add
failure-injection tests around interrupted Git operations and shadow-repository recovery. T3 is most
useful here as an invariant checklist, not as code to transplant.

### P1 — make common work discoverable

The first local implementation adds a global Aura command palette on `Cmd/Ctrl+K`. It searches the
data Aura already holds for recent chats, apps, projects, agents, and menu actions; supports keyboard
navigation; skips disabled actions; and uses `>` for action-only results. It deliberately uses
canonical Aura routes and existing action handlers rather than owning another navigation system.

Next increments should be server-backed message search, project file-name/content search, recent
query history, and an explicit result-provider registry so apps can contribute results without
expanding one component indefinitely.

### P1 — build a native source-control and review workbench

Introduce a provider-neutral source-control service with capability discovery, then build the UI in
thin layers:

1. Repository status, branch, changes, staged/unstaged diff, commit, pull, and push.
2. Detect and link the active PR/MR to a session or task.
3. Create a PR/MR from the current branch with an agent-assisted title and description.
4. Render review conversations and let a user send a selected line/range back to an agent as a
   structured request.
5. Add GitLab, Bitbucket, and Azure DevOps adapters behind the same capability contract.

Avoid hard-coding GitHub semantics into the core domain. Provider-specific authentication and
unsupported actions should be reported as capabilities.

### P1 — improve session organization

Add pin, archive, settle, snooze, rename/regenerate, and message search to Aura sessions. Preserve
Aura's agent/project/task relationships rather than flattening everything into T3-style threads.
"Settle" should be a presentation/work-queue state, separate from the run's terminal status.

### P1 — formalize the runtime adapter boundary

Define the minimum common provider lifecycle (probe, create/resume session, start/interrupt turn,
approval/input response, stream normalized events, compact, stop) and keep driver configuration and
live instances in separate registries. Aura Harness remains a first-class runtime behind that
contract, not merely one CLI provider. This should be coordinated across `aura-os` and the harness;
it is not a frontend-only refactor.

### P2 — operational hardening

- Add bounded process-tree telemetry with explicit sampling budgets and no mandatory raw telemetry
  persistence.
- Stage immutable server versions, snapshot database sidecars before migration, health-check the new
  process, and promote or roll back atomically.
- Turn Aura's shortcut registry into editable rules with conflict detection and contextual guards.
- Add scoped subscriptions where broad event streams currently make every client filter the same
  traffic.

## Architecture patterns worth borrowing

1. **Driver plus live-instance registry.** Configuration decoding, process lifetime, and common
   orchestration routing are separate responsibilities.
2. **Scoped subscriptions.** Subscribe to a shell, thread, terminal, or configuration stream rather
   than broadcasting every event to every client.
3. **Idempotent commands with transactional projections.** Use this for externally retryable,
   state-changing workflows such as provisioning, payments, Git publishing, and task transitions.
4. **Drainable background workers.** Tests should await an explicit empty-and-idle condition instead
   of sleeping and hoping reactors have finished.
5. **Checkpoint brackets around a turn.** Diff and restore semantics are much clearer when baseline
   and completion belong to a durable turn identity.
6. **Bounded diagnostics sidecars.** Expensive, platform-specific process inspection should not
   compromise the main server's responsiveness.
7. **Health-gated update promotion.** New server state is promoted only after compatibility and
   health checks succeed; the prior executable and database snapshot remain recoverable.

## What Aura should keep different

- Persistent agents with identity, memory, procedures, skills, and marketplace lifecycle are core
  Aura concepts; T3's provider threads are not a richer replacement.
- Processes, specs, tasks, dev loops, councils, mixtures, and agent-to-agent work should remain
  explicit orchestration primitives.
- Aura's capability and scope broker should remain the security authority. Friendly permission
  presets may compile into it, but must not bypass it.
- Confidential swarm agents and cloud/local runtime placement should stay first-class. Treat SSH or
  Tailscale as possible transports or endpoint providers, not the domain model.
- Aura's eval, debug-timeline, and run-heuristics systems should be extended with host telemetry,
  not replaced by a provider transcript viewer.

## Maintaining the reference checkout

The clone is intentionally a sibling of `aura-os`, so it is persistent and does not pollute this
repository's Git status. From the `aura-os` root:

```bash
git -C ../t3code fetch origin
git -C ../t3code pull --ff-only
```

Before a future comparison, record `git -C ../t3code rev-parse HEAD` in this document so conclusions
remain tied to an exact upstream state.
