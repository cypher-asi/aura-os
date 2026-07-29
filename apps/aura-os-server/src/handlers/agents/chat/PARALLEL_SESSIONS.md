# Parallel chat sessions: concurrency model and known caveats

Phase 1 of the parallel-session-chats change folded the storage
`session_id` into the harness partition string, so two POSTs against
the same `(template, instance|default)` pair with different
`session_id` values now open two distinct `ChatSession` registry
entries with distinct `turn_slot` mutexes. Turns on different
storage sessions of the same instance therefore stream truly
concurrently — there is **no serialization at the chat-session
layer**.

## Concurrency model

- Partition string: see [`aura_os_core::harness_agent_id`] for the
  three-segment `{template}::{instance|default}::{session_id}` shape.
- Registry key: see [`crate::state::ChatSessionKey`] — the
  `(session_key, model)` tuple lets one partition hold one alive
  entry per model the caller has used.
- Builder: both chat routes resolve `ChatPersistCtx` first and then
  call `persist::build_chat_partition` to fold the resolved
  `session_id` into the partition string. The helper falls back to
  the legacy two-segment partition on a parse failure so the chat
  path keeps working without the session-level lane split.

## Workspace isolation is opt-in

- **Default behavior**: a project's working directory is keyed at the
  project level. Two concurrent destructive turns can still race when
  safe workspace mode is not enabled.
- **Safe workspace behavior**: project-agent chat can send
  `safe_workspace: true`. Aura creates a detached Git worktree for the
  storage session, points the harness at that path, and snapshots its
  non-ignored filesystem before turns. Checkpoint preview, exact restore,
  and conflict-checked apply-back APIs live in
  `handlers/agents/safe_workspace.rs`.
- **Terminal PTY**: the long-lived PTY attached to a project's
  visible terminal remains attached to the original project. It is not
  retargeted to the safe worktree.
- **Eligibility**: safe workspaces require a persisted session. Desktop
  projects use the server-owned linked Git repository. Hosted-local Web
  projects use the Harness-owned lifecycle only when the Harness advertises
  `safe_workspace: true`; older hosted Harness deployments fail closed and the
  renderer hides the control. Remote/Swarm agents keep the existing execution
  model.
- **Spawned agents**: foreground child agents inherit the parent's resolved
  project path. A safe parent therefore keeps its children in the session
  worktree without changing spawn or stream behavior. Sibling children still
  share that one session worktree; per-child worktrees are a separate feature.

For chat-only or read-only workloads (e.g. side conversations,
"ask about this code" sessions running alongside a long-running
coding turn) the shared workspace remains available. Editing turns that
need deterministic isolation should opt into safe workspace mode and use
the explicit apply action to hand changes back to the linked project.

## Cross-feature serialization

Cross-feature serialization (chat vs. dev loop / single-task /
Swarm-tools) is preserved by the automaton registry's busy-guard,
which keys on the bare `(template, instance)` partition. Chat
sessions intentionally stay outside that guard so concurrent
storage sessions on a single instance can stream in parallel.

## See also

- [`apps/aura-os-server/src/handlers/agents/chat/streaming.rs`] — the
  SSE driver and `open_harness_chat_stream` orchestrator the chat
  routes hand off to.
- [`apps/aura-os-server/src/handlers/agents/chat/persist.rs`] —
  `build_chat_partition` + `ChatPersistCtx::parsed_session_id`, the
  dedup helpers both chat routes call.
- [`apps/aura-os-server/src/handlers/agents/chat/agent_route.rs`] /
  [`apps/aura-os-server/src/handlers/agents/chat/instance_route.rs`]
  — the two chat surfaces that open per-session partitions.
- [`apps/aura-os-server/src/handlers/agents/chat/setup.rs`] —
  `has_live_session` + `remove_live_sessions_for_partition`, the
  registry probe / sweep both reset endpoints use.
- [`apps/aura-os-server/src/handlers/agents/chat/CROSS_AGENT_TRACING.md`]
  — sibling tracing reference for the cross-agent reply pipeline.
- [`apps/aura-os-server/src/handlers/agents/safe_workspace.rs`] —
  per-session worktree, checkpoint, restore, and apply-back lifecycle.
