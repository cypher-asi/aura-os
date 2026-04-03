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

What provider, auth, and connection config that runtime uses.

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

## Simple Rule

- Adapter chooses the runtime
- Integration gives the runtime credentials and config
- Environment tells us where it runs

## Examples

- Aura harness + org integration + local host
- Aura harness + org integration + swarm microVM
- Claude Code + org Anthropic integration + local host
- Codex + org OpenAI integration + local host

Important:
- Aura harness also consumes integrations
- It is not special here
- Aura OS should resolve the integration and pass runtime config into the harness session

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
2. Add integration selection and resolution
3. Add environment selection
4. Keep current Aura behavior compatible
5. Make Aura harness the first adapter on this model
6. Keep workflow and task authority in Aura OS
7. Support a thin but real end-to-end product flow
8. Add Claude Code and Codex after the foundation is in place

## V1 End-to-End Flow

V1 should be more than backend wiring. It should provide a real visible product flow.

The minimum usable flow should be:

1. Create or edit an organization
2. Add an org integration
3. Optionally test that integration or environment
4. Create or edit an agent
5. Choose adapter, integration, and environment
6. Run the agent through the normal Aura flow
7. Verify that execution actually went through the selected runtime

That means a user should be able to do at least this from the product:

- add an Anthropic integration at the org level
- create an agent that uses `aura_harness`
- create an agent that uses `claude_code`
- create an agent that uses `codex`
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
- integration selection
- environment selection

Initial adapter list:
- `aura_harness`
- `claude_code`
- `codex`

Initial environment list:
- `local_host`
- `swarm_microvm`

## Test Environment

We should include a lightweight "test environment" capability in V1.

This is inspired by Paperclip's adapter test flow and helps avoid blind configuration.

The goal is to answer:
- is the command available?
- is the working directory valid?
- is auth present?
- is the configured model likely usable?
- can a small hello probe run?

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

- current local Aura flow -> `aura_harness + org integration + local_host`
- current remote Aura flow -> `aura_harness + org integration + swarm_microvm`

This lets us introduce the new model without breaking the current system first.

## Why This Model

This keeps responsibilities clear:

- the control plane thinks
- Aura OS governs state
- adapters execute work
- integrations provide connectivity
- environments decide placement

That separation should make the next phase easier to build, reason about, and extend.
