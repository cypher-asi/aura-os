# Dashboard stats finally reflect real agent work

- Date: `2026-04-27`
- Channel: `nightly`
- Version: `0.1.0-nightly.410.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.410.1

Today's nightly closes two long-standing gaps in the project dashboard: tokens and lines of code written by agents were quietly being dropped on the floor before they reached storage. Both the Tokens and Lines stats now persist end-to-end, with cost attribution wired through the previously silent summary and tool-session paths.

## 9:09 AM — Tokens stat and per-project cost attribution wired up

Token usage cached during a task is now actually persisted on completion, and previously header-less LLM calls are stamped for per-project cost rollups.

- Task completion and failure handlers now drain the in-memory token cache into aura-storage via a new persist_cached_task_output helper, fixing the dashboard's Tokens stat reading 0 because persist_task_output had been dead code with no callers. (`c4435e0`)
- Session summary generation and project tool sessions (spec-generate, task-extract) now stamp x-aura-session-id, x-aura-project-id, and x-aura-agent-id / aura_org_id on router calls so their cost is no longer silently excluded from per-project aggregation. (`c4435e0`)

## 2:31 PM — Lines stat survives multi-turn tasks with per-path diff merging

The protocol now carries per-file line diffs, the server persists them into the task cache on each assistant turn, and a per-path merge prevents later turns from clobbering earlier edits.

- Extended the FilesChanged protocol with a backward-compatible diffs array carrying lines_added and lines_removed per path, with serde defaults that keep older decoders byte-identical on the wire. (`c3848e2`)
- assistant_message_end events now populate the per-task files_changed cache by joining created/modified/deleted path lists against the new diffs, closing the dashboard's Lines = 0 gap where tasks.files_changed was staying null end-to-end. (`c3848e2`)
- Replaced the per-turn overwrite with a per-path merge mirroring aura-agent's record_file_change collapse rules (Create+Modify→Create, Create+Delete drops, etc.) with saturating line-count addition, so multi-turn tasks no longer under-count by a turn-count multiple. (`c3848e2`)

## Highlights

- Tokens stat no longer reads zero on completed tasks
- Lines stat now survives multi-turn tasks via per-path diff merging
- Session summaries and tool sessions now attribute cost to the right project

