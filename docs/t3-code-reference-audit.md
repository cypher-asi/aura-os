# T3 Code reference audit

Last reviewed: 2026-09-23

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

## Latest verification snapshot

The current mobile implementation is on commit `57228c101` (`codex/mobile-agent-resume`). The
server library suite passes (`1,041 passed; 1 ignored`), the focused web/mobile suite passes
(`54 passed`), and the production-host Android debug build passes unit tests and lint. The APK is
available at `interface/android/app/build/outputs/apk/debug/app-debug.apk` with SHA-256
`3355512cb8d7fd0cbfd9c5f8f1a2d82eefaf315a4731e2800c219109bf22a58d` and embeds
`https://api.aura.ai` as the native default host.

The live `api.aura.ai` probe is intentionally not counted as feature verification yet: its
execution-status CORS exposure still matches the older deployment and does not expose
`x-aura-chat-execution-status`. The status-only route, Resume POST path, and the corresponding
Harness/Swarm versions therefore still require deployment followed by real Android/WebView and
remote-runtime verification.

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
| Thread lifecycle | Pin/reorder, snooze, settle/restore, archive, rename/regenerate title, drafts, background submission, PR linking, pagination, and cross-message search. | High. Aura now has server-backed pin, snooze/wake, archive/restore, and rename controls in shared session lists (including mobile agent Details). Reorder, a distinct settle state, regenerated titles, and deeper search remain gaps. |
| Permission modes | Per-thread Supervised, Auto-accept edits, Auto, and Full access modes map to each provider's native approval/sandbox behavior. | Medium. Aura's capability policy is deeper and should remain authoritative. Add quick per-session presets that compile down to Aura permissions instead of introducing a parallel policy system. |
| Remote environments | Direct pairing, Tailscale publishing, managed relay endpoints, and desktop-managed SSH all resolve to the same environment and RPC model. | Selective. Aura's confidential swarm is a deliberate product difference. Reuse the normalized environment/connection-lifecycle ideas, but do not bolt T3's machine-pairing model onto the swarm abstraction. |
| Coding surfaces | Terminal, filesystem, Git diff, preview/browser, attachments, tool activity, approvals, questions, and subagent/workflow observability live beside the conversation. | Medium. Aura already has terminal, files, browser/media, sidekick panels, and subagent/council views. The missing unification is mainly source control and cross-surface navigation. |
| Usage and diagnostics | Provider transcript usage is aggregated across environments. A bounded native sidecar attributes CPU/memory/process-tree costs, augmented by Electron host telemetry. | Medium/high. Aura has token, cost, eval, and stability telemetry, but little host/process attribution. A bounded sidecar is a good isolation pattern. |
| Updating | Immutable server versions, compatibility-aware selection, database snapshotting (including SQLite WAL/SHM), health checks, promotion, and rollback. | Medium/high for desktop and remote-host reliability. Adapt the state-snapshot and health-gated promotion pattern to Aura's Rust server packaging. |
| Multi-client UX | Web, Electron desktop, and native mobile share contracts, connection supervision, auth, cached environment state, and domain projections while retaining platform-specific shells. | High for mobile. Aura already has desktop/web/mobile surfaces, but cross-client agent/session discovery, resumability, and offline truth need to feel like one product. |
| Mobile agent awareness | The environment publishes redacted per-thread activity for push notifications and Live Activities. Notifications deep-link back to `(environmentId, threadId)`; the socket does not need to survive in the background. | High after basic resume reliability. Aura should notify for completion, failure, approval, and required input, keyed to its canonical agent/session/runtime identity. |
| Mobile outbox and drafts | Composer drafts and pending sends are client-owned, while accepted commands and conversation state remain environment-owned. Reconnect drains retryable client intent without pretending an unacknowledged send was committed. | High. This is the right boundary for reliable mobile prompts on lossy networks. |
| Restart-held follow-ups | T3 preserves queued work across a server restart but holds it until an explicit `queue.resume` instead of silently executing stale intent (`728b1b2fc`). | High for mobile. Aura should durably restore client-owned follow-ups as held, while leaving accepted/running commands under environment ownership. |

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
- The mobile details surface adds Continue chat, recent canonical sessions, Browse code, and
  Review changes when a project workspace is known. Workspace navigation carries the exact
  canonical agent-instance identity instead of resolving whichever project runtime happens to be
  newest. Local changes use Aura OS's server-local Git service; remote changes now use a separate
  read-only status/diff contract executed inside the agent's Harness pod, authorized through Swarm,
  and displayed in the same review-only mobile workbench. Older or offline remote environments
  report unavailability instead of falling back to Git on the wrong host. This path requires the
  corresponding Harness and Swarm branches to be deployed with Aura OS.
