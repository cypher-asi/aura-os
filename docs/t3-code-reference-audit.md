# T3 Code reference audit

Last reviewed: 2026-09-22

Upstream: <https://github.com/pingdotgg/t3code>

Reviewed commit: `aff9318bf46beaf05cc7155b428d3f0b8711efd2` (`origin/main`)

Local checkout: `../t3code` (reviewed from `origin/main`; the working tree may remain on an older commit)

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

For mobile specifically, T3's most useful lesson is not a second mobile agent runtime. A thread,
provider process, Git checkout, terminal, and files remain owned by one environment; mobile resumes
that same environment-scoped thread. T3 shares connection/auth/domain-state code across clients,
keeps native presentation separate, retains cached projections offline, and reconnects on app
foreground through one supervisor. Aura should preserve its global persistent agent identity while
making each active session explicit about the harness/swarm environment that owns execution.

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
| Multi-client UX | Web, Electron desktop, and native mobile share contracts, connection supervision, auth, cached environment state, and domain projections while retaining platform-specific shells. | High for mobile. Aura already has desktop/web/mobile surfaces, but cross-client agent/session discovery, resumability, and offline truth need to feel like one product. |
| Mobile agent awareness | The environment publishes redacted per-thread activity for push notifications and Live Activities. Notifications deep-link back to `(environmentId, threadId)`; the socket does not need to survive in the background. | High after basic resume reliability. Aura should notify for completion, failure, approval, and required input, keyed to its canonical agent/session/runtime identity. |
| Mobile outbox and drafts | Composer drafts and pending sends are client-owned, while accepted commands and conversation state remain environment-owned. Reconnect drains retryable client intent without pretending an unacknowledged send was committed. | High. This is the right boundary for reliable mobile prompts on lossy networks. |

Primary T3 sources reviewed:

- `docs/internals/overview.md` — RPC boundary, event-sourced orchestration, drivers, workers, and checkpoints
- `docs/internals/providers.md` — driver/adapter/instance registry separation
- `docs/internals/remote.md` — environment identity, pairing, Tailscale, relay, and SSH
- `docs/internals/connection-runtime.md` — one connection owner, foreground wakeups, offline cache truth, and scoped subscriptions
- `docs/internals/t3-connect.md` — linked-environment bootstrap and managed reachability without moving execution into the relay
- `docs/internals/resource-telemetry.md` — bounded native process monitoring
- `docs/internals/server-updates.md` — version staging, database snapshots, health gates, and rollback
- `docs/user/keybindings.md` — command palette search and editable keybinding rules
- `docs/user/source-control.md` — multi-provider source-control and review features
- `docs/user/permission-modes.md` — thread-scoped runtime permission presets

## Gap and adoption order

### P0 — make the mobile agent loop real

Mobile must be able to discover an agent created on desktop/web, open its canonical recent session,
read history even when execution is temporarily unreachable, send when the owning runtime is live,
and inspect the session's project files. Runtime reachability and persisted-data freshness must be
shown separately; an offline runtime is not a missing agent.

The first Aura slice now implements that boundary:

- `/agents/:agentId` is again the shared conversation route on mobile instead of being intercepted
  by a profile-only screen.
- Agent details move to `?view=details`, preserving the canonical `project`, `instance`, and
  `session` query identity when moving between chat and controls.
- The mobile details surface adds Continue chat, recent canonical sessions, Browse code, and Review
  changes when a project workspace is known. Workspace navigation carries the exact canonical
  agent-instance identity instead of resolving whichever project runtime happens to be newest.
- The agent library warms and displays recent shared conversation previews rather than only profile
  biography text. Its mobile search now matches agent identity/profile fields, live attention, and
  those cross-device conversation previews, with an explicit no-results state instead of a blank
  list.
- Mobile can also escalate from that instant cache search to Aura's authenticated Recall endpoint
  for bounded lexical search across completed chats. Results remain source-linked excerpts: mobile
  opens the exact original project, agent instance, session, and event, and does not silently inject
  recalled text into another turn. Partial-history searches disclose skipped sessions.
