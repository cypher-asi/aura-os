# Agent Runtime Adapter Plan

This document is the working reference for the next implementation phase.

## Goal

Let Aura run different agent runtimes cleanly while keeping Aura OS as the system of record.

## Core Concepts

### Adapter

Which runtime does the work.

Examples:
- `aura_harness`
- `claude_code`
- `codex`

### Integration

Reusable provider and connection config owned outside the agent.

Examples:
- org Anthropic integration
- org OpenAI integration
- user-owned integration
- MCP or gateway integration

### Environment

Where that runtime runs.

Examples:
- `local_host`
- `swarm_microvm`

### Auth Source

How the adapter gets its credentials or provider config.

Examples:
- `aura_managed`
- `org_integration`
- `local_cli_auth`

## Simple Rule

- Adapter chooses the runtime
- Integration is an optional shared config source
- Environment tells us where it runs
- Auth source tells us how the runtime authenticates

## Examples

- Aura + Aura-managed auth + local host
- Aura + Aura-managed auth + swarm microVM
- Claude Code + local CLI auth + local host
- Claude Code + org Anthropic integration + local host
- Codex + local CLI auth + local host
- Codex + org OpenAI integration + local host

Important:
- the user-facing name should be **Aura**
- we can keep `aura_harness` as the internal adapter id
- CLI adapters should not require an org integration when local auth already exists
- Aura BYOK is a follow-on harness pass, not something we should pretend is already fully wired

## System Layers

- **User intent layer**
  The human request or goal.

- **Control plane**
  The top-level orchestrator.
  It decides what should happen, which agent should do it, and how work should be routed.

- **Aura OS layer**
  The system of record.
  It owns projects, tasks, agents, settings, sessions, workflows, and authoritative state changes.

- **Adapter/runtime layer**
  The execution runtimes.
  Examples: Aura harness, Claude Code, Codex.

- **Environment layer**
  Where the runtime executes.
  Examples: local host, swarm microVM.

## Control Plane

The control plane sits above Aura OS and the runtime adapters.

SuperAgent / CEO belongs here as an orchestrator, not as a runtime.

Its job is to:
- plan
- route
- delegate
- decide which agent/runtime to use
- coordinate workflow progress

Its job is not to:
- directly replace the runtime layer
- own low-level adapter execution
- bypass Aura OS authority

## Authority Rule

Runtimes do the work.

Aura OS keeps authority over OS-level state changes.

That means task, project, Kanban, and settings changes should still go through Aura OS services, even when the work itself is performed by Aura harness, Claude Code, or Codex.

## Integration Ownership

The integration layer should hold reusable external connections.

Examples:
- model providers
- APIs
- MCP servers
- gateways
- local model endpoints

Recommended ownership model:
- org-owned integrations
- user-owned integrations
- agent access through grants or bindings

Agents should consume integrations, not own duplicated copies of them.

## V1 Scope

Phase 1 should stay small:

1. Add adapter selection to agents
2. Add environment selection
3. Add auth source selection
4. Keep current Aura behavior compatible
5. Keep workflow and task authority in Aura OS
6. Support a thin but real end-to-end product flow
7. Make CLI adapters usable with either local auth or org integrations
8. Keep Aura BYOK explicitly out of scope until harness session config supports it cleanly

## V1 End-to-End Flow

V1 should be more than backend wiring. It should provide a real visible product flow.

The minimum usable flow should be:

1. Create or edit an organization
2. Optionally add an org integration
3. Optionally test that environment or auth mode
4. Create or edit an agent
5. Choose adapter, environment, and auth source
6. If using org integration auth, attach an integration
7. If using local CLI auth, do not require an integration
6. Run the agent through the normal Aura flow
7. Verify that execution actually went through the selected runtime

That means a user should be able to do at least this from the product:

- create an Aura agent that uses Aura-managed auth
- create a Claude Code agent that uses local CLI auth
- create a Codex agent that uses local CLI auth
- optionally add org Anthropic/OpenAI integrations and attach them to Claude/Codex
- choose `local_host` or `swarm_microvm` where supported
- run the agent and observe the result

This does not need a fully polished final UI in V1, but it does need a real end-to-end slice.

## V1 UI Surface

The first UI/backend slice should be simple:

### Organization

Add a basic integrations area where an organization can store reusable connections.

Initial integration types:
- Anthropic
- OpenAI

Each integration should support:
- label or name
- provider type
- API key or credential reference
- optional default model
- optional connection metadata later

### Agent

When creating or editing an agent, allow:
- adapter selection
- environment selection
- auth source selection
- integration selection only when auth source is `org_integration`

Initial adapter list:
- `aura_harness`
- `claude_code`
- `codex`

Initial environment list:
- `local_host`
- `swarm_microvm`

Initial auth-source rules:
- `aura_harness`
  - `aura_managed`
- `claude_code`
  - `local_cli_auth`
  - `org_integration`
- `codex`
  - `local_cli_auth`
  - `org_integration`

User-facing labels:
- `aura_harness` -> `Aura`
- `claude_code` -> `Claude Code`
- `codex` -> `Codex`

## Test Environment

We should include a lightweight "test environment" capability in V1.

This is inspired by Paperclip's adapter test flow and helps avoid blind configuration.

The goal is to answer:
- is the command available?
- is the working directory valid?
- is auth present?
- is the configured model likely usable?
- can a small hello probe run?

Paperclip provides a good mental model here:
- local CLI auth is treated as a real supported mode
- API-key auth is optional, not mandatory
- environment tests should explain which mode is being used instead of hiding it

This should return structured results such as:
- pass
- warn
- fail

It does not need to be a full playground in V1, but it should make configuration failures obvious before a user tries a real run.

## Security and Key Handling

We should treat integrations as sensitive system data.

Simple V1 rules:

- store credentials in the integration layer, not on the agent record
- prefer org-owned integrations first
- allow user-owned integrations later if needed
- pass secrets to runtimes through environment or secret resolution, not through prompts
- do not duplicate raw keys across multiple agents
- keep logs, prompts, and transcripts free of secret values

Recommended storage shape:
- integration metadata stored normally
- secret material stored through a dedicated secret mechanism or encrypted secret store
- agent records only reference integrations, they do not embed the credential itself

Paperclip's shape is a useful reference here:
- secret refs instead of raw config spread everywhere
- local encrypted secret storage as a default option
- environment tests before execution

We do not need the full final secrets platform in V1, but we should keep the structure compatible with secure growth.

## Compatibility Mapping

Current Aura behavior can map into the new model like this:

- current local Aura flow -> `aura_harness + aura_managed + local_host`
- current remote Aura flow -> `aura_harness + aura_managed + swarm_microvm`
- current Claude/Codex direct runtime flow -> local CLI auth unless an org integration is explicitly attached

This lets us introduce the new model without breaking the current system first.

## Aura BYOK Follow-On

Aura should eventually support:
- `Aura + aura_managed`
- `Aura + org_integration`

But that requires harness-side provider config to become more session-aware.

So the near-term rule should be:
- do not imply Aura BYOK is already implemented if it is still backed by process-global provider config
- keep the current UI and runtime behavior honest
- treat Aura BYOK as the next harness-aware extension after this slice ships

## Why This Model

This keeps responsibilities clear:

- the control plane thinks
- Aura OS governs state
- adapters execute work
- integrations provide shared connectivity when needed
- environments decide placement

That separation should make the next phase easier to build, reason about, and extend.
