/**
 * Seed content for the AURA OS whitepaper CMS (the public `/os` page).
 *
 * The first part of the whitepaper is the **Harness**, split into the ten
 * layers of the harness architecture (plus an overview and the user-flow
 * diagrams). Each entry below becomes a published note under the reserved
 * aura-whitepaper project; the `section` field doubles as the collapsible
 * left-nav group key on the public page, and `sortOrder` controls the
 * within-section order. Content is transcribed from
 * `../aura-harness/docs/architecture.md` and is fully editable afterwards
 * by sys admins in the Notes app.
 */

/**
 * Markdown fence token. Kept as a double-quoted constant so the section
 * bodies below can embed fenced code blocks (ASCII diagrams) via
 * interpolation without escaping every backtick.
 */
const F = "```";

export interface WhitepaperSection {
  /** Human title; also the left-nav label. */
  title: string;
  /** URL slug (stable, kebab-case). */
  slug: string;
  /** Collapsible section group key (e.g. "harness"). */
  section: string;
  /** Within-section order (ascending). */
  sortOrder: number;
  /** Short summary (shown as the section lede / listing). */
  excerpt: string;
  /** Markdown body. */
  body: string;
}

/** Display name for a section key. Extend as new top-level parts land. */
export const SECTION_LABELS: Readonly<Record<string, string>> = {
  harness: "Harness",
};