- Desktop-local agents remain readable on mobile while their runtime is unreachable; sending stays
  disabled until the owning host is available instead of bouncing the user out of the conversation.
- A disabled mobile composer now distinguishes saved conversation availability from execution
  reachability. Local and remote runtime failures use truthful read-only copy, preserve the runtime
  identity in the footer, and offer an immediate status recheck; disconnected local clients also
  expose Host settings without leaving the conversation.
- The shared event connection now replaces even an apparently-open WebSocket when the app returns
  to the foreground. It mints a fresh connection ticket and resumes from the last event cursor, so
  mobile does not wait through exponential backoff to learn that an agent completed or failed.
- Task and loop notifications now retain the persistent agent, project-agent instance, and session
  identity and target that exact canonical conversation. The same route is included in the native
  notification payload, establishing one deep-link contract for in-app, desktop, and future mobile
  push activation.
- Live tool approval is now a cross-client control-plane operation instead of an SSE event the UI
  silently drops. The server retains the environment-owned command channel, resolves a response by
  the harness request id with account ownership checks, and forwards allow/deny plus the offered
  remember scope to the original run. Project and standalone chats render the same touch-friendly
  approval card, including after mobile reattaches to a desktop-started stream.
- Approval-required events are also published with canonical project, agent-instance, agent, and
  session identity. In-app/native notifications deep-link to the exact waiting conversation, and
  approval notifications have their own default-on preference. The live-stream registry remains
  the source of truth for the pending command; the notification is only a routing signal.
- Aura now contributes an authenticated `request_user_input` tool to every agent session. The
  environment-owned Harness turn blocks on that tool while the Aura server registers one to three
  typed questions (`id`, short header, prompt, two or three options, and optional multi-select).
  Any authenticated client on the same account can discover the pending request from a cold-start
  snapshot, receive live requested/resolved deltas, and answer by opaque request id. Responses are
  shape-validated, account-scoped, and idempotent; the original tool call resumes with the answer
  map without moving execution into the client or cloud relay.
- Project and standalone chats render the same touch-friendly question card, including a custom
  answer path. Mobile raises these questions above approvals and generic running state, deep-links
  into the exact canonical session from the global activity banner, and exposes a default-on
  high-priority notification category. The registry and blocked HTTP tool call are currently
  environment-memory-owned, so an Aura server restart can still abandon a waiting question; this
  is not yet a durable runtime command worker.
- The agent library now has its own authenticated, reconnectable attention projection. It hydrates
  unresolved protected-tool requests from the environment-owned streams, applies live prompt and
  resolution deltas, labels the affected persistent agent as `Needs you`, and opens the exact
  canonical session when tapped. This makes a desktop-started run actionable after a mobile cold
  start even if the original notification was missed.
- The same projection now discovers active desktop/web chat turns without mounting each chat,
  labels the persistent agent as `Working`, and routes a tap to the exact running session. Live
  user-message and assistant-end events keep the state current; approval state takes precedence
  over running state, matching T3's operator-oriented agent-awareness hierarchy.
- On mobile, that projection is now a compact work inbox rather than passive decoration: agents
  that need approval rise above actively working agents, which rise above idle profiles, while a
  summary reports how many agents need the user and how many are still working. Existing order is
  preserved inside each tier, so the temporary activity view does not overwrite pin/recent order.
- The authenticated mobile shell now keeps that awareness visible while the user is in Files,
  Tasks, Run, or another screen. A compact banner prioritizes input-required sessions, then
  approval-required sessions, unconfirmed outbound prompts, and active runs, and opens the exact
  canonical conversation. It
  suppresses the conversation already on screen and snapshots attention independently of a
  successful WebSocket connection, so a cold mobile open still exposes desktop-started work. This
  is Aura's in-app counterpart to T3's Live Activity model.