- Remote file proxies now preserve a pod's authorization, missing-path, and unavailable-agent
  failures instead of converting them into HTTP 200. Aura sanitizes gateway error bodies, and
  mobile file preview distinguishes those states without exposing pod paths. This fixes the
  diagnostic boundary for cross-device code browsing; it does not make an offline pod readable.
- The mobile file index is now scoped to the authenticated account **and** owning remote agent,
  not only a workspace path. Switching agents or accounts hides the old tree immediately even
  when both use the same pod path. A transient remote refresh failure can retain only that same
  agent's in-memory listing with a visible stale-data warning; denied or missing workspaces clear
  it. Remote full-tree polling backs off to 30 seconds while foreground/file-operation signals
  still refresh promptly, reducing needless mobile network and battery use. The mobile Files header
  also provides an explicit 44px refresh action so a user need not wait for that interval after
  changing code from desktop. Android QA on `30a78feac` and `4d6474968` confirmed same-agent
  stale-list retention after a simulated 503, clearing after a simulated 403, isolation when
  switching remote agents at the same path, and a physical touch refresh request without 320px
  overflow. QA also found 39px file rows and misleading temporary-outage copy on 403; the follow-up
  raises rows to 44px and distinguishes denied, expired-auth, and missing-workspace responses.
  Android WebView retest on `bb7abe0fb` measured a 44px file row and confirmed a touch selected the
  file route; injected 401/403/404 responses removed the prior file row, showed distinct sanitized
  copy, and did not overflow at 320px. Those injected failures verify client behavior, not live
  production authorization or pod availability.
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
  over running state, matching T3's operator-oriented agent-awareness hierarchy. Cold-start
  snapshots explicitly exclude terminal streams retained for replay, so the registry's short
  reconnect TTL cannot resurrect finished desktop work as a false mobile `Working` state.
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
- Active-stream snapshots now carry a deliberately redacted activity label derived inside the
  environment (`Thinking`, `Inspecting code`, `Editing code`, `Running a command`, and similar),
  never model text, command text, file paths, tool arguments, or unknown private tool names. While
  mobile is foregrounded it refreshes only the active-run projection every ten seconds and on
  foreground return, so the shell can show useful desktop-run progress without holding the stream
  open or polling approvals and questions. This is Aura's content-safe counterpart to T3's
  per-thread Live Activity updates. As an Aura-specific extension, the same bounded projection
  reconstructs how many child agents are still active under the turn. Mobile shows the aggregate
  swarm count in both the global activity strip and agent work inbox, while child run ids, prompts,
  models, paths, and failure reasons stay inside the owning environment. If an old spawn ages out
  of the bounded replay ring, the projection under-counts instead of retaining stale child metadata.
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
  route cache as execution state or conversation truth. The Android-readiness track verified this
  on an emulator by force-stopping the app and relaunching into the same canonical
  project/agent/session route; its mobile Chromium and WebKit suite also passed all 16 cases. That
  validation environment returned `provider_account_unavailable` for a live prompt and had no Git
  workspace, so long-running Stop/progress/question behavior and live Changes remain covered by
  deterministic tests rather than being misreported as production end-to-end passes.
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
  review-comment synchronization remain later increments. Ordinary mobile file previews now use
  the same handoff model: each source line has an explicit 44px action that appends the bounded
  line, path, and line number to the existing canonical draft without auto-sending. To keep large
  mobile files responsive, line actions are capped at 1,000 lines while the full read-only preview
  and whole-file handoff remain available. When Files was opened outside an agent
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
  keeps accepted commands until the server confirms a durable terminal marker. Unaccepted entries
  expire after 24 hours; accepted entries remain available for seven days. Entries are user- and
  environment-scoped, bounded to 50, and never mirrored into localStorage. Validation,
  permission, and credit failures are removed instead of surprising the user with a later send.
  Media-generation requests are intentionally outside this first outbox slice.
