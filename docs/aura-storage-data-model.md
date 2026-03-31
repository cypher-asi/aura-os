# aura-storage Data Model

## Cross-service references (from aura-network)
- `org_id` — organization
- `agent_id` — agent template
- `user_id` — user
- `project_id` — project (projects live in aura-network)

---

## Types

### `ProjectAgentStatus`
`idle` | `working` | `blocked` | `stopped` | `error`

### `TaskStatus`
`pending` | `ready` | `in_progress` | `done` | `failed` | `blocked`

### `SessionStatus`
`active` | `completed` | `failed` | `rolled_over`

### `MessageRole`
`user` | `assistant` | `system`

### `LogLevel`
`info` | `warn` | `error` | `debug`

### `Model`
`claude-opus-4-6` | `claude-sonnet-4-5` | `claude-haiku-4-5` | (extensible)

---

## Tables

### `project_agents`

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| project_id | UUID | → project (aura-network) |
| agent_id | UUID | → agent (aura-network) |
| created_by | UUID | → user (aura-network) |
| status | ProjectAgentStatus | NOT NULL, default idle |
| model | Model | |
| total_input_tokens | BIGINT | default 0 |
| total_output_tokens | BIGINT | default 0 |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `specs`

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| project_id | UUID | → project (aura-network) |
| created_by | UUID | → user (aura-network) |
| title | TEXT | NOT NULL |
| order_index | INTEGER | NOT NULL |
| markdown_contents | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `tasks`

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| project_id | UUID | → project (aura-network) |
| spec_id | UUID | → specs |
| created_by | UUID | → user (aura-network) |
| title | TEXT | NOT NULL |
| description | TEXT | |
| status | TaskStatus | NOT NULL, default pending |
| order_index | INTEGER | NOT NULL |
| dependency_task_ids | JSONB | array of task UUIDs, default [] |
| parent_task_id | UUID | → tasks (optional, for subtasks) |
| assigned_project_agent_id | UUID | → project_agents |
| session_id | UUID | → sessions |
| execution_notes | TEXT | |
| files_changed | JSONB | [{op, path, lines_added, lines_removed}] |
| model | Model | |
| total_input_tokens | BIGINT | default 0 |
| total_output_tokens | BIGINT | default 0 |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `sessions`

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| project_agent_id | UUID | → project_agents |
| project_id | UUID | → project (aura-network) |
| created_by | UUID | → user (aura-network) |
| model | Model | |
| status | SessionStatus | NOT NULL, default active |
| total_input_tokens | BIGINT | default 0 |
| total_output_tokens | BIGINT | default 0 |
| context_usage | REAL | default 0 |
| summary | TEXT | |
| started_at | TIMESTAMPTZ | |
| ended_at | TIMESTAMPTZ | |

### `messages`

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| session_id | UUID | → sessions |
| project_agent_id | UUID | → project_agents |
| project_id | UUID | → project (aura-network) |
| created_by | UUID | → user or system (nullable for system messages) |
| role | MessageRole | NOT NULL |
| content | TEXT | NOT NULL |
| content_blocks | JSONB | |
| input_tokens | INTEGER | |
| output_tokens | INTEGER | |
| thinking | TEXT | extended thinking content |
| thinking_duration_ms | BIGINT | thinking step duration in ms |
| created_at | TIMESTAMPTZ | |

### `log_entries`

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| project_id | UUID | → project (aura-network) |
| project_agent_id | UUID | → project_agents |
| created_by | UUID | → user (aura-network) |
| level | LogLevel | NOT NULL |
| message | TEXT | NOT NULL |
| metadata | JSONB | |
| created_at | TIMESTAMPTZ | |

---

## Entity Hierarchy

```
project (aura-network)
  ├── project_agent → agent (aura-network)
  │     ├── session
  │     │     └── messages
  │     └── log_entries
  ├── specs
  └── tasks → spec, project_agent
```