- That global mobile activity strip is now a control surface as well as a status surface. When its
  highest-priority item is an active run, mobile exposes a separate 44px Stop action that cancels
  the environment-owned turn without first navigating away from the user's current screen. The
  request carries the canonical session id for both project-instance and standalone-agent chats,
  so stopping work opened from desktop does not cancel a sibling conversation running in parallel
  on the same agent. Older clients without a session pin retain the conservative partition-wide
  cancellation fallback.
- Android now has the corresponding OS-background delivery path. The native client requests
  notification permission only when its Firebase resources are present, registers its FCM token
  against the authenticated Aura account, and resynchronizes the enabled notification categories
  when preferences change. Aura OS stores device registrations account-scoped and delivers task
  completion/failure/retry, terminal loop, push-stuck, approval-required, and user-input-required
  events through FCM. Tap payloads contain only an internal canonical route and are validated before
  navigation. Release Firebase client/server credentials remain deployment configuration, and real
  warm/cold delivery still needs production-device verification; missing credentials fail closed
  without blocking app boot.
- Native mobile now remembers the last authenticated Aura shell route with the full canonical
  agent/project-instance/session query, scoped to the signed-in user. On a generic bundled-app cold
  launch it restores that validated internal route before React Router mounts; explicit launch and
  notification routes still win, while login, public, malformed, external, and oversized routes
  are never stored. This closes normal Android process-recreation continuity without treating the
  route cache as execution state or conversation truth.
- Chat lifecycle and approval firehose events are now stamped with the authenticated owner and
  filtered during both replay and live delivery. Legacy unscoped events retain their existing
  behavior, while new account-scoped control signals cannot appear in another user's mobile agent
  list.
- Regular chat sends now carry a stable client command id through both project and standalone-agent
  routes. Aura persists that id with the user message, returns a correlated acceptance receipt only
  after the durable write succeeds, and exposes the receipt headers to native WebViews. Optimistic
  chat bubbles distinguish `Sending…`, accepted, queued for retry, and `Not sent`, so a lossy mobile
  connection no longer makes an unacknowledged prompt look committed.
- That receipt foundation now has an idempotent replay path. The server serializes attempts by
  authenticated user plus command id, rejects reuse of an id with different content, retains the
  original live-stream attachment in memory, and searches durable user-message history across the
  agent's canonical sessions after a server restart. A replay of accepted work returns the original
  session/stream identity without persisting or executing the prompt twice. Billing is still checked
  before genuinely new replay work; an already-persisted command can recover its receipt even if the
  account balance changed after acceptance. This is at-most-once command acceptance, not yet a
  durable worker that reconstructs harness execution interrupted by a server restart.
- Persisted partial turns are now reconciled against the environment's active-stream registry when
  a canonical session opens. If discovery succeeds but the turn no longer exists, Aura preserves
  the partial answer, clears the false `Working` projection, and labels the run interrupted instead
  of leaving mobile on an endless spinner. `Restart turn` is an explicit user action that reuses the
  persisted last prompt; Aura never silently resubmits it. If discovery itself fails, the state
  remains unknown/recoverable rather than falsely claiming interruption. This is honest restart
  truth at the client boundary, not durable execution recovery.
- Mobile project workspaces now separate Files from a read-only Changes view. Users can inspect the
  current branch, upstream/ahead/behind state, linked pull request, changed files, and exact staged
  or worktree diffs for the canonical agent instance without exposing stage, unstage, or commit
  mutations on a touch client. This reuses Aura's provider-neutral source-control contract rather
  than introducing a mobile-only Git path. Server-side Git inspection does not yet reach every
  remote/swarm workspace, so those environments report the capability as unavailable instead of
  showing another workspace's state.
