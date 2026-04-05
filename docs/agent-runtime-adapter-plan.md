# Agent Runtime And Execution Plan

This document is the current reference for Aura OS adapters, connections, apps, MCP servers, and execution placement.

It is intentionally product-shaped, not infrastructure-shaped:
- what the user-facing model is
- what Aura OS owns
- what the adapter owns
- what works today
- what is still limited

## Goal

Support multiple agent adapters without fragmenting the product.

The intended model is:
- Aura OS is the control plane
- adapters are execution layers
- connections are org-level provider credentials
- apps are org-level external work systems
- MCP servers are another source of external tools
- environments decide where execution runs

The product should not become:
- one loop for Aura
- another loop for Codex
- another loop for Claude Code

If Aura OS exposes a governed workflow surface, all supported adapters should converge on that same surface.

## Product Model

### Connections

Connections are org-level provider credentials used by adapters.

Examples:
- `Anthropic`
- `OpenAI`
- `Google Gemini`
- `xAI`
- `OpenRouter`

Connections power model/runtime access.

### Apps

Apps are org-level external work systems.

Examples:
- `Linear`
- `GitHub`
- `Slack`
- `Notion`

Apps can contribute tools into Aura OS through a first-class app provider contract.

### MCP Servers

MCP Servers are attachable external tool sources.

They can contribute dynamic tools into the same workspace tool surface that adapters and Aura OS consume.

### Adapter

Agents choose an adapter.

Current adapters:
- `Aura`
- `Claude Code`
- `Codex`
- `Gemini CLI`
- `OpenCode`
- `Cursor`

Internal ids still exist in code:
- `aura_harness`
- `claude_code`
- `codex`

But the user-facing concept is:
- `Adapter`

### Authentication

Authentication explains how the selected adapter gets access.

Current modes:
- `Aura Billing`
  - internal: `aura_managed`
- `Use Team Integration`
  - internal: `org_integration`
- `Use Local Login`
  - internal: `local_cli_auth`

### Runs On

Runs On explains where the adapter executes.

Current environments:
- `This Machine`
  - internal: `local_host`
- `Isolated Cloud Runtime`
  - internal: `swarm_microvm`

## Simple Rule

- adapter chooses the execution brain
- connection explains which provider credentials are available
- app explains which external systems are connected
- authentication explains how that adapter gets access
- runs on chooses execution placement

## Authority Boundary

Aura OS remains the system of record.

Aura OS owns:
- projects
- specs
- tasks
- workflow state
- loop orchestration
- persistence
- governed side effects

Adapters do runtime work:
- reason
- generate
- chat
- code
- plan
- call tools

Important practical rule:
- if something does not require AI, Aura OS should just do it directly
- if something requires AI work, the selected adapter path is used

Examples:
- move task -> Aura OS
- update workflow state -> Aura OS
- save project metadata -> Aura OS
- create a Linear issue later -> Aura OS or a governed app tool path
- generate a response -> selected adapter
- write code -> selected adapter

## Shared Project Loop

The most important architectural rule now is:

- project-attached chat should follow one shared Aura OS loop
- adapters should not bypass that loop for governed project state

This means:
- Aura OS conducts the project workflow
- the adapter is the execution layer that reasons and decides which tool to call
- persisted state changes still happen through Aura OS

### What Shared Means

For project-attached chat, the adapter should be able to use the same control-plane surface regardless of whether the adapter is:
- Aura
- Codex
- Claude Code

Today, that shared project control-plane surface includes:

- specs
  - `list_specs`
  - `get_spec`
  - `create_spec`
  - `update_spec`
  - `delete_spec`
- tasks
  - `list_tasks`
  - `get_task`
  - `create_task`
  - `update_task`
  - `delete_task`
  - `transition_task`
  - `retry_task`
  - `run_task`
- project
  - `get_project`
  - `update_project`
  - `get_project_stats`
