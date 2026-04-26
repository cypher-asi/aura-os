# `AURA_PARTITION_AGENT_IDS` rollout flag

Server-side feature flag that gates the upstream-harness `agent_id`
partitioning that landed in Phases 1-6 of the
robust-concurrent-agent-infra plan. Holds the rollout safe across
mixed-version harness deployments.

## What the flag does

- `AURA_PARTITION_AGENT_IDS=true` (default; also active when the
  variable is unset): every chat / automaton / project-tool call
  site sends the partitioned `{template}::{instance}` (or
  `{template}::default`) `agent_id` built by
  `aura_os_core::harness_agent_id`. The upstream harness applies
  its "one in-flight turn per `agent_id`" rule per `AgentInstance`,
  so chat / automation / spec-gen / task-extract on different
  partitions of the same template no longer collide.
- `AURA_PARTITION_AGENT_IDS=false`: every call site falls back to
  the bare template id via `harness_agent_id_gated`. Two
  AgentInstances of one template collapse onto the same harness
  partition — exactly the pre-Phase-1 behavior. Use this only when
  the harness side hasn't yet shipped support for the partitioned
  `agent_id` shape.

The flag is parsed at server startup (case-insensitive
`true|false|yes|no|1|0`; invalid values warn-and-default to
`true`), exposed on `AppState::partition_agent_ids`, and logged at
INFO so the resolved value is visible in startup logs.

## When to flip it

During a rolling deploy where the server has Phases 1-6 but the
harness build it talks to does not yet honour the partitioned
`agent_id`. In that mixed-version window, the partitioned ids the
server sends would carry no benefit (the harness still locks turns
by template), so set the flag to `false` until the harness side
ships.

```bash
# Server-side: opt out of partitioning for the rollout window.
AURA_PARTITION_AGENT_IDS=false aura-os-server …

# After the matching harness build is rolled out:
unset AURA_PARTITION_AGENT_IDS    # or `AURA_PARTITION_AGENT_IDS=true`
```

## Recommended rollout sequence

1. Deploy server with `AURA_PARTITION_AGENT_IDS=false`.
2. Deploy the matching harness build that understands the
   partitioned `agent_id` shape.
3. Flip the flag to `true` (or unset for the default).
4. Watch logs / metrics for a turn or two. If anything regresses,
   set back to `false` and investigate without rolling the harness
   back.

## Behavior with the flag OFF

Every Phase-0-6 improvement *other* than the partition itself stays
active on the server. Specifically:

- **Busy guard** (`chat::busy::reject_if_partition_busy`) still
  matches by `(project_id, agent_instance_id)`, so the chat-vs-
  automation guard keeps surfacing `agent_busy` for the same
  binding instead of leaking the raw upstream "turn in progress"
  string.
- **SSE error remap** (`chat::errors::remap_harness_error_to_sse`
  + `harness_broadcast_to_sse`) still rewrites
  `turn_in_progress` to a structured `agent_busy` SSE event.
- **Per-partition turn slot** (`chat::turn_slot::acquire_turn_slot`)
  still queues a second back-to-back send and rejects a third with
  `ApiError::agent_busy { reason: "queue full" }`. Note that
  "partition" here is the server-side `ChatSession` registry key,
  which is `harness_agent_id_gated(...)` — when the flag is OFF
  that key is the bare template, so all turns for one template go
  through the same slot. That's the same locking shape the
  harness uses, so the queueing is consistent end-to-end.
- **Capacity-exhausted mapping**
  (`ApiError::harness_capacity_exhausted` + the chat / runtime /
  spec / task / dev-loop wiring) is unchanged — it observes
  upstream 503 / WS-close-1013 regardless of the partitioning
  shape.

## Wire-shape stability when flipping the flag

`SessionConfig::template_agent_id` and
`AutomatonStartParams::template_agent_id` are populated as
`Some(template.to_string())` regardless of the flag. When the flag
is OFF, that's harmless redundancy (`agent_id` and
`template_agent_id` are the same string). Keeping the field
unconditionally populated means flipping the flag back to `true`
later does not require re-deriving the field at every call site.