- Attachment-bearing sends use that same outbox and replay the exact attachment payload after a
  reconnect. Unlike Aura's ordinary best-effort UI caches, command persistence now requires a
  confirmed IndexedDB transaction before opening the POST. Quota, abort, and unavailable-storage
  failures are surfaced as `Not sent` instead of falsely claiming `Waiting to resend`; the in-memory
  last-send payload still supports an explicit retry while the app remains open. This complements
  T3's reconnect-aware upload queue: Aura's failed object upload already falls back to the inline
  attachment, while the command outbox protects the resulting prompt across mobile suspension.
  The Android-readiness track verified the exact row and attachment bytes in WebView IndexedDB,
  force-stopped and relaunched the app, observed replay with the same command id and payload, and
  confirmed one rendered user turn. It also injected `QuotaExceededError`: no command POST opened,
  the bubble became `Not sent`, and the in-process retry preserved the exact attachment.
- Client-owned follow-ups waiting behind a running turn now have their own durable, authenticated
  IndexedDB queue. Exact text, attachment payloads, generation settings, and agent bindings are
  stored before the composer clears; quota/unavailable-storage failures leave the draft and
  attachments in place with an inline error. After app process death, recovered items render in the
  originating canonical conversation as `held after restart` and cannot auto-dequeue until the
  user taps the touch-sized Resume queue action. Ordinary chat sends hand the same queue id into
  the durable command outbox before deleting the queue copy; cold-start hydration deduplicates the
  overlap if Android kills the WebView between those commits. Media-generation sends, which are not
  in the command outbox yet, delete their queue item before dispatch. Editing, removal, and new-chat
  clearing also commit the deletion before advancing, preventing a completed or discarded follow-up
  from reappearing after another kill. Queues are user/environment-scoped,
  bounded to 50, expire after 24 hours, and never mirror prompt data into localStorage. This adopts
  T3's safe restart-hold invariant without pretending Aura's client queue is a server worker.
  Android production-WebView QA confirmed the force-stop hold and same-id outbox handoff, then
  exposed two mobile-only composer gaps: an active turn rendered Stop without a way to submit a
  follow-up, and a failed IndexedDB queue write hid its inline error. The mobile composer now
  offers a separate touch-sized Queue control beside Stop, accepts Enter for that same intent, and
  renders external queue-persistence errors without clearing the draft. Automation-only busy state
  still cannot create a chat follow-up queue. Android production-WebView retest confirmed physical
  Queue and IME Enter each persisted a follow-up, forced IndexedDB abort left the draft intact and
  showed the inline alert, and Queue/Stop stayed 44×44 CSS px without overflow at 320px width.
- The mobile agent library now has an explicit touch-sized refresh action for agents, projects,
  canonical sessions, approvals, questions, and active runs. The attention hydration is
  independently fail-safe per endpoint: a transient failure preserves the last known slice, while
  a successful empty response clears it. This adopts T3's refresh/reconnect recovery without making
  an offline request erase known desktop-started work or treating cached state as newly confirmed.
- Remote-agent details on mobile now expose the environment-owned lifecycle controls Aura already
  supported on desktop: hibernate, restart, stop, wake, start, and recovery, chosen from the live VM
  state and restricted to the agent owner. Provisioning/recovery progress, runtime errors, uptime,
  active sessions, endpoint, and runtime version remain visible in the same touch-oriented card.
  Project-scoped agent Details now reuses these same controls instead of offering a read-only
  runtime panel; it resolves ownership from the canonical agent and authenticated user, and hides
  actions when that ownership cannot be established.
  This borrows T3 mobile's principle that a phone should control the agent-owned environment, while
  keeping Aura's confidential swarm lifecycle rather than copying T3's interactive device-stream UI.
  A non-recoverable state error now wins over any cached VM state, so a stale running/error snapshot
  cannot reintroduce Recovery or Stop after a 401. The agent-library session selector also uses a
  stable empty snapshot; Android production-build testing had exposed the prior fresh-array fallback
  as a React maximum-update-depth crash that component mocks did not reproduce.
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
- Accepted project and standalone-agent chat commands now remain in the device outbox after their
  save receipt and are checked again with the same command id after reconnecting. The server writes
  a `chat_command_terminal` storage event after the persistence drain finishes, and marks success
  only when terminal assistant history was persisted;
  replay returns `attached`, `completed`, `failed`, or `unconfirmed` execution status and no longer
  fabricates a `done` SSE when no live stream can be attached. A terminated in-memory stream is
  classified from storage rather than advertised as still running. Mobile surfaces a scoped
  warning for saved-but-unconfirmed execution with a Check again action, and retains a saved-but-
  failed run for review rather than silently removing it. Unit tests cover the terminal marker,
  replay receipt, and accepted-command outbox lifecycle. Android production-WebView QA on the
  `dea2c9690` APK confirmed that a saved command survives force-stop/relaunch before and after the
  check deadline, replays the same command/session with both replay and prior-acceptance headers,
  and transitions through attached, unconfirmed, failed, and completed without duplicate client
  POSTs after completion. Physical touches on library and chat Check actions worked; relevant
  controls were 44px and the 320px layout did not overflow. Responses were CDP-injected because
  the new backend is not deployed, so this does not prove server idempotence or real execution.
  Status checks for commands already acknowledged by the server also assert prior acceptance; if
  storage cannot find that command, Aura fails closed instead of opening a duplicate harness turn.
