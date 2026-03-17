# aura-runtime Requirements

Specification for what **aura-runtime** needs to support so **aura-app** can fully delegate agent intelligence to it — same runtime binary for local sidecar and cloud microVM execution.

---

## Priority Summary

| Priority     | Requirements                                                                                                                        | Rationale                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Critical** | R1 (Tool Extension), R2 (System Prompt), R3 (Model Config), R4 (Multi-Turn), R9 (session_init)                                      | Cannot integrate without these                       |
| **High**     | R5 (Token Reporting), R6 (File Tracking), R7 (fs_delete + fs_find), R7a/b (Schema Alignment), R8 (Cancellation), R15 (Lifecycle), R16 (Error Handling) | Core functionality gaps that would force workarounds |
| **Medium**   | R10 (Git Init), R11 (Build Verification), R14 (Multi-Project), R17 (Gateway), R18 (Context Mgmt)                                    | Can be handled client-side initially                 |
| **Low**      | R12 (Endpoint Alignment), R13 (Terminal Streaming), R19 (Approval Flow)                                                              | Polish items                                         |

---

## Tool Mapping

| aura-app tool      | aura-runtime equivalent | Status     | Notes                                                                                                                                                          |
| ------------------ | ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_file`        | `fs_read`               | Exists     | Schema compatible                                                                                                                                              |
| `write_file`       | `fs_write`              | Exists     | Schema compatible                                                                                                                                              |
| `edit_file`        | `fs_edit`               | Exists     | **Schema gap:** aura-app has `replace_all` (boolean, default false) — runtime lacks this parameter. R7a                                                        |
| `delete_file`      | `fs_delete`             | **NEW**    | R7                                                                                                                                                             |
| `list_files`       | `fs_ls`                 | Exists     | aura-app skips `.`-prefixed, `node_modules`, `target`, `__pycache__` — verify runtime does same                                                                |
| `find_files`       | `fs_find`               | **NEW**    | R7 — glob-based, cap 200 results                                                                                                                               |
| `run_command`      | `cmd_run`               | Exists     | **Schema mismatch:** aura-app sends `command` (single shell string), `working_dir`, `timeout_secs`; runtime expects `program`, `args?`, `cwd?`, `timeout_ms?`. R7b |
| `search_code`      | `search_code`           | Exists     | **Param name mismatch:** aura-app uses `include` for glob filter; runtime uses `file_pattern`. Needs alignment                                                 |
| —                  | `fs_stat`               | Exists     | Runtime-only tool (file metadata). No aura-app equivalent; keep available for LLM use                                                                          |
| `task_done`        | —                       | **Via R1** | External tool, callback to aura-app                                                                                                                            |
| `get_task_context` | —                       | **Via R1** | External tool, callback to aura-app                                                                                                                            |
| 20 domain tools    | —                       | **Via R1** | External tools, callback to aura-app (5 spec + 5 task + 1 run_task + 4 sprint + 2 project + 3 dev loop)                                                       |

---

## Requirements

### R1. Tool Extension API `[CRITICAL]`

**Problem:** aura-app has 30 tools. aura-runtime has 7 built-in tools (`fs_read`, `fs_write`, `fs_ls`, `fs_edit`, `fs_stat`, `cmd_run`, `search_code`). The remaining 22 are domain-specific: 20 chat management tools (spec/task/sprint/project/dev-loop management) plus 2 engine-only tools (`task_done`, `get_task_context`). Without an extension mechanism, aura-app would need to intercept tool calls outside the runtime — breaking the "no weird communication" goal.

**What aura-app does today:** In `crates/ai/chat/src/chat_tool_executor.rs`, tools like `create_spec`, `list_tasks`, `start_dev_loop` call directly into `ProjectService`, `TaskService`, `SpecGenerationService` etc. In `crates/ai/engine/src/engine/executor.rs`, `task_done` extracts `notes` and `follow_ups` from the tool input and signals the loop to stop.

**Recommendation:** Add a tool extension system to the runtime. At session creation (or via a config endpoint), the client registers additional tool definitions with a callback URL:

```rust
pub struct ExternalToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub callback_url: String,  // e.g. "http://localhost:3001/tools/create_spec"
}

