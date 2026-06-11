/**
 * Seed content for the AURA OS whitepaper CMS (the public `/os` page).
 *
 * The first part of the whitepaper is the **AURA Harness**, split into the ten
 * layers of the harness architecture (plus an overview, the architectural
 * invariants, and the user-flow diagrams). Each entry below becomes a
 * published note under the reserved
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
  harness: "AURA Harness",
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

AURA Harness is a Rust agent runtime built as ten strictly-layered crates, from behavior-free primitives up to runnable composition roots. A single resolved \`AgentMode\` gates every external effect before the policy layer narrows it further.

## Overview

- Ten layers — \`core\`, \`store\`, \`config\`, \`model\`, \`context\`, \`plugin\`, \`exec\`, \`agent\`, \`fleet\`, \`surface\` — with every crate named \`aura-<layer>-<name>\`.
- Strict **downward-only** dependency rule, enforced in CI by the layer-boundary test (one allowlisted exception: \`aura-tools\` depends on \`aura-kernel\`).
- \`AgentMode\` (\`Agent\` / \`Plan\` / \`Ask\` / \`Debug\`) resolves deterministically: CLI flag, then TUI slash command, then SDK field, then daemon default, then fallback.
- Foreground, local subagents via the \`task\` tool, with dispatch split across the exec / agent / fleet layers so every Cargo edge stays downward.
- \`aura-runtime\` is the **sole Cargo surface** for external consumers; everyone else talks over the wire (\`POST /v1/run\`, \`WS /stream/:run_id\`).

## Architecture

Arrows point in the only allowed dependency direction: **downward**.

${F}text
surface  — CLI · TUI · SDK · HTTP/WS gateway · engine · domain HTTP · automaton · auth
   │
fleet    — registry · spawn · dispatch · quota · mailbox · daemon · subagent dispatcher
   │
agent    — deterministic kernel · AgentLoop · steering · subagent derivation
   │
exec     — tool catalog · runner · sandbox · policy · isolation · conflict locks
   │        warn-only upward edge: aura-tools --> aura-kernel
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

## Request lifecycle (internals)

Every front-end funnels into the same kernel / \`AgentLoop\` pipeline. The resolved \`AgentMode\` gates each external effect before the policy layer narrows per tool.

${F}text
mode resolution (first match wins)
  CLI --mode  >  /mode (TUI)  >  SDK SessionConfig.mode  >
  FleetConfig.default_mode  >  AgentMode::Agent (fallback)
        |
        v
 input -> Transaction -> AgentLoop --reason--> ModelProvider
        ^                    |  stop = ToolUse        |
        |                    v                        |
        |          mode gate + Policy::check          |
        |                    |  allow                 |
        |          ExecutorRouter -> Tools (sandbox)  |
        |                    |                        |
        +------- Effect -----+    --> RecordEntry (append-only log)
                                  --> TurnEvents (UI / WS)
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
- **One documented exception** remains: \`aura-tools\` depends on \`aura-kernel\`, allowlisted as a Phase 10 follow-up (the deep fix is to relocate \`Executor\` / \`ExecuteContext\` / \`SpawnHook\` traits from the agent layer to the exec layer).

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
    title: "1. Core",
    slug: "harness-core-layer",
    section: "harness",
    sortOrder: 1,
    excerpt:
      "Behavior-free crates: IDs, capability enums, modes, and wire types that every other layer reaches for.",
    body: `# 1. Core

The foundation layer: behavior-free crates that define the IDs, capability enums, modes, and wire types every other layer reaches for. No I/O, no async runtime, and no \`aura-*\` dependencies.

## Overview

- Strongly-typed ID newtypes and small share-by-value structs (\`aura-core-types\`).
- The closed \`AgentMode\` enum plus \`ModeGate\` / \`ModeViolation\` and \`CapabilityProfile\` (\`aura-core-modes\`).
- Privilege types and pure permission math — \`narrow\`, \`intersect\`, \`effective\` (\`aura-core-permissions\`).
- Auth primitive data types and wire-protocol version primitives (\`aura-core-auth\`, \`aura-core-protocol\`).
- Compatibility shell plus the serde wire API external clients depend on (\`aura-core\`, \`aura-protocol\`).

## Architecture

${F}text
core
 ├─ aura-core-types        IDs · share-by-value structs
 ├─ aura-core-modes        AgentMode · ModeGate · CapabilityProfile
 ├─ aura-core-permissions  Capability · permission math
 ├─ aura-core-auth         AccessToken · StoredSession
 ├─ aura-core-protocol     ProtocolVersion
 ├─ aura-core (shell)      re-exports + larger domain types
 └─ aura-protocol          RuntimeRequest · wire API
${F}

## Internals

Permissions resolve through pure functions: a request's capabilities are narrowed against the per-mode \`CapabilityProfile\`, then intersected with the agent's grant to produce the \`EffectivePermissions\` the policy gate reads.

${F}text
 CapabilityProfile (per AgentMode)
        |
        v
   narrow(requested, profile)
        |            Permissions (agent grant)
        v            |
     intersect( .  , . )
        |
        v
   EffectivePermissions  -->  aura-exec-policy::evaluate  /  kernel Policy::check
${F}

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
    title: "2. Store",
    slug: "harness-store-layer",
    section: "harness",
    sortOrder: 2,
    excerpt:
      "Durable persistence: the append-only record log and all RocksDB column families. Owns Invariant §10.",
    body: `# 2. Store

Durable persistence: the append-only record log and all RocksDB column families. Owns **Invariant §10** — the sealed write surface that keeps record commits in the kernel's hands.

## Overview

- RocksDB-backed storage with three column families (\`record\`, \`agent_meta\`, \`inbox\`) and the atomic \`WriteBatch\` commit path (\`aura-store-db\`).
- **Invariant §10**: the record-append surface (\`append_entry_atomic\`, \`append_entries_batch\`) lives on the sealed \`WriteStore\` trait, so only the kernel's \`Arc<dyn WriteStore>\` can commit; everyone else holds \`Arc<dyn ReadStore>\`.
- Backend-independent append-only domain types and the \`RecordLog\` contract (\`aura-store-record\`).
- Content-addressed snapshot trait with a v1 no-op stub (\`aura-store-snapshot\`).
- A re-export shell for source-compatible imports (\`aura-store\`).

## Architecture

${F}text
store
 ├─ aura-store-db        RocksDB · column families · WriteStore impl
 ├─ aura-store-record    RecordEntry · RecordKind · RecordLog trait
 ├─ aura-store-snapshot  SnapshotStore (no-op v1)
 └─ aura-store (shell)   re-exports aura-store-db
${F}

## Internals

The sealed \`WriteStore\` is the only commit path; \`ReadStore\` is everyone else's surface. A new backend cannot be written outside \`aura-store-db\` because the \`Sealed\` marker is crate-private.

${F}text
        Kernel
          |  Arc<dyn WriteStore>  (sealed: append_entry_atomic, _batch, ...)
          v
   +---------------------------+      non-kernel: Arc<dyn ReadStore>
   |  aura-store-db RocksStore  |<---- scan / get_head_seq / enqueue_tx
   +------------+--------------+
                |  single WriteBatch (atomic)
        +-------+--------+-------------+
        v                v             v
    CF: record      CF: agent_meta   CF: inbox
   key = (agent_id, seq)
${F}

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
    title: "3. Config",
    slug: "harness-config-layer",
    section: "harness",
    sortOrder: 3,
    excerpt:
      "Configuration loading and the resolved configuration types — the single source of truth for env + TOML.",
    body: `# 3. Config

Configuration loading and the resolved configuration types: the single source of truth for env vars and TOML. Every other crate reaches \`aura_config::loaded()\` instead of calling \`std::env::var\` directly.

## Overview

- The \`AuraConfig\` aggregate plus per-subsystem \`AgentConfig\`, \`ReasonerConfig\`, and \`FleetConfig\`.
- \`FleetConfig\` carries \`default_mode\` — the daemon rung of the \`AgentMode\` resolution chain.
- The env loader for \`AURA_HOME\`, \`AURA_FLEET_DEFAULT_MODE\`, and retry / thinking budgets.
- A single chokepoint so configuration never scatters into ad-hoc \`std::env::var\` reads.
- Hosts the \`aura migrate\` stub.

## Architecture

${F}text
config
 └─ aura-config  AuraConfig · AgentConfig · ReasonerConfig · FleetConfig · env loader
${F}

## Internals

Configuration resolves once into \`AuraConfig\`; every crate reads \`loaded()\` rather than touching the environment directly.

${F}text
 env vars ----+
 (AURA_HOME,  |
  budgets)    +--> aura_config::load --> AuraConfig --> loaded()  [process-wide]
 TOML files --+                              |
                                             +-- AgentConfig / ReasonerConfig
                                             +-- FleetConfig.default_mode --> AgentMode chain

 every crate reads loaded(); never std::env::var directly
${F}

#### \`aura-config\`

\`AuraConfig\` aggregate plus the per-subsystem \`AgentConfig\`, \`ReasonerConfig\`, \`FleetConfig\` (carries \`default_mode\` — the daemon rung of the \`AgentMode\` resolution chain), and the env loader (\`AURA_HOME\`, \`AURA_FLEET_DEFAULT_MODE\`, retry/thinking budgets). Hosts the \`aura migrate\` stub.`,
  },
  {
    title: "4. Model",
    slug: "harness-model-layer",
    section: "harness",
    sortOrder: 4,
    excerpt:
      "The LLM provider abstraction: the ModelProvider trait, stream types, and the Anthropic-shaped client.",
    body: `# 4. Model

The LLM provider abstraction: the \`ModelProvider\` trait, normalized message and stream types, and the single Anthropic-shaped proxy client. Owns **Invariant §1**, which keeps live model access behind the kernel gateway.

## Overview

- The \`ModelProvider\` trait (\`complete\`, \`complete_streaming\`, \`health_check\`) and \`ModelRequest\` / \`ModelResponse\` shapes.
- Normalized \`Message\` / \`ContentBlock\` / \`StopReason\` types plus the \`StreamEvent\` SSE family and \`StreamAccumulator\`.
- The proxy-routed \`AnthropicProvider\` with retry and model-chain fallback, plus \`MockProvider\` for tests.
- **Invariant §1**: only \`KernelModelGateway\` (agent layer) may hold a \`ModelProvider\` in production; automatons take \`P: RecordingModelProvider\`, a sealed marker trait only the recording gateway implements.
- A re-export shell for source-compatible imports (\`aura-reasoner\`).

## Architecture

${F}text
model
 ├─ aura-model-reasoner  ModelProvider · StreamEvent · AnthropicProvider · MockProvider
 └─ aura-reasoner (shell)  re-exports aura-model-reasoner
${F}

## Internals

Production model calls only flow through \`KernelModelGateway\` (Invariant §1). Stream events accumulate, and recording finalizes exactly once on natural end, error, or drop.

${F}text
 AgentLoop --(&dyn ModelProvider)--> KernelModelGateway   [sealed RecordingModelProvider]
                                          |  Kernel::reason_streaming
                                          v
                                    AnthropicProvider (proxy, retry, model-chain fallback)
                                          |  StreamEvent: TextDelta / Thinking / ToolUse / ...
                                          v
                                    StreamAccumulator
                                          |  on end | error | drop
                                          v
                                    RecordEntry (Reasoning) in agent log
${F}

#### \`aura-model-reasoner\`

\`ModelProvider\` trait (\`complete\`, \`complete_streaming\`, \`health_check\`), \`ModelRequest\` / \`ModelResponse\` shapes, \`Message\` / \`ContentBlock\` / \`StopReason\`, the \`StreamEvent\` SSE family and \`StreamAccumulator\`, the proxy-routed \`AnthropicProvider\` (with retry + model-chain fallback), and \`MockProvider\` for tests.

#### \`aura-reasoner\` (shell)

Re-export shell over \`aura-model-reasoner\` for source-compatible imports.`,
  },
  {
    title: "5. Context",
    slug: "harness-context-layer",
    section: "harness",
    sortOrder: 5,
    excerpt:
      "Read-only context assembly: prompt rendering, per-agent memory, history compaction, skill packages.",
    body: `# 5. Context

Read-only context assembly: everything that pulls signal *into* the prompt without side effects. Prompt rendering, per-agent memory, message-history compaction, and skill packages.

## Overview

- Render-only construction of every model-facing string — system prompts, bootstrap blocks, steering injections, fix prompts (\`aura-context-prompts\`).
- Per-agent long-term memory: fact / episodic / procedural stores, a two-stage write pipeline, deterministic retrieval, and consolidation, fronted by \`MemoryManager\` (\`aura-context-memory\`).
- Pure compaction: history tier selection, pressure-gated redaction, cached tool-result summaries (\`aura-context-compaction\`) — it never calls a model itself.
- A \`SKILL.md\` / \`AgentSkills\`-compatible skill system with layered loader precedence (\`aura-context-skills\`).
- Memory and skill state live in dedicated column families, never the record log.

## Architecture

${F}text
context
 ├─ aura-context-prompts     SystemPromptBuilder · bootstrap · SteeringRenderer
 ├─ aura-context-memory      MemoryManager · fact / episodic / procedural stores
 ├─ aura-context-compaction  pure history / tool-surface / storage compaction
 └─ aura-context-skills      SkillManager · SkillInstallStore
       (+ legacy aura-{prompts,memory,compaction,skills} shells)
${F}

## Internals

Read-only assembly pulls signal into the prompt; memory uses a two-stage write pipeline with deterministic retrieval; compaction is pure (the agent performs the model call and applies the result back through this layer).

${F}text
 PROMPT ASSEMBLY                         MEMORY WRITE PIPELINE
 system prompt + bootstrap               TurnSummary
   + steering injections                   |  1) heuristic extraction
   + retrieved MemoryPackets               |  2) optional LLM refinement
   + active skills                         v
        |                            facts / events / procedures (own CFs)
        v                                  |  deterministic retrieval
   model-facing context  <--------- MemoryPacket injection
${F}

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
    title: "6. Plugin",
    slug: "harness-plugin-layer",
    section: "harness",
    sortOrder: 6,
    excerpt:
      "The plugin runtime: contributor API, on-disk manifest/install pipeline, hooks, MCP, and connectors.",
    body: `# 6. Plugin

The plugin runtime: a contributor API for in-tree first-party plugins plus an on-disk manifest / install / cache / marketplace pipeline. Also owns the runtime surfaces — hooks, MCP, and connectors.

## Overview

- In-process contributor trait surface for compiled-in first-party plugins (\`aura-plugin-api\`) — not a dynamic loader.
- Declarative manifest schema, install pipeline, \`AURA_HOME/plugins/\` cache layout, and marketplace lookup with a trust-prompt flow (\`aura-plugin-core\`).
- Hook engine: a closed 10-event \`HookEvent\` taxonomy, \`HookEngine\` / \`HookOutcome\`, and sandboxed env scrubbing (\`aura-plugin-hooks\`).
- Stdio MCP JSON-RPC client with a first-active-wins connection manager and per-request timeouts (\`aura-plugin-mcp\`).
- Thread-safe registry of plugin-contributed external endpoints, last-wins (\`aura-plugin-connectors\`).

## Architecture

${F}text
plugin
 ├─ aura-plugin-api         PluginContributor · ContributionKind
 ├─ aura-plugin-core        PluginManifest · install · marketplace
 ├─ aura-plugin-hooks       HookEvent · HookEngine · HookOutcome
 ├─ aura-plugin-mcp         McpClient · McpConnectionManager
 └─ aura-plugin-connectors  ConnectorRegistry · ConnectorEntry
${F}

## Internals

Hooks fire at lifecycle points with a scrubbed environment; the \`PermissionRequest\` hook can approve or deny a live "ask" (Invariant §4 carve-out 5b). MCP servers are stdio JSON-RPC, first-active-wins per server id, with per-request timeouts.

${F}text
 agent-loop / spawn lifecycle
   PreToolUse -> PostToolUse -> PermissionRequest -> ...  (10 HookEvents)
        |  HookEngine (scrubbed env: no AURA_* secrets)
        v
   HookOutcome: Approve | Deny | Continue | Block | Replace | TimedOut

 MCP:  McpConnectionManager --spawn (cleared env)--> server
        first-active-wins per server id; per-request timeout
${F}

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
    title: "7. Exec",
    slug: "harness-exec-layer",
    section: "harness",
    sortOrder: 7,
    excerpt:
      "Tool execution surface: tool catalog, runner, sandbox primitives, conflict locks, and worktree isolation.",
    body: `# 7. Exec

The tool execution surface: everything from the tool catalog down through sandbox primitives, conflict locks, and worktree isolation.

## Overview

- Domain-scoped advisory locks that reduce sibling collisions on shared resources (\`aura-exec-conflict\`).
- Subagent workspace isolation via git worktrees, with a copy fallback (\`aura-exec-isolation\`).
- Pure approval / verdict evaluation over resolved effective permissions, no model or store deps (\`aura-exec-policy\`).
- OS-level containment: filesystem and process sandbox primitives (\`aura-exec-sandbox\`).
- The tool catalog, resolver, and sandboxed FS / command / git / domain / \`task\` tools (\`aura-tools\`), surfaced through the \`aura-exec-tools\` / \`aura-exec-runner\` shells.

## Architecture

${F}text
exec
 ├─ aura-exec-conflict   ConflictRegistry · LockHandle
 ├─ aura-exec-isolation  WorktreeIsolation · CopyIsolation
 ├─ aura-exec-policy     evaluate · ToolApproval
 ├─ aura-exec-sandbox    FsSandbox · ProcessSandbox
 ├─ aura-exec-tools / aura-exec-runner  re-export shells
 └─ aura-tools           ToolCatalog · ToolResolver · Executor impl
       warn-only upward edge: aura-tools --> aura-kernel
${F}

> **Warn-only edge:** \`aura-tools\` depends on \`aura-kernel\` — the single remaining upward dependency in the workspace. The deep fix is to relocate \`Executor\` / \`ExecuteContext\` / \`SpawnHook\` traits to a new exec-layer home, tracked as a Phase 10 follow-up.

## Internals

A tool call resolves through the catalog, passes the kernel policy gate, then executes inside the sandbox; subagent work runs in an isolated worktree first.

${F}text
 ToolCall --ToolResolver--> CatalogEntry
      |
      v
 mode gate + Policy::check  (deny / capability / scope / ask)
      |  allow
      v
 ExecutorRouter -> aura-tools Executor
      |                 |
      |            FsSandbox / ProcessSandbox  (canonicalise, prefix-check, allowlist)
      |                 |
      |            ConflictRegistry lock (advisory)
      v                 v
   Effect <-------- sandboxed FS / command / git / domain
 (subagent: WorktreeIsolation provisions an IsolatedWorkspace before scheduling)
${F}

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
    title: "8. Agent",
    slug: "harness-agent-layer",
    section: "harness",
    sortOrder: 8,
    excerpt:
      "The deterministic core of a single agent: audited kernel, the multi-step turn loop, steering, subagents.",
    body: `# 8. Agent

The deterministic core of a single agent: the kernel records every reasoning call, tool proposal, policy decision, and effect. **Invariants §1 through §11** are all owned here.

## Overview

- The deterministic kernel: builds context from the record window, calls the reasoner, enforces policy, dispatches via \`ExecutorRouter\`, and emits \`RecordEntry\`s — same record in, same output out (\`aura-agent-kernel\`).
- The multi-step orchestration loop wrapping the kernel: streaming, blocking / stall detection, budget management, compaction orchestration, build verification, planning, self-review (\`aura-agent\`).
- Stateful per-turn steering evaluators — \`RepeatedReadTracker\`, \`ImplementNow\`, \`EarlyOracle\` (\`aura-agent-steering\`).
- Subagent derivation and the pure-data adapter layer: \`derive_subagent\` may only narrow a parent's mode, permissions, and model (\`aura-agent-subagent\`).
- Key bridges — \`KernelToolGateway\`, \`KernelModelGateway\`, \`KernelDomainGateway\` — plus the \`aura-kernel\` and \`aura-agent-loop\` re-export shells.

## Architecture

${F}text
agent
 ├─ aura-agent-kernel    Kernel · ExecutorRouter · Policy · ContextBuilder
 ├─ aura-agent           AgentLoop orchestration · gateways · compaction
 ├─ aura-agent-steering  SteeringRegistry · TurnSteering
 ├─ aura-agent-subagent  derive_subagent · SubagentSpec
 ├─ aura-agent-loop (shell)  AgentLoop · TurnEvent · RunOptions
 └─ aura-kernel (shell)      re-exports aura-agent-kernel
${F}

## Internals

The kernel is deterministic — same record window in, same output out. Each turn builds context, reasons, checks policy, dispatches, and records every step.

${F}text
 record window (last N entries for this agent)
      |
      v
 ContextBuilder --> context_hash = hash(tx || window hashes)
      |
      v
 reason / reason_streaming --> ModelProvider          [RecordEntry: Reasoning]
      |  stop = ToolUse?
      v
 Policy::check --> Decision (accepted ids | rejected)  [RecordEntry: ToolProposal]
      |  approved
      v
 ExecutorRouter.execute --> Effect                    [RecordEntry: ToolExecution]
      |
      v
 next iteration (AgentLoop)  or  EndTurn -> AgentLoopResult
${F}

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
    title: "9. Fleet",
    slug: "harness-fleet-layer",
    section: "harness",
    sortOrder: 9,
    excerpt:
      "The multi-agent runtime: registry, spawn pipeline, dispatch, quota, mailbox, and the subagent dispatcher.",
    body: `# 9. Fleet

The multi-agent runtime above the single-agent kernel: registry, spawn pipeline, dispatch, quota, mailbox, the concrete subagent dispatcher, and the daemon composition root. **Invariant §12** (single writer per agent) crosses the agent / fleet boundary.

## Overview

- In-memory directory of live and recently-terminated agents (\`aura-fleet-registry\`).
- Concurrency and resource budgets with an RAII \`BudgetTicket\` that releases on drop (\`aura-fleet-quota\`).
- The subagent spawn pipeline: idempotent dedupe, per-parent audit-append lease, \`derive_subagent\`, quota acquisition, and \`SpawnMode::{Wait, Detached, Batch}\` (\`aura-fleet-spawn\`).
- Routing and transport: \`AgentJob\` dispatch into the spawner, plus a bounded backpressured mailbox (\`aura-fleet-dispatch\`, \`aura-fleet-mailbox\`).
- The \`FleetDaemon\` composition root — also hosting \`resolve_session_mode\` — and the fail-closed \`FleetSubagentDispatcher\` (\`aura-fleet-daemon\`, \`aura-fleet-subagent\`).

## Architecture

${F}text
fleet
 ├─ aura-fleet-registry   FleetRegistry · AgentSlot · AgentState
 ├─ aura-fleet-quota      QuotaPool · BudgetTicket
 ├─ aura-fleet-spawn      FleetSpawner · ParentLeaseRegistry · SpawnMode
 ├─ aura-fleet-dispatch   AgentJob routing
 ├─ aura-fleet-mailbox    bounded MPSC AgentJob mailbox
 ├─ aura-fleet-daemon     FleetDaemon · resolve_session_mode
 └─ aura-fleet-subagent   FleetSubagentDispatcher (SubagentDispatchHook)
${F}

## Internals

The \`task\` tool fans out through the fleet dispatcher. Each spawn takes the per-parent lease, derives a narrowed child, acquires a quota ticket, appends the \`SubagentSpawn\` audit row, then runs the child through the same scheduler lane.

${F}text
 task tool --(SubagentDispatchHook)--> FleetSubagentDispatcher
      |
      v
 ParentLeaseRegistry lease   (per parent; dedupe by (parent, tool_call_id))
      |
      v
 derive_subagent(parent, request)   -- may only narrow mode / perms / model
      |
      v
 QuotaPool.acquire -> BudgetTicket   (RAII; releases on drop)
      |
      v
 append SubagentSpawn audit row (write_system_record)
      |
      v
 ChildRunner -> Scheduler.schedule_agent_with_overrides   (Wait | Detached | Batch)
${F}

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
    title: "10. Surface",
    slug: "harness-surface-layer",
    section: "harness",
    sortOrder: 10,
    excerpt:
      "Composition roots: CLI, TUI, SDK, the HTTP/WS gateway, the orchestration engine, domain HTTP, and auth.",
    body: `# 10. Surface

Composition roots: each surface assembles the lower layers into a runnable entry point — CLI, TUI, SDK, headless server, automaton host — or a side-effectful client.

## Overview

- The CLI composition root: clap \`Cli\` / \`Commands\` / \`RunArgs\`, the top-of-chain \`ModeFlag\`, and event-loop wiring (\`aura-surface-cli\`).
- External SDK types for talking to a fleet daemon over \`aura-core-protocol\`, with pluggable transport (\`aura-surface-sdk\`).
- The HTTP/WS **gateway** plus the \`aura-node\` composition root — the sole Cargo surface for external Rust consumers (\`aura-runtime\`).
- The orchestration engine: per-agent single-writer scheduler (Invariant §12.a), worker, automaton bridge, and \`RuntimeChildRunner\` (\`aura-engine\`).
- The HTTP \`DomainApi\` implementation (\`aura-domain-http\`), plus terminal / automaton / auth surfaces and their legacy shells.

## Architecture

${F}text
surface
 ├─ aura-surface-cli       clap Cli · ModeFlag · event loop
 ├─ aura-surface-sdk       AuraClient · AuraSession · SessionConfig
 ├─ aura-runtime           HTTP/WS gateway · aura-node root (external surface)
 ├─ aura-engine            scheduler · worker · child_runner
 ├─ aura-domain-http       HttpDomainApi · JwtDomainApi
 └─ aura-terminal / aura-automaton / aura-auth (+ surface shells)
${F}

## Internals

The gateway is inbound-only; the engine owns orchestration. A run is a two-step exchange: \`POST /v1/run\` returns a \`run_id\`, then the client attaches \`WS /stream/:run_id\`.

${F}text
 Client --POST /v1/run (RuntimeRequest)--> aura-runtime gateway
      |                                       |  resolve_session_mode -> AgentMode
      |                                       |  Engine::submit -> park pending run
      |  <-- 201 { run_id, event_stream_url }
      |
      |  --WS /stream/:run_id--> gateway --> Engine Scheduler (per-agent claim §12.a)
      |  <-- Outbound::SessionReady               |  Worker.process_agent -> AgentLoop
      |  Inbound::UserMessage -->                 |
      |  <-- TextDelta / ToolResult / AssistantMessageEnd
      |  Inbound::Cancel --> CancellationToken
${F}

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
    title: "Invariants",
    slug: "harness-invariants",
    section: "harness",
    sortOrder: 11,
    excerpt:
      "The fifteen architectural invariants (kernel boundary, policy, audit/replay determinism, concurrency, structure) and how they are enforced.",
    body: `# Invariants

The fifteen architectural invariants (§1-§15) the harness must uphold; violations are bugs. Unless noted, each is scoped to a single agent's kernel and that agent's record log - cross-agent contracts live in §12 and §15.

## Overview

- **Part A - Kernel boundary & mediation (§1, §2, §3, §8, §9).** The per-agent \`Kernel\` is the sole external gateway; every state change and every LLM call is recorded; gateways are transparent and the \`AgentLoop\` is isolated.
- **Part B - Policy & authorization (§4, §11).** Every tool call runs the full \`Policy::check\`; live "ask" decisions are session-scoped.
- **Part C - Record, audit, determinism & replay (§5, §6, §7, §10).** Complete decision chains, deterministic per-agent \`context_hash\`, monotonic sequencing, and an append-only immutable log.
- **Part D - Concurrency & cross-agent parallelism (§12, §15).** Single writer per agent; unrelated agents run fully in parallel without weakening replay determinism.
- **Part E - Workspace & plugin structure (§13, §14).** The strict ten-layer stack and the sandboxed external plugin surface.

## Architecture

Per-agent kernels with cross-agent parallelism. The \`Scheduler\` grants one processing claim per agent (§12.a); each agent owns its own \`Kernel\`, \`next_seq\` counter, and append-only log. One RocksDB store backs them all via column families keyed by (agent_id, seq).

${F}text
                  +------------------------------------------------+
                  |  Scheduler  (store-backed per-agent claim §12) |
                  +------+-------------+-------------+--------------+
              claim A    |   claim B   |   claim C   |   (parallel)
                         v             v             v
                    Kernel A       Kernel B      Kernel C
                  (id=A,seq_A)   (id=B,seq_B)  (id=C,seq_C)
                         |             |             |
                  append (A,seq) append (B,seq) append (C,seq)
                         v             v             v
                      log A         log B         log C
                         +-------------+-------------+
                                       v
              RocksDB column families keyed by (agent_id, seq)
${F}

## §4 policy pipeline (internals)

Every \`ToolProposal\` runs the full \`Policy::check\` - orthogonal hard-denial layers first, then the tri-state per-tool resolve. A \`Deny\`-only check (or the pure \`evaluate\` in \`aura-exec-policy\`) is never a substitute.

${F}text
ToolProposal
   |
   v
[ deny layer ]  allowed_action_kinds? --no--> reject
   |
[ capability ] caller holds required caps? --no--> reject
   |
[ scope ]      args within AgentScope? --no--> reject
   |
[ integrations ] required ones installed? --no--> reject
   |
   v
resolve_tool_state (UserToolDefaults + AgentToolPermissions)
   |        |              |
  Allow    Deny           Ask
   |        |              |
   v      reject     ToolApprovalPrompter? --no--> deny (headless)
 execute                   |  yes
                  PermissionRequest hook (carve-out 5b)
                           |
                   Approve | Deny | (fall through to live prompt)
${F}

## §7 / §10 append path (internals)

Record append is per-agent, monotonic, and atomic. Inbox dequeue and record append commit in a single \`WriteBatch\`; only the kernel's sealed \`WriteStore\` can commit, while everyone else holds \`ReadStore\`.

${F}text
Kernel (Arc<dyn WriteStore>)            non-kernel callers (Arc<dyn ReadStore>)
   |  append_entry_atomic(agent, seq)        |  enqueue_tx / set_agent_status
   v                                         v
 next_seq = head_seq + 1   (no gaps, no dups)
   |
   v
 single WriteBatch { dequeue inbox tx ; put (agent_id, seq) -> entry }
   |
   v
 commit  -- all-or-nothing -->  immutable log  (no update/delete/truncate)
${F}

## Strict numeric index

| #   | Invariant | Part |
|-----|-----------|------|
| §1  | Each agent's kernel is the sole external gateway | A |
| §2  | Every state change for agent A passes through A's kernel | A |
| §3  | Every LLM call is recorded | A |
| §4  | Full policy enforcement | B |
| §5  | Complete audit trail | C |
| §6  | Per-agent deterministic context | C |
| §7  | Per-agent monotonic sequencing | C |
| §8  | Gateway transparency | A |
| §9  | AgentLoop isolation | A |
| §10 | Per-agent append-only record | C |
| §11 | Session-scoped tool decisions | B |
| §12 | Single writer per agent | D |
| §13 | Layered architecture | E |
| §14 | Plugin sandbox | E |
| §15 | Cross-agent parallelism | D |

## Enforcement

Invariants §1, §2, §3, §9, and §10 are guarded by ripgrep bands in \`check_invariants.sh\` (run from CI on every push). The remaining invariants - §4 policy, §5 audit, §6 determinism, §7 sequencing, §8 gateway, §11 session, §12 single-writer, §13 layering, §14 plugin sandbox, §15 parallelism - are enforced by Rust test suites. Type-level seals back the boundary: \`RecordingModelProvider\` (only \`KernelModelGateway\` satisfies it) and the crate-private \`Sealed\` marker on \`WriteStore\`.`,
  },
  {
    title: "User flows",
    slug: "harness-user-flows",
    section: "harness",
    sortOrder: 12,
    excerpt:
      "How data moves through the system for interactive, run-kickoff, headless, and error-recovery paths.",
    body: `# User flows

The same kernel / \`AgentLoop\` pipeline drives every front-end. Before any external effect the resolved \`AgentMode\` gates the action, then the policy layer narrows further per tool.

## Overview

- **Interactive TUI** — a local event-loop session, the default \`cargo run\` / \`aura\` path.
- **Run kickoff + WebSocket** — the two-step \`POST /v1/run\` then \`WS /stream/:run_id\` exchange used by \`aura-os\` and other wire clients.
- **Headless node** — HTTP-submitted transactions processed by the engine's scheduler.
- **Streaming error recovery** — a deterministic \`StreamReset\` fallback to a non-streaming completion.

## Architecture

${F}text
input --> transaction --> AgentLoop <==> (model calls + tool execution)
                              |                      |
                              v                      v
                          TurnEvents            RecordEntry
                          (render)              (append-only log)
${F}

## Flow 1: Interactive TUI session

Default mode when a user runs \`cargo run\` or \`aura\`.

${F}text
 User    TUI      EventLoop      AgentLoop      Model      KTG / Tools
  | type   |          |             |             |            |
  |------->| UiEvent   |             |             |            |
  |        |--------->| append +     |             |            |
  |        |          | run_with_events --------->|             |
  |        |          |             | reason ---->|             |
  |        |          |             |<-- StreamEvents ----------|
  |        |<-- UiCommand (TextDelta / Thinking / ToolStart)    |
  |<-render|          |             |             |            |
  |        |          | stop = ToolUse:           |            |
  |        |          |             | execute ---------------->| (mode + policy, sandbox)
  |        |          |             |<-- Effect / ToolResult ---|
  |        |<-- UiCommand::CompleteTool           |            |
  |        |          | stop = EndTurn -> StepComplete         |
  |<-final-|          |             |             |            |
${F}

**Data path:** User input → \`UiEvent\` channel → Event Loop appends to \`Vec<Message>\` → \`AgentLoop.run_with_events()\` → streaming \`TurnEvent\`s back through an \`mpsc\` channel → Event Loop maps to \`UiCommand\` → Terminal renders. On a \`ToolUse\` stop reason, the kernel runs the mode + policy check, dispatches through the \`ExecutorRouter\` to sandboxed FS / command tools, and feeds the \`Effect\` back to the loop.

## Flow 2: Run kickoff + WebSocket session

Used by \`aura-os\` and other clients connecting over the harness wire. A **two-step exchange**:

${F}text
 Client        Gateway          Engine       Session    AgentLoop   Model/Tools
   | POST /v1/run |               |            |           |           |
   |------------->| resolve_session_mode -> AgentMode      |           |
   |              | Engine::submit -------->| park pending run         |
   |<-- 201 { run_id, event_stream_url } ---|            |           |
   | WS /stream/:run_id            |          |           |           |
   |------------->| open_chat_stream ------->| create Session         |
   |<-- Outbound::SessionReady     |          |           |           |
   | Inbound::UserMessage -------->| run_with_events -------------->|  |
   |              |                |          |           | reason -->| Model
   |<-- Outbound::TextDelta        |          |           |<-- stream-|
   |              | alt tool: KTG.execute ------------------------->| Tools
   |<-- Outbound::ToolResult       |          |           |           |
   |<-- Outbound::AssistantMessageEnd { usage, files_changed }       |
   | Inbound::Cancel --> CancellationToken                           |
${F}

The client never sends an init frame — the run is already up by the time the WS attaches. A \`Cancel\` may arrive at any time and trips the \`CancellationToken\`. \`DevLoop\` and \`TaskRun\` follow the same two-step exchange but their WS is event-only.

## Flow 3: Headless node (scheduler-driven)

When running \`aura run --ui none\` or as \`aura-node\`, transactions are submitted via HTTP and processed by the engine's scheduler.

${F}text
 Client   Gateway   Store(inbox)  Scheduler    Worker     AgentLoop   Fleet
   | POST /tx |         |            |           |           |          |
   |--------->| enqueue_tx|          |           |           |          |
   |<-- 202 --|         |            |           |           |          |
   |          |         |<-- claim per-agent (§12)|          |          |
   |          |         | dequeue_tx -> process_agent ------>|          |
   |          |         |            |           | model + tools        |
   |          |         |            |           | alt task: spawn ---->| Fleet
   |          |         |            |<-- schedule_agent_with_overrides -|
   |          |         |<-- append_entry_atomic(agent, seq, entry) -----|
   | GET /agents/{id}/record -------->|          |           |          |
   |<-- Vec<RecordEntry> |            |           |           |          |
${F}

**Data path:** HTTP \`POST /tx\` → Store inbox → Scheduler dequeues (acquiring the per-agent claim, Invariant §12) → Worker runs \`AgentLoop\` → result committed atomically to the record log via \`append_entry_atomic\` → Client polls via \`GET /agents/{id}/record\`. Subagent spawn lands through \`FleetSubagentDispatcher\` and re-enters the same scheduler lane, inheriting the per-agent processing claim.

## Flow 4: Streaming error recovery (StreamReset)

When a streaming model call fails mid-stream, the system recovers deterministically: partial \`TextDelta\`s already shown are cleared via \`TurnEvent::StreamReset\`, then a non-streaming \`provider.complete(request)\` fallback produces the authoritative content, re-emitted as a single \`TextDelta\`.

${F}text
 AgentLoop                Model                  UI / WS
   | complete_streaming --->|                      |
   |<-- TextDelta("partial")                       |
   | TurnEvent::TextDelta("partial") ------------->| renders partial
   |<-- StreamEvent::Error (connection lost)       |
   | TurnEvent::StreamReset ---------------------->| clears partial
   | complete(request)  (non-streaming fallback)   |
   |<-- full ModelResponse                         |
   | TurnEvent::TextDelta(full_text) ------------->| renders authoritative
${F}

## Data lifecycle summary

Every user interaction follows the same fundamental path: input becomes a transaction, the \`AgentLoop\` orchestrates model calls and tool execution in a loop, results are emitted as \`TurnEvent\`s for real-time display, and the final state is persisted as a \`RecordEntry\` in the append-only log.

${F}text
 INPUT          PROCESSING                                    OUTPUT
 -----          ----------                                    ------
 User Prompt    AgentLoop
     |            |
     v            v
 Transaction -> ModelProvider -> ModelResponse -> StopReason?
                                                   |       |
                                                ToolUse  EndTurn
                                                   |       |
                                                   v       v
                                    KernelToolGateway   AgentLoopResult -> TurnEvents (UI / WS)
                                                   |
                                                   v
                                    ExecutorRouter -> ToolExecutor + Sandbox
                                                   |
                                                   v
                                                 Effect -> (back to AgentLoop)
                                                                |
                                                                v
                                                        RecordEntry -> RocksDB
${F}`,
  },
];