- loop
  - `start_dev_loop`
  - `get_loop_status`
  - `pause_dev_loop`
  - `stop_dev_loop`

This is the key product shift:
- project-attached Codex and Claude are no longer just prompt-driven chat surfaces
- they can now participate in the real Aura OS project loop

## How The Shared Loop Works

For external adapters, Aura OS now uses an MCP bridge for project-attached chat.

That means:
- Aura OS starts a session-scoped MCP server
- the runtime CLI receives the shared project tools through its native MCP/tooling support
- the runtime calls structured tools
- Aura OS executes the underlying control-plane operation
- Aura OS persists the result
- Aura OS emits the same event shape back to the UI

Important details:
- the existing Aura event model is reused
- no second runtime protocol was invented
- workspace/file operations still belong to the runtime layer
- control-plane actions stay in Aura OS

One important transport detail:
- inside Aura OS, tools can come from multiple source kinds:
  - Aura-native tools
  - first-class app-provider tools
  - dynamic MCP-backed tools
- but for external project-attached adapters like `Codex` and `Claude Code`, Aura packages the active tool surface through one session-scoped MCP bridge
- so those adapters do not need separate logic for each internal tool source
- from the adapter's perspective, they are all just MCP tools exposed by Aura for that session

## Guardrails Against Drift

We do not want a world where:
- one project tool exists for Codex but not Aura
- one handler exists in the MCP bridge but not in the harness registry
- one runtime silently gets more product power than another

So the shared project surface now has guardrails:

1. One shared manifest
- `infra/shared/project-control-plane-tools.json`

This manifest is the source of truth for:
- tool names
- descriptions
- prompt signatures
- input schemas
- saved-event wiring

2. Runtime-side validation
- Aura OS runtime code validates the manifest
- the MCP sidecar uses the same manifest

3. Aura-side harness registry test
- the `aura-os-super-agent` tool registry is tested against the shared manifest

This does not make drift impossible forever, but it makes silent drift much harder.

## Tool Boundary

External tools should usually be mediated by Aura OS, not directly owned by each adapter.

That means:
- stateful product actions stay governed by Aura OS
- adapters should not become the source of truth for external business state

Example with Linear:
- org adds a Linear app
- an agent may ask to create or update a Linear issue
- Aura OS should perform the Linear action through the shared app-provider or MCP tool layer
- the adapter should not permanently own the Linear token

This keeps the system cleaner:
- one source of truth
- better auditability
- easier permission control
- less duplicated secret handling across adapters

## Current Product Model

Today, Aura OS offers:

1. Org-level `Connections`
- Anthropic
- OpenAI
- Google Gemini
- xAI
- OpenRouter

2. Org-level `Apps`
- GitHub
- Linear
- Slack
- Notion

3. Org-level `MCP Servers`
- dynamic external tool sources

4. Per-agent `Adapters`
- Aura
- Claude Code
- Codex
- Gemini CLI
- OpenCode
- Cursor

5. Per-agent authentication choice
- Aura Billing
- Use Team Integration
- Use Local Login

6. Per-agent execution placement
- `This Machine`
- `Isolated Cloud Runtime`

7. Shared project control-plane tools for project-attached chat
- available across the supported runtime paths described below

## Current Support Matrix

### Aura

Supports:
- `Aura Billing`
- `Use Team Integration`
- `This Machine`
- `Isolated Cloud Runtime`

Current practical provider support for `Use Team Integration`:
- Anthropic only

So today:
- `Aura + Aura Billing` works
- `Aura + Anthropic team integration` works
- `Aura + OpenAI team integration` is not supported yet

### Claude Code

Supports:
- `Use Local Login`
- `Use Team Integration`
- `This Machine`

Current provider expectation for team integration:
- Anthropic

So today:
- `Claude Code + local login` works if the `aura-os-server` process has a valid Claude CLI session
- `Claude Code + Anthropic team integration` works by injecting the org key into the runtime path