- Accepted-command follow-up checks now use authenticated, read-only status endpoints for the exact
  standalone or project-agent session. The phone no longer re-uploads screenshots or other prompt
  attachments every 15 seconds, and the status check cannot persist or execute another turn.
  Unacknowledged commands still use the original payload and idempotent replay POST. Status
  responses must match the requested command and session; missing or malformed status keeps the
  accepted command visible as unconfirmed instead of clearing the outbox. The status route uses
  Aura's existing agent/session ownership checks and the durable terminal marker, with no billing
  or harness session setup. Both status and project chat send reject an instance ID supplied under
  another project's URL, and the shared instance resolver now enforces that relationship for all
  project-scoped consumers. The status-only route/outbox path has unit and route integration tests,
  but has not yet been exercised in Android/WebView or against a deployed backend.
- An unconfirmed accepted command now has an explicit, user-initiated Resume action. Resume requires
  the same authenticated command id, session pin, replay/prior-acceptance assertions, and a durable
  saved `user_message`; it recovers persisted image blocks without re-uploading them and refuses to
  run if a terminal marker already exists. Ordinary reconnect polling remains GET-only and cannot
  execute work. This closes the safe client/server restart handoff, but a background worker that
  automatically reconciles commands after a process restart is still intentionally absent.

Next: formalize `runtimeId`/environment ownership in session metadata and move accepted command
execution behind a durable status/worker boundary so the explicit Resume path can be reconciled
without a foreground client. Verify configured FCM delivery on production
Android devices, including warm/cold notification activation. Persist accepted commands and pending
question waits so a server restart can reconstruct status or explicitly fail the original
environment-owned turn instead of relying on an in-memory channel. Do not make the cloud relay an
execution proxy or present an unacknowledged prompt as accepted work.

The remaining command-recovery gap is concrete: Aura persists a user-message event before opening
the harness turn, and the explicit Resume path can reconstruct a saved turn only when a foreground
client invokes it. If the server exits between the user-message write and the turn's terminal event,
no worker automatically reconciles the original command payload or execution. The next slice needs
a durable accepted/running command record with an environment-owned startup/on-demand reconciler or
worker; `unconfirmed` is truthful recovery UX, not proof the agent completed the requested work.

Remote source-control inspection now has that real cross-service addition in branches: the Harness
pod exposes bounded, sandbox-scoped, read-only Git status/diff; Swarm verifies agent ownership and
proxies only those fixed routes; Aura OS validates the response and routes mobile review to the
owning remote agent. Git operations are timed, output-limited, and concurrency-limited in Harness,
with no terminal-command workaround or remote stage/commit action. This remains unverified on a
deployed pod and must not be counted as production-ready until the three service versions and
Android review UI are exercised together. The corrected Android build at `fcb7c3ebd` embeds the
production native host. On the currently deployed older backend, remote Changes returned HTTP 404
and showed the explicit unavailable/retry state. A controlled Android WebView test of a synthetic
status/diff response confirmed branch, file, and read-only diff rendering, touch-sized line actions,
and canonical Ask-agent draft routing at 320px width. That test does **not** establish successful
Git inspection against a production agent pod.

The Android QA transcript also contains a 424 agent error on a **project chat** stream with
`provider_account_unavailable`; an earlier turn in that chat reported the same provider code with
400. This is distinct from a remote-agent runtime failure and from Aura's own
`chat_persist_unavailable` 424 preflight. The remote standalone agent remained read-only while its
runtime was unavailable, so provider execution on that remote path is still unverified. Treat these
as separate failure domains when diagnosing mobile sends.

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

Aura already has server-backed pin, archive/restore, snooze/wake, and user rename on canonical
project-agent sessions; the shared session-list controls also render in mobile agent Details.
Next, add deliberate reorder, regenerated titles, and indexed cross-message search. A distinct
"settle" state remains useful for inbox organization, but should be a presentation/work-queue
state separate from the run's terminal status. Preserve Aura's agent/project/task relationships
rather than flattening everything into T3-style threads.

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