pub struct SessionConfig {
    pub external_tools: Vec<ExternalToolDefinition>,
    // ...
}
```

When the LLM calls an external tool, the runtime POSTs to `callback_url` with `{ "tool_name": "...", "input": {...} }` and returns the response as the tool result. The runtime's `ToolRegistry` in `aura-tools/src/registry.rs` needs to support both built-in and external tools.

**Files to modify in aura-runtime:**

- `aura-tools/src/registry.rs` — extend `ToolRegistry` to hold external tool definitions
- `aura-kernel/src/turn.rs` — when executing a tool call, check if it's external and dispatch via HTTP
- `aura-core/src/types.rs` — add `ExternalToolDefinition` struct
- New: `aura-tools/src/external.rs` — HTTP callback executor

**aura-app side (callback server):** For external tools to work, aura-app must expose HTTP callback endpoints that the runtime can POST to. This means adding routes like `POST /api/tools/:tool_name` to the aura-app server (e.g. in `apps/server/src/router.rs`). Each endpoint receives `{ "tool_name": "...", "input": {...} }`, dispatches to the appropriate service (`ChatToolExecutor` or `EngineToolLoopExecutor`), and returns the tool result JSON. The aura-app server already runs on port 3100; these callback routes are internal (runtime → aura-app only, not exposed to frontend).

**Acceptance criteria:** aura-app can register `task_done`, `get_task_context`, and all 20 domain tools as external tools. The runtime calls them via HTTP and returns results to the LLM. No tool execution logic lives outside the runtime's agentic loop.

---

### R2. Session-Level System Prompt Configuration `[CRITICAL]`

**Problem:** aura-app builds rich, dynamic system prompts per task containing agent personality, project context, build/test commands, and workflow instructions. The runtime currently only supports static config via `agent.toml`.

**What aura-app does today:** `crates/ai/engine/src/engine/prompts.rs` builds `agentic_execution_system_prompt()` which includes agent preamble (name, role, personality, skills), project build/test commands, and a detailed workflow (explore → implement → verify → task_done). `crates/ai/chat/src/chat.rs` builds `build_chat_system_prompt()` which includes project name, description, folder, build/test commands, detected tech stack, project structure, and config file contents. These prompts are different per-task and per-session.

**What the runtime has today:** `agent.toml` has a static agent name. Model config via env vars (`AURA_MODEL_PROVIDER`, `AURA_MODEL_NAME`). No API to set system prompt dynamically.

**Recommendation:** Accept `system_prompt` in a `session_init` message sent once after WebSocket connect, before any `user_message`:

```json
{
  "type": "session_init",
  "system_prompt": "You are an AI assistant working on project...",
  "model": { "provider": "anthropic", "name": "claude-sonnet-4-20250514", "max_tokens": 16384 },
  "external_tools": [...]
}
```

The runtime's kernel uses this system prompt instead of the static one from `agent.toml`.

**Files to modify in aura-runtime:**

- WebSocket handler (wherever `/stream` is implemented) — parse `session_init` message type
- `aura-kernel/src/turn.rs` — accept dynamic system prompt in `TurnProcessor`
- `aura-core/src/types.rs` — add `SessionInit` message type

---

### R3. Model Configuration API `[CRITICAL]`

**Problem:** aura-app allows per-session model selection (`session.model` field in `crates/domain/sessions/src/lib.rs`). The runtime only accepts model config from env vars.

**What the runtime has today:** Env vars `AURA_MODEL_PROVIDER`, `AURA_MODEL_NAME`. The `AnthropicProvider` reads these at startup.

**Recommendation:** Include model config in the `session_init` message (see R2). The runtime's `ModelProvider` should accept per-session overrides. The `TurnProcessor` passes the session's model config to the provider for each completion call.

```json
{
  "type": "session_init",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "max_tokens": 16384,
    "thinking": { "enabled": true, "budget_tokens": 10000 }
  }
}
```

**Files to modify in aura-runtime:**

- `aura-reasoner/src/anthropic.rs` (or equivalent) — accept model config per-call rather than only from env
- `aura-kernel/src/turn.rs` — pass model config from session to reasoner

---

### R4. Multi-Turn Conversation Within a Session `[CRITICAL]`

**Problem:** aura-app maintains full message history across turns within a session. The runtime's current transaction model processes individual transactions independently.

**What aura-app does today:** In `crates/ai/engine/src/engine/executor.rs`, `api_messages` accumulates across loop iterations — each tool result and assistant response is appended, building up full conversation context. In `crates/ai/chat/src/chat.rs`, `run_tool_loop` similarly accumulates messages across the tool-use loop.

**What the runtime has today:** Each transaction (`POST /tx`) is processed independently. The kernel builds context from the record (append-only log), but within a WebSocket session, there's no explicit multi-turn conversation state.

**Recommendation:** Within a WebSocket session, the runtime maintains a conversation message list. Each `user_message` adds to the list. The kernel's turn processor uses the full conversation history (system prompt + all prior messages) when calling the reasoner. When the assistant's turn ends (`assistant_message_end`), the response is appended to the history.

**Files to modify in aura-runtime:**

- WebSocket handler — maintain per-session `Vec<Message>` or equivalent
- `aura-kernel/src/turn.rs` — accept message history, not just a single transaction payload

---

### R5. Context Window Management and Token Reporting `[HIGH]`

**Problem:** aura-app tracks cumulative token usage per session and triggers context rollover at 50% of the model's context window.

**What aura-app does today:** `crates/domain/sessions/src/lib.rs` computes `turn_usage = (input_tokens + output_tokens) as f64 / 200_000.0` per turn, accumulates into `context_usage_estimate`, and triggers rollover when it hits 0.5. After rollover, it generates a summary via LLM and starts a new session with that summary as prior context.

**What the runtime reports today:** `assistant_message_end` includes `usage: { input_tokens, output_tokens }` — per-turn only, not cumulative.

**Recommendation:** Extend `assistant_message_end` to include cumulative session token counts:

```json
{
  "type": "assistant_message_end",
  "message_id": "m1",
  "usage": {
    "input_tokens": 5000,
    "output_tokens": 1200
  },
  "session_usage": {
    "total_input_tokens": 45000,
    "total_output_tokens": 12000,
    "context_window_size": 200000,
    "context_utilization": 0.285
  },
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic"
}
```

This lets aura-app decide when to close the session and start a new one with a summary prompt (using R2's dynamic system prompt).

**Billing integration:** aura-app uses `MeteredLlm` and `BillingClient` (`crates/domain/billing/`) to meter every LLM call for credit-based billing. When LLM calls move to the runtime, per-turn `usage` (with `model` and `provider`) becomes the billing data source. The `model` and `provider` fields in `assistant_message_end` are required so aura-app can compute cost per turn using its pricing tables. See also R18 for intra-session context management responsibility.

**Files to modify in aura-runtime:**

- WebSocket handler — track cumulative tokens per session
- Message serialization — add `session_usage`, `model`, `provider` fields

---

### R6. File Change Tracking `[HIGH]`

**Problem:** aura-app emits `FileOpsApplied` events listing every file written/deleted during task execution, which the frontend uses to show what changed.

**What aura-app does today:** In `crates/ai/engine/src/engine/executor.rs`, `track_file_op()` records each `write_file`, `edit_file`, `delete_file` call into `tracked_file_ops`. After task completion, it emits `EngineEvent::FileOpsApplied { files_written, files_deleted, files }`.

**What the runtime has today:** Tool results are streamed via `tool_result` messages, but there's no aggregated file change report.

**Recommendation:** Include a `files_changed` field in `assistant_message_end`:

```json
{
  "type": "assistant_message_end",
  "message_id": "m1",
  "usage": { "..." : "..." },
  "files_changed": {
    "written": ["src/components/Login.tsx", "src/api/auth.ts"],
    "deleted": ["src/old_login.tsx"],
    "total_written": 2,
    "total_deleted": 1
  }
}
```

**Files to modify in aura-runtime:**

- `aura-tools/src/fs_tools.rs` — track file mutations in a session-scoped accumulator
- WebSocket handler — include file change summary in `assistant_message_end`

---

### R7. New Built-in Tools: `fs_delete` and `fs_find` `[HIGH]`

**Problem:** aura-runtime is missing two tools that aura-app relies on.

**`fs_delete`** — aura-app's `delete_file` (`crates/ai/chat/src/chat_tool_executor.rs`, lines 406–416) calls `std::fs::remove_file` within the sandboxed project directory.

**`fs_find`** — aura-app's `find_files` (`crates/ai/chat/src/chat_tool_executor.rs`, lines 558–599) uses the `glob` crate to match patterns like `**/*.tsx`, `**/test_*.py`. It prepends `**/` to simple patterns, caps results at 200, and skips common directories (`node_modules`, `target`, `.git`, etc.).

**Recommendation:** Add both to `aura-tools/src/fs_tools.rs`:

```rust
pub async fn fs_delete(workspace: &Path, args: Value) -> ToolResult {
    let path = resolve_and_sandbox(workspace, args["path"].as_str())?;
    std::fs::remove_file(&path)?;
    ok_result(json!({ "deleted": relative_path }))
}