### Codex

Supports:
- `Use Local Login`
- `Use Team Integration`
- `This Machine`

Current provider expectation for team integration:
- OpenAI

So today:
- `Codex + local login` works if the `aura-os-server` process can run Codex with valid local auth
- `Codex + OpenAI team integration` is the matching provider-backed path

### Gemini CLI

Supports:
- `Use Local Login`
- `Use Team Integration`
- `This Machine`

Current provider expectation for team integration:
- Google Gemini

### OpenCode

Supports:
- `Use Team Integration`
- `This Machine`

Current provider expectation for team integration:
- provider-backed multi-model routing through workspace connections

### Cursor

Supports:
- `Use Local Login`
- `This Machine`

Current provider expectation for team integration:
- not implemented as a remote/provider-backed path yet

## Important Local-Login Truth

For local-login adapters, the login state belongs to the server process environment.

That means:
- `Claude Code + Use Local Login + This Machine`
- `Codex + Use Local Login + This Machine`

both depend on:
- the CLI being installed
- the `aura-os-server` process being able to use that CLI
- valid auth being present in that same host environment

This is why local login is convenient but less deterministic than team integration.

## Project-Attached Chat vs Standalone Chat

This distinction matters.

Today, the strongest shared Aura OS loop exists in:
- project-attached chat

That is where the runtime can use the shared project control-plane surface and produce real persisted Aura OS state changes.

Standalone chat is still different:
- standalone chat is primarily a conversation/runtime surface
- it is not yet the universal path for every governed project workflow action

So the current product truth is:
- project-attached chat is the main parity surface
- standalone chat is still more limited as a system-workflow surface

## Current UI Language

The current user-facing language should be:

- `Integrations`
- `Connections`
- `Apps`
- `MCP Servers`
- `Adapter`
- `Runs On`
- `Authentication`
- `Use Team Integration`
- `Use Local Login`
- `Aura Billing`

Internal ids and transport details should stay internal wherever possible.

## Security Model

Baseline rules:
- store secrets at the integration layer, not on agents
- keep secret material separate from agent config
- resolve secrets only at runtime
- do not write secrets into prompts, logs, or transcripts
- agents should reference integration ids, not raw keys

Trust model today:
- `This Machine` is treated as a trusted local environment

Stronger future model:
- `Isolated Cloud Runtime` is the stronger boundary for BYOK and sensitive workloads

Bridge-specific truth:
- adapter-side project tool access is session-scoped
- external project tool bridges are initialized with runtime-scoped auth/context
- for local/dev this is acceptable today
- future hardening can tighten how that context is injected and audited

## Why Swarm Exists

Swarm does not exist to improve model quality.

It exists to provide:
- isolated execution
- more consistent environments
- background durability
- centralized policy and secret handling
- better scaling than one local host process per agent

Local execution still has benefits:
- easier CLI reuse
- easier local-login reuse
- closer parity with the user's workstation

So the tradeoff is:
- local is simpler and more flexible
- swarm is cleaner, more durable, and more governable

## Swarm Expectations

Swarm does not change the authority boundary.

The intended model remains:
- Aura OS is the control plane
- Swarm is an execution environment

So for swarm/cloud later we still want:
- Aura OS owning project/spec/task/workflow state
- secrets injected ephemerally into the runtime boundary
- workers not persisting raw integration secrets
- governed external actions still performed by Aura OS

Today:
- swarm is modeled in the product
- the fully validated product path is still local for non-Aura adapters

## Harness Path vs External Adapter Path

This is the most important implementation distinction.

### Aura / Harness Path

For `Aura`, the harness is the runtime.

That means:
- Aura OS opens a harness session
- the harness talks directly to the model provider
- the harness emits the runtime event stream

In this path, the harness itself must know how to speak to the provider.

### External Adapter Path

For `Claude Code`, `Codex`, `Gemini CLI`, `OpenCode`, and `Cursor`, the adapter CLI is the runtime.