- Mobile code inspection now hands work back to the owning conversation instead of becoming a
  dead-end viewer. Opening Files or Changes from agent details carries the canonical agent,
  project-agent instance, and session identity. A user can add a file-specific inspection request
  or a workspace-change review request to that conversation's existing client-owned draft and
  return to the exact chat. The action never auto-sends, never replaces an unfinished draft, and
  does not put file contents in navigation state. This is the first Aura-native version of T3's
  “send code/review context to the agent” loop. Changed lines in the read-only mobile diff are also
  actionable: Aura tracks unified-diff old/new line positions and adds the selected bounded diff
  line, file, area, and position to the same canonical draft. Range selection and provider-hosted
  review-comment synchronization remain later increments. When Files was opened outside an agent
  route, Aura now resolves the most recent real session for the exact project-agent instance before
  enabling any handoff; it no longer writes a `:fresh` draft and then reopens a different existing
  conversation. Explicit session identity still wins, and a confirmed instance with no sessions
  intentionally retains the fresh-conversation path.
- The mobile agent detail surface now exposes session pin, snooze, rename, archive, restore, and
  delete through an explicit 44px per-row action trigger. These were already durable Aura session
  operations, but the shared list only exposed them through a desktop context menu. Mobile reuses
  the same account-scoped APIs, optimistic cross-surface projection, and rollback/error handling;
  it does not create a second client-only organization model. The same surface can filter that
  agent's shared sessions by resolved title without leaving agent details; account-wide Recall
  remains the separate content-search path.
- Regular project and standalone-agent chat now enqueue the request intent in an IndexedDB outbox
  before opening the POST. The authenticated shell drains retryable commands on boot, connectivity
  restoration, and foreground using the original command id, never repeats `new_session=true`, and
  removes an entry only after the persistence receipt. Entries are user- and environment-scoped,
  bounded to 50, expire after 24 hours, and are never mirrored into localStorage. Validation,
  permission, and credit failures are removed instead of surprising the user with a later send.
  Media-generation requests are intentionally outside this first outbox slice.
- Deferred sends now have a distinct `Waiting to resend` state instead of sharing the ordinary
  in-turn `Queued` label. Live chat bubbles expose touch-friendly `Retry now` and `Stop retrying`
  controls; both operate only on the authenticated user's current environment-scoped outbox. A
  manual retry makes the existing command id eligible immediately, while stopping retry removes
  future attempts without claiming to cancel work that the server may already have accepted.
- The mobile agent library now projects that same current-user, current-environment outbox after
  durable IndexedDB hydration, including while offline. If the originating chat bubble is no
  longer mounted, users can still see unconfirmed prompts, reopen the exact canonical project or
  standalone-agent session, retry with the original command id, or remove future replay attempts.
  A mobile browser test covers this across a full navigation away from the conversation.

Next: formalize `runtimeId`/environment ownership in session metadata and move accepted command
execution behind a durable status/worker boundary. Verify configured FCM delivery on production
Android devices, including warm/cold notification activation. Persist accepted commands and pending
question waits so a server restart can reconstruct status or explicitly fail the original
environment-owned turn instead of relying on an in-memory channel. Do not make the cloud relay an
execution proxy or present an unacknowledged prompt as accepted work.

Remote source-control inspection also needs a real cross-service addition rather than a client
workaround. The current Swarm gateway exposes authenticated pod proxies for files, file reads, and
terminal I/O, while the Harness pod HTTP surface exposes `/api/files` and `/api/read-file`; neither
currently publishes the provider-neutral Git status/diff contract used by Aura OS. Implementing
remote Changes therefore requires a read-only Harness endpoint plus an authenticated Swarm gateway
proxy before Aura OS can advertise that capability. Do not tunnel arbitrary Git commands through
the terminal to simulate it.

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

The mobile agent library now exposes a touch-native search over agents and its cached cross-device
conversation previews, plus an explicit server-backed Recall flow over completed chats. The current
Recall MVP scans a bounded recent candidate set rather than a storage full-text index. Next
increments should be indexed full-history search, project file-name/content search, recent query
history, and an explicit result-provider registry so apps can contribute results without expanding
one component indefinitely.

### P1 — build a native source-control and review workbench

Aura now has a first provider-neutral local source-control service and workbench for repository
status, branch/sync state, staged and worktree diffs, commit, and linked pull-request discovery. The
mobile surface reuses it in read-only mode. Continue building the UI and adapter coverage in thin
layers:

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