export const WHITEPAPER_SECTIONS: WhitepaperSection[] = [
  {
    title: "Overview",
    slug: "harness-overview",
    section: "harness",
    sortOrder: 0,
    excerpt:
      "The ten-layer stack, the strict downward-only dependency rule, and the AgentMode resolution chain.",
    body: `# Overview

The Aura Harness architecture is organized into **ten layers**. Crates are named \`aura-<layer>-<name>\` and may depend only on crates whose layer is the same or lower.

${F}text
core  <  store  <  config  <  model  <  context  <
plugin  <  exec  <  agent   <  fleet  <  surface
${F}

## Layers, in dependency order

| Layer | Purpose |
|-------|---------|
| core | Behavior-free IDs, capability enums, mode primitives, wire types. |
| store | Durable storage: agent state, append-only audit log, snapshot I/O. |
| config | Single source of truth for env vars + TOML config. |
| model | LLM provider trait + streaming completions. |
| context | Read-only context assembly (memory, skills, compaction, prompts). |
| plugin | Plugin manifest schema, in-process API, hooks, MCP, connectors. |
| exec | Tool catalog, execution runner, sandbox, policy, isolation, conflict locks. |
| agent | Single-agent turn loop + audited kernel + steering + subagent derivation. |
| fleet | Multi-agent registry, spawn, dispatch, quota, mailbox, daemon composition root. |
| surface | Composition roots: CLI / TUI / SDK / automaton / auth / HTTP-WS gateway / engine. |

## Dependency rules

- A crate may depend on crates in the same layer or any lower layer. Upward edges fail CI via the layer-boundary test.
- Every \`crates/<crate>/src/lib.rs\` carries a \`//! Layer: <layer>\` doc-comment that must match the known-crates table in the boundary test.
- **One documented exception** remains: \`aura-tools -> aura-kernel\` is allowlisted as a Phase 10 follow-up (the deep fix is to relocate \`Executor\` / \`ExecuteContext\` / \`SpawnHook\` traits from the agent layer to the exec layer).

## Layered dependency diagram

Arrows point in the only allowed dependency direction: **downward**.

${F}text
surface  — CLI · TUI · SDK · HTTP/WS gateway · engine · domain HTTP · automaton · auth
   │
fleet    — registry · spawn · dispatch · quota · mailbox · daemon · subagent dispatcher
   │
agent    — deterministic kernel · AgentLoop · steering · subagent derivation
   │
exec     — tool catalog · runner · sandbox · policy · isolation · conflict locks
   │        ⚠ warn-only upward edge: aura-tools ─ ─▶ aura-kernel
   │
plugin   — manifest schema · in-process API · hooks · MCP · connectors
   │
context  — read-only prompt assembly · memory · compaction · skills
   │
model    — LLM provider trait · streaming completions
   │
config   — env vars + TOML config (single source of truth)
   │
store    — durable storage · sealed WriteStore (Invariant §10)
   │
core     — behavior-free IDs · capability enums · modes · wire types
${F}

## AgentMode resolution priority

\`AgentMode\` (\`Agent\` / \`Plan\` / \`Ask\` / \`Debug\`) is the headline gate consulted before every external effect — it runs **before** the policy layer's permission check, not as a substitute for it. The resolution order at session start is:

1. **CLI flag** — \`aura --mode <agent|plan|ask|debug>\`.
2. **TUI slash command** — \`/mode <agent|plan|ask|debug>\`.
3. **SDK field** — \`SessionConfig::mode\`.
4. **Daemon default** — \`FleetConfig::default_mode\` (overridable via \`AURA_FLEET_DEFAULT_MODE\`).
5. **Fallback** — \`AgentMode::Agent\`.

\`resolve_session_mode\` consumes an \`AgentModeInputs\` and applies the priority deterministically. The result is recorded on the session and propagated to every child agent through \`derive_subagent\` (children may only narrow, never widen).

## Foreground subagents

The v1 subagent model is foreground and local to one harness instance. A parent agent calls the \`task\` tool, which validates \`Capability::SpawnAgent\` and hands a \`SubagentDispatchRequest\` to a \`SubagentDispatchHook\`. The tool is fail-closed when that hook is absent. Dispatch is split across three layers (exec declares the trait, agent owns the pure data + derivation, fleet owns the concrete dispatcher) so every Cargo edge stays downward.

## External-consumer invariant

\`aura-runtime\` is the **sole Cargo surface** for any external Rust consumer of the harness. External repos (\`aura-os\`, any future SDK consumer) interact with the harness exclusively over the wire — \`POST /v1/run\` for submission, \`WS /stream/:run_id\` for events, plus the management endpoints. No external \`Cargo.toml\` may depend on \`aura-engine\`, \`aura-domain-http\`, \`aura-agent-subagent\`, \`aura-fleet-subagent\`, \`aura-kernel\`, or any other lower-layer crate. This rule lets \`aura-runtime\`'s composition root evolve internally without dragging every external consumer through a coordinated migration.`,
  },
  {
    title: "Core layer",
    slug: "harness-core-layer",
    section: "harness",
    sortOrder: 1,
    excerpt:
      "Behavior-free crates: IDs, capability enums, modes, and wire types that every other layer reaches for.",
    body: `# Core layer

The foundation. Behavior-free crates that define the IDs, capability enums, modes, and wire types that every other layer reaches for. No I/O, no async runtime, no aura-* dependencies.

#### \`aura-core-types\`

Strongly-typed identifier newtypes (\`TurnId\`, \`RunId\`, \`ToolCallId\`, \`SessionId\`) and the small share-by-value structs that the agent/fleet layers traffic in. Re-exports \`AgentMode\` and \`Capability\` for crates that want a single import surface.

#### \`aura-core-modes\`

Closed \`AgentMode\` enum (\`Agent\`, \`Plan\`, \`Ask\`, \`Debug\`) plus the \`ModeGate\` and \`ModeViolation\` primitives consulted before every external effect. Also owns \`CapabilityProfile\`, the per-mode capability mask the policy layer narrows against.

#### \`aura-core-permissions\`

Privilege types (\`Capability\`, \`Permissions\`, \`EffectivePermissions\`) and the pure resolution math — \`narrow\`, \`intersect\`, \`effective\` — used by both the kernel's policy gate and \`aura-exec-policy\`. Pure functions only.

#### \`aura-core-auth\`

Auth primitive types: \`AccessToken\`, \`RefreshToken\`, \`Token\`, \`StoredSession\`, \`AuthError\`. Data only; the surface-layer shells provide the keyring and HTTP implementations.

#### \`aura-core-protocol\`

Wire-protocol primitives — currently \`ProtocolVersion\` and \`PROTOCOL_VERSION\`. Used by the SDK and the WS handshake to negotiate compatible versions.

#### \`aura-core\` (shell)

Compatibility shell. Re-exports the split core crates and still hosts the larger domain types (\`Transaction\`, \`Action\`, \`Effect\`, \`RecordEntry\`, \`ToolCall\`, \`ToolResult\`, \`Identity\`, \`AuraError\`) that have not yet been moved to a more specific home.

#### \`aura-protocol\`

Serde types for the wire API consumed by \`aura-runtime\` and external clients. Owns \`RuntimeRequest\` (canonical \`POST /v1/run\` body), \`RuntimeRunResponse\` (\`{ run_id, event_stream_url }\`), \`AgentPersona\`, \`InboundMessage\`, and \`OutboundMessage\`. Self-contained so external clients can depend on it without pulling in the runtime.`,
  },
  {
    title: "Store layer",
    slug: "harness-store-layer",
    section: "harness",
    sortOrder: 2,
    excerpt:
      "Durable persistence: the append-only record log and all RocksDB column families. Owns Invariant §10.",
    body: `# Store layer

Durable persistence. Owns the append-only record log and all RocksDB column families. **Invariant §10** lives here: the record-append surface (\`append_entry_atomic\`, \`append_entries_batch\`, …) lives on the sealed \`WriteStore\` trait, so only the kernel's \`Arc<dyn WriteStore>\` can commit a record entry. Non-kernel callers depend on \`Arc<dyn ReadStore>\`.

#### \`aura-store-db\`

RocksDB-backed durable storage. Owns the three column families (\`record\`, \`agent_meta\`, \`inbox\`), the key encoders, and the atomic \`WriteBatch\` commit path. Implements both \`Store\` (legacy) and the sealed \`WriteStore\`.

#### \`aura-store-record\`

Append-only domain types and the \`RecordLog\` trait contract independent of any storage backend. Defines \`RecordEntry\`, \`RecordKind\`, and \`RecordLogError\`.

#### \`aura-store-snapshot\`

Content-addressed snapshot store trait (\`SnapshotStore\`, \`SnapshotError\`, \`NoopSnapshotStore\`). V1 ships a no-op stub.

#### \`aura-store\` (shell)

Re-export shell over \`aura-store-db\` so legacy \`aura_store_db::*\` imports keep compiling unchanged.`,
  },
  {
    title: "Config layer",
    slug: "harness-config-layer",
    section: "harness",
    sortOrder: 3,
    excerpt:
      "Configuration loading and the resolved configuration types — the single source of truth for env + TOML.",
    body: `# Config layer

Configuration loading and the resolved configuration types. The single source of truth for env vars and TOML config — every other crate reaches \`aura_config::loaded()\` rather than calling \`std::env::var\` directly.

#### \`aura-config\`

\`AuraConfig\` aggregate plus the per-subsystem \`AgentConfig\`, \`ReasonerConfig\`, \`FleetConfig\` (carries \`default_mode\` — the daemon rung of the \`AgentMode\` resolution chain), and the env loader (\`AURA_HOME\`, \`AURA_FLEET_DEFAULT_MODE\`, retry/thinking budgets). Hosts the \`aura migrate\` stub.`,
  },
  {
    title: "Model layer",
    slug: "harness-model-layer",
    section: "harness",
    sortOrder: 4,
    excerpt:
      "The LLM provider abstraction: the ModelProvider trait, stream types, and the Anthropic-shaped client.",
    body: `# Model layer

LLM provider abstraction. Defines the \`ModelProvider\` trait, normalized message and stream types, and the (single) Anthropic-shaped router/proxy client. **Invariant §1** lives here: only \`KernelModelGateway\` (in the agent layer) may hold a \`ModelProvider\` for production code paths — automatons take \`P: RecordingModelProvider\`, a sealed marker trait that only the recording gateway implements.

#### \`aura-model-reasoner\`

\`ModelProvider\` trait (\`complete\`, \`complete_streaming\`, \`health_check\`), \`ModelRequest\` / \`ModelResponse\` shapes, \`Message\` / \`ContentBlock\` / \`StopReason\`, the \`StreamEvent\` SSE family and \`StreamAccumulator\`, the proxy-routed \`AnthropicProvider\` (with retry + model-chain fallback), and \`MockProvider\` for tests.

#### \`aura-reasoner\` (shell)

Re-export shell over \`aura-model-reasoner\` for source-compatible imports.`,
  },
  {
    title: "Context layer",
    slug: "harness-context-layer",
    section: "harness",
    sortOrder: 5,
    excerpt:
      "Read-only context assembly: prompt rendering, per-agent memory, history compaction, skill packages.",
    body: `# Context layer

Read-only context assembly. Everything that pulls signal *into* the prompt without producing side effects: prompt rendering, per-agent memory, message-history compaction, skill packages.

#### \`aura-context-prompts\`

Render-only construction of every model-facing string: system prompts, bootstrap blocks, steering injections, error-recovery fix prompts. Notable types: \`SystemPromptBuilder\`, \`bootstrap\`, \`SteeringRenderer\`, \`descriptors\`.

#### \`aura-context-memory\`

Per-agent long-term memory: fact storage, episodic events, procedural pattern detection, a two-stage write pipeline (heuristic extraction → optional LLM refinement), deterministic retrieval for prompt injection, and consolidation. \`MemoryManager\` is the facade embedders use. Stores live in dedicated column families — never the record log.

#### \`aura-context-compaction\`

Unified pure compaction: message-history tier selection, pressure-gated write/edit input redaction, structured \`_redacted\` markers, cached tool-result summaries, tool-surface compaction, storage compaction. Does not call a model itself — \`aura-agent\` performs the model call and applies the result through this crate.

#### \`aura-context-skills\`

Skill system wire-compatible with the Claude Code \`SKILL.md\` / \`AgentSkills\` open standard. Loader precedence: workspace → agent-personal → personal → extra dirs → bundled. \`SkillManager\` exposes activation and prompt-injection; \`SkillInstallStore\` persists per-agent installs.

Each surface also ships a legacy \`aura-{prompts,memory,compaction,skills}\` re-export shell.`,
  },
  {
    title: "Plugin layer",
    slug: "harness-plugin-layer",
    section: "harness",
    sortOrder: 6,
    excerpt:
      "The plugin runtime: contributor API, on-disk manifest/install pipeline, hooks, MCP, and connectors.",
    body: `# Plugin layer

The plugin runtime. Splits into a contributor API surface (first-party plugins shipped in-tree) and an on-disk manifest / install / cache / marketplace pipeline, plus the runtime surfaces — hooks, MCP, connectors.

#### \`aura-plugin-api\`

In-process contributor trait surface for first-party plugins. \`PluginContributor\`, \`ContributionKind\`, \`PluginRoot\`, \`PluginId\`. Not a dynamic loader — plugins are compiled in and registered at startup.

#### \`aura-plugin-core\`

Declarative manifest schema, install pipeline, cache layout under \`AURA_HOME/plugins/\`, and marketplace lookup. Owns \`PluginManifest\`, \`install\`, \`marketplace\`, and the trust-prompt flow.

#### \`aura-plugin-hooks\`

Hook engine: closed \`HookEvent\` taxonomy (10 Codex/Claude-aligned lifecycle events), \`HookEngine\`, \`HookOutcome\`, and the sandboxed env scrubbing for hook commands.

#### \`aura-plugin-mcp\`

Stdio MCP JSON-RPC client and a first-active-wins connection manager keyed by server id. \`McpClient\`, \`McpConnectionManager\`, \`ServerConfig\`, \`McpError\`. Clears child environments before spawn and applies a per-request timeout.

#### \`aura-plugin-connectors\`

Thread-safe registry of plugin-contributed external endpoints. \`ConnectorRegistry\`, \`ConnectorEntry\`, \`ConnectorError\`. Last-wins registration semantics.`,
  },
  {
    title: "Exec layer",
    slug: "harness-exec-layer",
    section: "harness",
    sortOrder: 7,
    excerpt:
      "Tool execution surface: tool catalog, runner, sandbox primitives, conflict locks, and worktree isolation.",
    body: `# Exec layer

Tool execution surface. Everything from the tool catalog down through sandbox primitives, conflict locks, and worktree isolation.

> **Warn-only edge:** \`aura-tools -> aura-kernel\` is the single remaining upward dependency in the workspace. The deep fix is to relocate \`Executor\` / \`ExecuteContext\` / \`SpawnHook\` traits to a new exec-layer home — tracked as a Phase 10 follow-up.

#### \`aura-exec-conflict\`

Domain-scoped advisory locks (\`ConflictRegistry\`, \`ConflictDomain\`, \`LockHandle\`, \`ConflictError\`) that reduce sibling collisions when multiple agents target the same logical resource.

#### \`aura-exec-isolation\`

Subagent workspace isolation. \`WorktreeIsolation\` (git worktree) is the preferred path; \`CopyIsolation\` is the fallback. Returns an \`IsolatedWorkspace\` handle that the spawner mounts before scheduling the child.

#### \`aura-exec-policy\`

Pure approval / verdict evaluation over already-resolved effective permissions for a tool call. \`evaluate\`, \`ToolApproval\`, \`PolicyError\`. No \`ModelProvider\` or \`Store\` deps.

#### \`aura-exec-sandbox\`

OS-level containment primitives: \`FsSandbox\` (path canonicalisation, prefix-check, symlink guard) and \`ProcessSandbox\` (subprocess spawn guardrails).

#### \`aura-exec-tools\` / \`aura-exec-runner\`

Layered re-export shells over \`aura-tools\` plus \`sandbox\` / \`policy\` sub-modules and the \`ToolExecutor\` alias with conflict + isolation re-exports.

#### \`aura-tools\`

Tool catalog, resolver, and sandboxed filesystem/command execution. Implements the \`Executor\` trait from \`aura-agent-kernel\`. Hosts:

- Built-in filesystem tools: \`list_files\`, \`read_file\`, \`write_file\`, \`edit_file\`, \`stat_file\`, \`find_files\`, \`delete_file\`, \`search_code\` (ripgrep), \`run_command\`.
- Git tools (\`git_commit\`, \`git_push\`, \`git_commit_push\`) — the *only* permitted call-site for mutating \`Command::new("git")\` (Invariant §1).
- Domain tools: HTTP/API-backed handlers for orbit, network, specs, tasks, projects, storage via the \`DomainApi\` trait.
- \`task\` tool — consumes the exec-layer \`SubagentDispatchHook\` trait this crate declares.
- Automaton tools: dev-loop and task-run controls gated behind an \`AutomatonController\` trait.
- Catalog + resolver: \`ToolCatalog\`, \`ToolResolver\`, \`ToolProfile\` (\`Core\` / \`Agent\` / \`Engine\`), \`CatalogEntry\`.`,
  },
  {
    title: "Agent layer",
    slug: "harness-agent-layer",
    section: "harness",
    sortOrder: 8,
    excerpt:
      "The deterministic core of a single agent: audited kernel, the multi-step turn loop, steering, subagents.",
    body: `# Agent layer

The deterministic core of a single agent. The kernel records every reasoning call, every tool proposal, every policy decision, every effect. **Invariants §1 through §11** are all owned here.

#### \`aura-agent-kernel\`

The deterministic kernel. Builds context from the record window, calls the reasoner, enforces policy, dispatches execution through the \`ExecutorRouter\`, and produces \`RecordEntry\`s. Given the same record, produces the same output. Key types: \`Kernel\`, \`KernelConfig\`, \`ExecutorRouter\`, \`Executor\`, \`ExecuteContext\`, \`Policy\`, \`ContextBuilder\`, \`ReplayConsumer\`.

#### \`aura-agent-loop\`

Thin re-export shell over \`aura-agent\`'s multi-step turn loop. Provides \`AgentLoop\`, \`AgentLoopConfig\`, \`TurnEvent\`, \`RunOptions\` at a stable surface.

#### \`aura-agent-steering\`

Stateful per-turn steering evaluators. Built-ins: \`RepeatedReadTracker\`, \`ImplementNow\`, \`EarlyOracle\`. \`SteeringRegistry\` and \`TurnSteering\` thread them through each iteration.

#### \`aura-agent-subagent\`

Subagent derivation, inheritance, registry, and the pure-data adapter layer. \`derive_subagent(parent, request)\` produces a \`SubagentSpec\` that may only narrow the parent's mode, permissions, and model.

#### \`aura-agent\`

The multi-step orchestration loop and everything that wraps the kernel: streaming, blocking detection, stall detection, budget management, compaction orchestration, build verification, message sanitization, planning, self-review, file-ops pipeline. Key bridges: \`KernelToolGateway\`, \`KernelModelGateway\`, \`KernelDomainGateway\`, and \`RecordingModelProvider\` (sealed marker trait).

#### \`aura-kernel\` (shell)

Re-export shell over \`aura-agent-kernel\` preserving historical \`aura_agent_kernel::*\` paths.`,
  },
  {
    title: "Fleet layer",
    slug: "harness-fleet-layer",
    section: "harness",
    sortOrder: 9,
    excerpt:
      "The multi-agent runtime: registry, spawn pipeline, dispatch, quota, mailbox, and the subagent dispatcher.",
    body: `# Fleet layer

The multi-agent runtime. Above the single-agent kernel: registry of live agents, spawn pipeline, dispatch, quota tracking, mailbox, the concrete subagent dispatcher, and the composition root that wires them together. **Invariant §12** (single writer per agent) crosses the agent/fleet boundary.

#### \`aura-fleet-registry\`

In-memory directory of live and recently-terminated agents known to the fleet daemon. \`FleetRegistry\`, \`AgentSlot\`, \`AgentState\`, \`RegistryError\`.

#### \`aura-fleet-quota\`

Concurrency and resource budgets across the fleet. \`QuotaPool\` plus the RAII \`BudgetTicket\` that releases its slot on drop.

#### \`aura-fleet-spawn\`

The subagent spawn pipeline: idempotent dedupe, per-parent audit-append lease (\`ParentLeaseRegistry\`), \`derive_subagent\` invocation, quota ticket acquisition, \`RecordEntry\` audit append, and the \`SpawnMode::{Wait, Detached, Batch}\` execution. Orphan handoff on parent death is owned by the \`OrphanStore\`.

#### \`aura-fleet-dispatch\`

Routes a stream of \`AgentJob\` items into \`FleetSpawner::spawn\`.

#### \`aura-fleet-mailbox\`

Bounded MPSC mailbox of \`AgentJob\` with backpressure and typed send errors.

#### \`aura-fleet-daemon\`

Composition root that wires registry, spawner, dispatcher, quota, and mailbox into a single \`FleetDaemon\` handle. Also hosts \`resolve_session_mode\` and \`AgentModeInputs\`.

#### \`aura-fleet-subagent\`

Hosts the concrete \`FleetSubagentDispatcher\` impl of \`SubagentDispatchHook\`. Composes the spawner + registry + quota with the agent-layer registry and a surface-layer \`ChildRunner\`. Fail-closed; the only place the fleet wires spawn-mode outcomes into the task tool's response.`,
  },
  {
    title: "Surface layer",
    slug: "harness-surface-layer",
    section: "harness",
    sortOrder: 10,
    excerpt:
      "Composition roots: CLI, TUI, SDK, the HTTP/WS gateway, the orchestration engine, domain HTTP, and auth.",
    body: `# Surface layer

Composition roots. Each surface assembles dependencies from the lower layers into a runnable entry point (CLI, TUI, SDK, headless server, automaton host) or a side-effectful client.

#### \`aura-surface-cli\`

CLI composition root. Owns the clap \`Cli\` / \`Commands\` / \`RunArgs\` definitions, the \`ModeFlag\` global flag (top of the \`AgentMode\` resolution chain), the event-loop wiring, the record-loader utility, and the surface-layer \`session_helpers\`.

#### \`aura-surface-sdk\`

External SDK types for talking to a fleet daemon over \`aura-core-protocol\`. \`AuraClient\`, \`AuraSession\`, \`SessionConfig\` (carries \`mode\`), \`SdkError\`. Transport is pluggable.

#### \`aura-surface-terminal\` / \`aura-surface-automaton\` / \`aura-surface-auth\`

Shells over the legacy \`aura-terminal\`, \`aura-automaton\`, and zOS HTTP/credential crates. \`aura-surface-terminal\` adds the typed \`SlashModeCommand\`.

#### \`aura-runtime\`

The HTTP/WS **gateway crate** plus the composition root for the \`aura-node\` binary. The inbound-traffic seam plus the composition root that assembles every lower layer into a runnable server. The **sole Cargo surface** for external Rust consumers. \`node.rs\` binds the listener, opens the store, builds the engine + subagent dispatcher + domain API, builds the gateway \`Router\`, and runs the axum server with graceful shutdown.

#### \`aura-engine\`

Owns the orchestration engine. \`scheduler.rs\` (per-agent single-writer claim, Invariant §12.a), \`worker.rs\` (\`process_agent\`), the automaton bridge, memory observer, capabilities recorder, executor factory, and \`child_runner.rs\` (\`RuntimeChildRunner\`, the surface-layer impl of \`ChildRunner\`).

#### \`aura-domain-http\`

Hosts the HTTP \`DomainApi\` implementation that the kernel domain gateway and automaton bridge consume. \`HttpDomainApi\` (reqwest-backed) and \`JwtDomainApi\` (injects a captured JWT).

#### \`aura-terminal\` / \`aura-automaton\` / \`aura-auth\`

The Ratatui-based terminal UI library; the long-running automaton workflows (\`ChatAutomaton\`, \`DevLoopAutomaton\`, \`SpecGenAutomaton\`, \`TaskRunAutomaton\`); and the zOS login client + credential persistence.`,
  },
  {
    title: "User flows",
    slug: "harness-user-flows",
    section: "harness",
    sortOrder: 11,
    excerpt:
      "How data moves through the system for interactive, run-kickoff, headless, and error-recovery paths.",
    body: `# User flows

The same kernel/AgentLoop pipeline drives every front-end. Before any external effect, the resolved \`AgentMode\` gates the action; the policy layer then narrows further per-tool.

## Flow 1: Interactive TUI session

Default mode when a user runs \`cargo run\` or \`aura\`.

**Data path:** User input → \`UiEvent\` channel → Event Loop appends to \`Vec<Message>\` → \`AgentLoop.run_with_events()\` → streaming \`TurnEvent\`s back through an \`mpsc\` channel → Event Loop maps to \`UiCommand\` → Terminal renders. On a \`ToolUse\` stop reason, the kernel runs the mode + policy check, dispatches through the \`ExecutorRouter\` to sandboxed FS / command tools, and feeds the \`Effect\` back to the loop.

## Flow 2: Run kickoff + WebSocket session

Used by \`aura-os\` and other clients connecting over the harness wire. A **two-step exchange**:

${F}text
Client                    Gateway / Engine
  │  POST /v1/run  ──────────▶ resolve_session_mode → Engine::submit(req)
  │  ◀── 201 { run_id, event_stream_url }
  │  WS connect /stream/:run_id ─▶ open_chat_stream → create Session
  │  ◀── Outbound::SessionReady
  │  Inbound::UserMessage ──▶ run_with_events → model + tools
  │  ◀── Outbound::TextDelta / ToolResult / AssistantMessageEnd
${F}

The client never sends an init frame — the run is already up by the time the WS attaches. A \`Cancel\` may arrive at any time and trips the \`CancellationToken\`. \`DevLoop\` and \`TaskRun\` follow the same two-step exchange but their WS is event-only.

## Flow 3: Headless node (scheduler-driven)

When running \`aura run --ui none\` or as \`aura-node\`, transactions are submitted via HTTP and processed by the engine's scheduler.

**Data path:** HTTP \`POST /tx\` → Store inbox → Scheduler dequeues (acquiring the per-agent claim, Invariant §12) → Worker runs \`AgentLoop\` → result committed atomically to the record log via \`append_entry_atomic\` → Client polls via \`GET /agents/{id}/record\`. Subagent spawn lands through \`FleetSubagentDispatcher\` and re-enters the same scheduler lane, inheriting the per-agent processing claim.

## Flow 4: Streaming error recovery (StreamReset)

When a streaming model call fails mid-stream, the system recovers deterministically: partial \`TextDelta\`s already shown are cleared via \`TurnEvent::StreamReset\`, then a non-streaming \`provider.complete(request)\` fallback produces the authoritative content, re-emitted as a single \`TextDelta\`.

## Data lifecycle summary

Every user interaction follows the same fundamental path: input becomes a transaction, the \`AgentLoop\` orchestrates model calls and tool execution in a loop, results are emitted as \`TurnEvent\`s for real-time display, and the final state is persisted as a \`RecordEntry\` in the append-only log.`,
  },
];