pub async fn fs_find(workspace: &Path, args: Value) -> ToolResult {
    let pattern = args["pattern"].as_str()?;
    let base = args.get("path")...;  // optional subdirectory
    // glob::glob with skip_dirs filtering, cap at 200 results
    ok_result(json!({ "pattern": pattern, "file_count": n, "files": [...] }))
}
```

**Files to modify in aura-runtime:**

- `aura-tools/src/fs_tools.rs` — add `fs_delete` and `fs_find` functions
- `aura-tools/src/registry.rs` — register both tools with schemas
- Add `glob` crate dependency to `aura-tools/Cargo.toml`

---

### R7a. Tool Schema Alignment: `cmd_run` `[HIGH]`

**Problem:** aura-app's `run_command` sends a single shell string while the runtime's `cmd_run` expects structured `program` + `args`. These are fundamentally different interfaces.

**aura-app schema** (`crates/ai/tools/src/lib.rs`):

- `command` (required, string) — single shell command, e.g. `"cargo build --workspace"`
- `working_dir` (optional, string) — relative directory within project
- `timeout_secs` (optional, integer) — default 60, max 300

The executor passes `command` to `sh -c` / `cmd /C` as a single string.

**aura-runtime schema** (`aura-tools/src/registry.rs`):

- `program` (required, string) — executable name
- `args` (optional, array of strings) — arguments
- `cwd` (optional, string) — working directory
- `timeout_ms` (optional, integer) — timeout in milliseconds

**Recommendation:** The runtime should accept the aura-app schema since that is what the LLM will generate from the tool definitions. Specifically:

1. Accept `command` as a single shell string and shell-wrap internally (`sh -c` on Unix, `cmd /C` on Windows)
2. Rename `cwd` to `working_dir` (or accept both)
3. Accept `timeout_secs` (integer seconds) alongside or instead of `timeout_ms`
4. The `program` + `args` interface can remain as a secondary form if needed for internal use

**Files to modify in aura-runtime:**

- `aura-tools/src/registry.rs` — update `cmd_run` schema to accept `command`, `working_dir`, `timeout_secs`
- `aura-tools/src/executor.rs` — parse the single-string `command` field and shell-wrap it

---

### R7b. Tool Schema Alignment: `fs_edit` and `search_code` `[HIGH]`

**`fs_edit` — add `replace_all` parameter:**

aura-app's `edit_file` accepts `replace_all` (boolean, default false). When true, all occurrences of `old_text` are replaced rather than just the first. The runtime's `fs_edit` does not support this. Add an optional `replace_all` boolean to the `fs_edit` schema and implementation.

**`search_code` — align parameter name:**

aura-app uses `include` for the glob file filter (e.g. `"*.rs"`). The runtime uses `file_pattern` for the same purpose. Pick one name and align both. Recommendation: use `include` since that is what aura-app's tool definitions specify and what the LLM will emit.

**Files to modify in aura-runtime:**

- `aura-tools/src/fs_tools.rs` — add `replace_all` logic to `fs_edit`; rename `file_pattern` to `include` in `search_code`
- `aura-tools/src/registry.rs` — update schemas for both tools

---

### R8. Cancellation Support `[HIGH]`

**Problem:** aura-app supports pausing/stopping the dev loop mid-task. The runtime spec includes a `cancel` message type but implementation status is unknown.

**What the runtime spec says:** Client can send `{ "type": "cancel", "message_id": "m1" }` to cancel an in-flight message.

**Recommendation:** Verify implementation and ensure the runtime:

1. Stops the current LLM streaming call
2. Stops any running tool execution
3. Sends an `assistant_message_end` (with a `cancelled: true` flag)
4. Is ready for the next `user_message`

---

### R9. `session_init` Message Type `[CRITICAL — umbrella for R1, R2, R3]`

This is the key new protocol message that bundles R1, R2, and R3. Sent once after WebSocket connection, before any `user_message`:

```json
{
  "type": "session_init",
  "system_prompt": "You are Aura, an AI development assistant...",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "max_tokens": 16384,
    "thinking": { "enabled": true, "budget_tokens": 10000 }
  },
  "external_tools": [
    {
      "name": "task_done",
      "description": "Signal that the current task is complete",
      "input_schema": {
        "type": "object",
        "properties": {
          "notes": { "type": "string" },
          "follow_ups": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "title": { "type": "string" },
                "description": { "type": "string" }
              }
            }
          }
        },
        "required": ["notes"]
      },
      "callback_url": "http://localhost:3001/api/tools/task_done"
    }
  ],
  "workspace": {
    "git_repo_url": "https://github.com/user/project.git",
    "git_branch": "main"
  }
}
```

The runtime responds with:

```json
{
  "type": "session_ready",
  "session_id": "...",
  "available_tools": [
    "fs_read", "fs_write", "fs_edit", "fs_delete", "fs_ls",
    "fs_find", "cmd_run", "search_code", "task_done"
  ]
}
```

**This is the single most important addition to the runtime.** It transforms the runtime from a statically-configured agent into a configurable, extensible execution engine.

---

### R10. Git Workspace Initialization `[MEDIUM]`

**Problem:** For cloud execution, the microVM workspace starts empty. The project's code needs to be cloned in.

**Recommendation:** Support `workspace.git_repo_url` and `workspace.git_branch` in `session_init`. On receiving this, the runtime clones the repo into its workspace directory before sending `session_ready`. For local mode, this field is omitted and the workspace is the project's `linked_folder_path` directly.

Could also support `POST /workspace/init` as a REST endpoint for cases where workspace setup happens before a WebSocket session.

---

### R11. Build/Test Verification `[MEDIUM — can defer]`

**Problem:** aura-app runs build/test verification after task execution and auto-fixes failures.

**What aura-app does today:** `crates/ai/engine/src/build_verify.rs` runs `build_command` via shell, parses output, and the orchestrator triggers fix attempts if it fails.

**Recommendation for initial integration:** Handle at the aura-app layer. After the runtime's turn ends (`assistant_message_end`), aura-app sends a follow-up `user_message`: *"The build failed with: {stderr}. Please fix the errors."* This works without runtime changes.

**Future enhancement:** Add `verification` config to `session_init`:

```json
{
  "verification": {
    "build_command": "cargo build",
    "test_command": "cargo test",
    "auto_verify": true,
    "max_fix_attempts": 3
  }
}
```

The runtime would auto-run the build command after tool use stops and retry if it fails.

---

### R12. WebSocket Endpoint Alignment `[LOW]`

**Problem:** The spec says `WS /chat`, the aura-swarm gateway connects to `WS /stream`. These should be aligned.

**Recommendation:** Pick one and update both spec and implementation. `/stream` is more descriptive. Update `06-agent-runtime.md` to say `/stream`.

---

### R13. Terminal Output Streaming `[LOW — already in spec]`

The spec already defines `terminal_output` messages for streaming command output. aura-app's `TerminalManager` (`crates/infra/terminal/src/lib.rs`) handles interactive PTY sessions. Verify the runtime implementation streams `cmd_run` output via `terminal_output` messages for long-running commands.

---

### R14. Multi-Project Agent Chat `[MEDIUM]`

**Problem:** aura-app supports multi-project agent chat where a single agent operates across multiple projects. In `crates/ai/tools/src/lib.rs`, `multi_project_tool_definitions()` adds a required `project_id` parameter to every tool so the LLM specifies which project to target. The runtime is single-workspace — it operates on one workspace directory per session.

**What aura-app does today:** `AgentToolLoopExecutor` in `crates/ai/chat/src/chat_tool_executor.rs` validates `project_id` against a list of allowed projects and resolves the workspace path for each tool call. Each project has its own `linked_folder_path`.

**Recommendation:** Handle multi-project at the aura-app orchestration layer rather than adding multi-workspace support to the runtime. For multi-project agent chat, aura-app maintains one runtime WebSocket session per project. The aura-app agent chat handler routes tool calls to the correct session based on `project_id`. The runtime itself remains single-workspace.

This means the multi-project agent chat flow becomes:

1. aura-app opens N runtime sessions (one per project the agent can access)
2. The LLM conversation is managed by aura-app, not the runtime
3. Tool calls with `project_id` are routed to the corresponding runtime session
4. The runtime does not need multi-workspace support

**Alternative (future):** Add `workspace_id` support to the runtime so a single session can manage multiple workspaces. This would require workspace-scoped tool execution and is significantly more complex.

---

### R15. Runtime Process Lifecycle Management `[HIGH]`

**Problem:** The runtime runs as a separate process (local sidecar or cloud microVM). The document does not specify how aura-app manages the runtime's lifecycle.

**Recommendation:** Define the following:

**Local sidecar mode:**

- aura-app spawns the runtime binary as a child process on a dynamically allocated port
- aura-app passes configuration via env vars (`BIND_ADDR`, `DATA_DIR`) or CLI flags
- aura-app monitors the child process and restarts on crash
- aura-app sends `GET /health` periodically to verify liveness
- On aura-app shutdown, the runtime child process is terminated

**Cloud microVM mode:**

- aura-app connects to a pre-provisioned runtime instance via its known address
- Health checking via `GET /health` before establishing WebSocket
- If the runtime becomes unreachable, aura-app provisions a new instance

**Files to modify in aura-app:**

- New: `crates/infra/runtime/src/lib.rs` — runtime process manager (spawn, health check, restart)
- `apps/server/src/lib.rs` — integrate runtime manager into app state

---

### R16. Error Handling and Reconnection `[HIGH]`

**Problem:** No error handling strategy is defined for runtime communication failures.

**Recommendation:** Define behavior for these failure modes:

1. **WebSocket drops mid-turn:** aura-app reconnects and sends a new `session_init`. If a task was in progress, aura-app sends the conversation history (from its own records) as context in a follow-up `user_message` asking the runtime to continue.

2. **Runtime crash during task execution:** aura-app detects via health check failure or WebSocket close. It restarts the runtime (local mode) or provisions a new instance (cloud mode), then resumes with conversation history.

3. **Tool callback failure:** The runtime should include an `error` event type for propagating errors to aura-app:

```json
{
  "type": "error",
  "code": "tool_callback_failed",
  "message": "POST to http://localhost:3100/api/tools/create_spec returned 500",
  "recoverable": true
}
```

4. **LLM provider errors:** The runtime should propagate model API errors (rate limits, overload, auth failures) via the same `error` event so aura-app can handle retry/backoff.

5. **Timeout:** If a tool execution exceeds a configurable threshold, the runtime should send a `tool_timeout` event and allow the session to continue.

---

### R17. Gateway Disposition `[MEDIUM]`

**Problem:** The runtime currently routes LLM calls through `aura-gateway-ts`, a separate Node.js process that wraps the Anthropic SDK. R3 requires per-session model config, which implies the runtime (or its gateway) must accept dynamic configuration. The relationship between the gateway and the runtime is not addressed.

**Current architecture:** Runtime → `aura-gateway-ts` (HTTP POST `/propose`) → Anthropic API

**Recommendation:** Eliminate `aura-gateway-ts` and have the runtime call Anthropic directly via `aura-reasoner/src/anthropic.rs`. This:

- Removes a process dependency (no need to run a Node.js sidecar alongside the Rust binary)
- Enables per-session model config (R3) without gateway coordination
- Simplifies deployment for both local and cloud modes

**API key management:** The Anthropic API key should be accepted via:

1. Environment variable `ANTHROPIC_API_KEY` (default, for single-tenant deployment)
2. `session_init` field `api_key` (optional, for multi-tenant where aura-app manages keys per org)

If `api_key` is provided in `session_init`, it overrides the env var for that session. The runtime must not log or persist the key.

**Files to modify in aura-runtime:**

- `aura-reasoner/src/anthropic.rs` — implement direct Anthropic API calls (the `@anthropic-ai/sdk` logic from the gateway, ported to Rust using `reqwest`)
- `aura-reasoner/src/client.rs` — remove or deprecate `HttpReasoner` that proxies through the gateway
- `aura-core/src/types.rs` — add optional `api_key` to `SessionInit`

---

### R18. Intra-Session Context Window Management `[MEDIUM]`

**Problem:** aura-app has two levels of context management, and R5 only addresses one:

1. **Session-level rollover** (addressed by R5): aura-app tracks cumulative tokens across turns and starts a new session with a summary at 50% context utilization.

2. **Intra-session truncation** (not addressed): `ChatService.manage_context_window()` in `crates/ai/chat/src/chat.rs` truncates older messages within a session when `total_tokens > max_context_tokens`, keeping the most recent N messages and summarizing the rest.

**Recommendation:** The runtime should own intra-session context management since it maintains the conversation history (R4). Specifically:

- The runtime should accept `max_context_tokens` and `keep_recent_messages` in `session_init`
- When the conversation history approaches the token limit, the runtime truncates older messages (keeping the most recent N) and optionally generates a summary prefix
- The runtime reports context utilization in `session_usage` (R5) so aura-app can decide whether to close and re-create the session

```json
{
  "type": "session_init",
  "context_management": {
    "max_context_tokens": 150000,
    "keep_recent_messages": 10
  }
}
```

If omitted, the runtime uses the model's full context window with no automatic truncation, and aura-app handles rollover via R5.

---

### R19. Approval Flow for Tool Execution `[LOW]`

**Problem:** aura-app supports human-in-the-loop controls (pause/resume/stop dev loop). The runtime's spec-02 describes an approval flow where certain tool executions require client confirmation before proceeding (`ApprovalRequest` / `ApprovalResponse`), but this is not referenced in the integration requirements.

**Recommendation:** Support an optional approval mechanism in the runtime protocol:

1. In `session_init`, the client can specify tools that require approval:

```json
{
  "type": "session_init",
  "approval_required": ["cmd_run", "fs_delete"]
}
```

2. Before executing an approval-required tool, the runtime sends:

```json
{
  "type": "approval_request",
  "tool_call_id": "tc_123",
  "tool_name": "cmd_run",
  "input": { "command": "rm -rf dist/" }
}
```

3. The client responds with:

```json
{
  "type": "approval_response",
  "tool_call_id": "tc_123",
  "approved": true
}
```

4. If rejected, the runtime feeds a "tool execution denied by user" result back to the LLM.

This is low priority for initial integration but aligns with aura-app's existing human-in-the-loop controls and the runtime's own spec-02 design.
