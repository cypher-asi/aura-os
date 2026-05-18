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

## What is **not** isolated per session today

- **Working directory / cwd**: a project's working directory is
  keyed at the project level, not the session level. Two concurrent
  destructive turns on the same instance can race on filesystem
  state (e.g. one turn renaming a file the other turn is reading).
- **Terminal PTY**: the long-lived PTY attached to a project's
  terminal tool is shared across sessions of that project. Two
  concurrent turns issuing terminal commands will interleave
  command output on the same PTY.
- **Destructive file / command tools**: `write_file`, `delete_file`,
  shell-exec, and similar are not session-scoped. Concurrent
  destructive turns can interleave in ways that are not
  deterministic and not safely undoable.

For chat-only or read-only workloads (e.g. side conversations,
"ask about this code" sessions running alongside a long-running
coding turn) the shared workspace is harmless. For two simultaneous
*editing* turns on the same instance, callers should expect
interleaved writes today; per-session worktree isolation is the
planned follow-up.

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