That means:
- Aura OS prepares context, tools, and orchestration
- Aura OS launches the adapter locally
- the adapter talks to its provider itself
- Aura OS parses the adapter output back into Aura events

In this path, Aura OS is still the control plane, but it is not the inner model loop.

### Why This Matters For Swarm

Supporting a non-Aura adapter on swarm is not just "pass the API key into a VM".

We would need one of two things:

1. teach the harness more providers
- so the harness itself can execute OpenAI, Gemini, and others remotely

2. build a remote external-adapter runner
- so swarm can run the actual CLI remotely instead of only on the local host

Today, the harness path is the only fully modeled swarm path.

## What Works Today

Local path:
- Aura with Aura Billing
- Aura with Anthropic team integration
- Claude Code with Anthropic team integration
- Codex with local login
- local benchmark/core loop

Also true:
- org integrations are now part of the real product model
- project-attached Codex and Claude can call real Aura OS control-plane project tools
- shared project control-plane tool activity is emitted back through Aura OS event streams
- the benchmark/core loop still works on the local stack

## Current Limits

These should stay explicit:

1. Aura team-integration support in the harness is Anthropic-only today
- the framework is generic enough to grow
- the current harness provider factory only implements Anthropic

2. Claude local login is environment-dependent
- if the server process is not logged into Claude, this path fails

3. Full parity automation can still be blocked by environment state
- Aura managed parity evals can fail if the billing path has no credits
- Claude local-login parity evals can fail if the server environment is not logged in

4. Standalone chat is not yet the full shared workflow surface
- the strongest parity story today is project-attached chat

5. Swarm path is not universal yet
- Aura can use swarm
- non-Aura adapters are still local-only today

6. Deeper internal convergence is not fully done yet
- the exposed shared project surface is aligned
- there is still room to further converge internal service paths over time

## Why Aura Supports Only Anthropic In Swarm Today

The limitation is not the overall model. It is the current provider implementation.

Today:
- Aura OS can build session provider config for workspace-backed auth
- but the harness provider factory only instantiates Anthropic from those overrides

So supporting more providers requires:
- adding another provider implementation in the harness
- extending the provider factory
- extending Aura OS connection-to-provider mapping
- validating the full path end to end

This is additive work, not a redesign.

## Validation And Confidence

We now have three useful confidence layers:

1. Product behavior
- live local benchmark/core loop
- live project-attached control-plane validation

2. Automated backend coverage
- storage-backed API tests for spec/task CRUD and state changes
- runtime parser and manifest validation tests
- harness registry tests against the shared manifest

3. Automated parity coverage
- a project control-plane parity eval exists for project-attached runtime comparison

This does not remove all operational risk, but it is a much stronger position than ad hoc manual validation alone.

## Tool Direction

The product already needs to support more than model providers.

Example:
- org adds Anthropic
- org adds Linear

Then:
- Aura, Claude, or Codex may use Anthropic or OpenAI for model execution
- Aura OS should use the Linear app or Linear MCP tools when the system needs to create or update Linear state

Important distinction:
- connections help an adapter talk to a model
- apps and MCP servers help Aura OS and adapters access governed external actions

## What This Does Not Change

Even with more adapters and more external systems:
- Aura OS still owns workflow state
- Aura OS still owns projects/specs/tasks
- Aura OS still owns non-AI actions
- connections, apps, and MCP servers stay org-level
- adapters stay execution-level

## Practical Build Order

The practical order now looks like:

1. adapter / auth / environment foundation
2. Aura team integration through per-session provider config
3. shared project control-plane surface for project-attached chat
4. drift guardrails and parity validation
5. stronger cloud/swarm hardening
6. more provider support for Aura team integration in swarm
7. broader app-provider and MCP tool support

That keeps the system understandable:
- connections, apps, and MCP servers connect
- adapters execute
- Aura OS governs
- environments place the adapter
