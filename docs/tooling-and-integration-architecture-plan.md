# Tooling And Integration Architecture Plan

Canonical architecture note: see [Capabilities And Credentials Architecture](./capabilities-and-credentials-architecture.md).

This document is the working reference for how Aura OS should model:
- adapters
- connections
- apps
- workspace tools
- MCP-backed capabilities

It is intentionally product-shaped and implementation-aware.
The goal is to give us one stable mental model before we continue implementation.

## Goal

Support multiple agent adapters and multiple external systems without fragmenting the product.

The desired outcome is:
- Aura OS stays the control plane
- adapters stay the execution brains
- external systems plug into one shared tool surface
- agents and Aura OS can use the same registered tools
- we do not create one-off capability paths for each adapter

We want the platform to feel coherent:
- one way to attach a model provider
- one way to attach an external workspace system
- one way to expose tools
- one way to decide which tools are active for a session

## Current State

Today, Aura OS already has:
- multiple adapters
- workspace-level connection records
- workspace-level app records
- Aura-native project tools for specs, tasks, project state, and loop control
- first-class app tools for GitHub, Linear, Slack, and Notion through a shared manifest and server-side app provider layer
- MCP-based control-plane bridging for supported adapters

What is still incomplete is the unification layer.

Right now, the main gaps are:
- the system still has a split between static registered tools and dynamic MCP tools
- app providers and MCP servers still need to converge into one internal registry shape
- active-tool selection still needs to become a first-class concept

This document is the plan for cleaning that up without discarding the good parts we already built.

## Core Product Concepts

### Adapters

Adapters are the per-agent runtime brains.

Examples:
- `Aura`
- `Claude Code`
- `Codex`
- `Gemini CLI`
- `OpenCode`
- `Cursor`

Adapters are responsible for:
- reasoning
- conversation
- code generation
- file and shell work
- deciding which tool to call

Adapters are not the system of record for project state.

### Connections

Connections are saved provider credentials that power adapters.

Their secrets should be persisted through `aura-integrations`, with any local Aura OS storage path treated as compatibility-only during migration.

Examples:
- `OpenAI`
- `Anthropic`
- `xAI`
- `Google Gemini`
- `Groq`
- `OpenRouter`
- `Together`
- `Mistral`
- `Perplexity`

Connections are mainly for model/runtime access.

They answer:
- which provider account can this workspace use?
- which adapter can authenticate through it?

They do not directly expose user-facing actions.

### Apps

Apps are saved connections to external work systems.

Examples:
- `Linear`
- `Slack`
- `GitHub`
- `Notion`
- `Brave Search`
- `Freepik`
- `Buffer`
- `Apify`
- `Metricool`
- `Mailchimp`
- `Jira`
- `Confluence`
- `Figma`
- `Sentry`

Apps answer:
- which external systems is this workspace connected to?
- which systems are allowed to contribute tools into Aura OS?

They are not adapters, and they are not tools by themselves.

### Workspace Tools

Workspace Tools are the callable actions available inside Aura OS.

Examples:
- Aura-native tools:
  - `create_spec`
  - `list_tasks`
  - `run_task`
  - `start_dev_loop`
- external tools:
  - `linear_create_issue`
  - `slack_post_message`
  - `github_create_issue`
  - `notion_create_page`

Workspace Tools are the actual capability surface visible to:
- Aura OS
- adapters
- eventually other internal automation paths

This is the most important distinction in the model:
- a connection is not a tool
- an integration is not a tool
- a tool is an action exposed through the registry

## Authority Boundary

Aura OS remains the control plane.

`aura-integrations` remains the credential authority.

Aura OS owns:
- projects
- specs
- tasks
- workflow state
- loop orchestration
- persistence
- event emission
- policy and gating
- integration catalog state
- installed-tool projection
- trusted integration brokering

Adapters own:
- reasoning
- tool choice
- coding work
- shell and file work
- runtime-specific execution behavior

The harness owns:
- runtime authorization
- generic tool execution from runtime metadata
- auditability of runtime capability use

External systems own:
- their own APIs and external side effects

`aura-integrations` owns:
- credential persistence
- secret encryption and retrieval
- canonical integration secret metadata

This gives us a simple rule:
- if the action is part of Aura's domain, Aura OS should own it directly
- if the action is external capability, Aura OS should expose it as a tool, but not re-own the external system

## The User-Facing Model

The clean product taxonomy should be:

1. `Adapters`
- the agent brains

2. `Connections`
- model/runtime provider access

3. `Apps`
- external work systems

4. `Workspace Tools`
- the actions available to Aura OS and agents

5. `MCP Servers`
- one important source of Workspace Tools

This wording is intentionally clearer than overloading everything into the word `integration`.

One practical UI rule follows from this:
- a user should be able to understand the difference between "connected", "installed", and "available as a tool"

## Tool Sources

Workspace Tools should come from a small number of clear sources.

### Aura-Native Tools

These are tools Aura OS owns directly because they are part of Aura's own domain.

Examples:
- specs
- tasks
- project metadata
- dev loop orchestration

These should remain native because they need:
- stable semantics
- persistence
- event emission
- workflow ownership

### MCP-Backed Tools

These are tools contributed through MCP servers.

Examples:
- `Linear`
- `Slack`
- `GitHub`
- `Notion`
- internal APIs that expose MCP

This is the preferred V1 path for external systems.

Why:
- it matches the broader ecosystem
- it avoids custom wrappers for every provider
- it lets one external capability surface work across multiple adapters
- it keeps Aura OS focused on control-plane concerns

### App-Provider Tools

These are first-class app integrations that register curated tools into Aura's shared tool surface.

Examples:
- `GitHub`
- `Linear`
- `Slack`
- `Notion`

This is the path for external systems we want to support as first-class product capabilities.

The contract should be:
- each app provider declares which tools it contributes
- those tools are represented in the shared tool manifest
- Aura OS dispatches them through a provider registry rather than ad hoc branching
- agents and Aura OS see the same registered tool metadata

This is closer to the Paperclip-style provider/plugin contract than to a pile of one-off handlers.

### Future Plugin-Backed Tools

Later, Aura OS may support host-native plugin-contributed tools.

This would be closer to Paperclip's internal plugin/tool registry model:
- plugin manifest declares tools
- host registers them
- host dispatches calls to plugin workers

That is a valid long-term direction, but it is not the first step.

## Why MCP First

For external systems, MCP-first is the right V1.

This aligns well with:
- `Claude Code`
- `OpenCode`
- `Cursor`
- `Goose`
- `Continue`
- GitHub's coding agent extension model

These systems generally separate:
- model/runtime access
- external tool surfaces

And they commonly use MCP or MCP-like extension surfaces for external tools.

Cursor does also productize some integrations more deeply, but that is not the minimum system we need first.

## Paperclip Lessons

Paperclip is useful because it shows a more mature split:
- adapters for runtimes
- plugin-native tools for host extensions
- MCP for some shared capability surfaces

That means Paperclip is not:
- MCP only
- nor hardcoded native tools only

The useful lesson for Aura OS is:
- the long-term clean system is a unified host-side tool registry
- but MCP is still a valid and practical first-class source of tools

So our phased direction should be:
- V1: Aura-native tools + first-class app-provider tools + MCP-backed external tools
- V2: unified tool registry that can register all three
- V3: optional plugin host if we need first-class host-native extensions

## V1

### Objective

Ship a clean, understandable system that works now without overbuilding.

### V1 Shape

In V1:
- Aura-native tools remain the source of truth for Aura domain actions
- first-class app providers can register curated app tools into the shared surface
- MCP remains the dynamic external tool path
- adapters consume the same active tool surface
- Aura OS can also invoke the same tool surface where needed

### V1 Tool Sources

V1 should support three sources:
- `aura_native`
- `app_provider`
- `mcp`

That is enough to build a coherent system without introducing plugin-host complexity yet.

### V1 Responsibilities

Aura OS should do:
- register Aura-native tools
- register app-provider tools from first-class app contracts
- discover MCP tools from connected sources
- normalize tool metadata
- decide which tools are active for a workspace, project, or agent
- pass only the active tools into the session
- keep project/spec/task/loop state authoritative
- broker trusted integration access and secret lookup through `aura-integrations` when needed

Adapters should do:
- consume the active tool list
- decide which tool to call
- execute via the tool interface already supplied by Aura OS

The harness should do:
- authorize the active tool set at runtime
- execute installed tools generically from runtime metadata
- remain independent from org secret persistence

For external project-attached adapters, there is one more practical rule:
- Aura may maintain multiple internal tool source kinds
- but adapters like `Codex` and `Claude Code` currently receive the active tool set through a single session-scoped MCP bridge
- this means Aura-native tools, app-provider tools, and dynamic MCP-backed tools are flattened into one MCP-exposed surface for those adapters
- internally the source distinction still matters for policy, registration, and dispatch
- externally the adapter just sees one MCP tool interface

### V1 UI Model

The UI should make these concepts visible:

#### Adapters
- per-agent runtime selection

#### Connections
- provider credentials used by runtimes

#### Apps
- external systems connected to the workspace

#### MCP Servers
- one source of tools, configurable and attachable

#### Workspace Tools
- the unified list of tools available in the workspace

This matters because users need to understand:
- saving a connection is not the same thing as getting tools
- adding an integration is not the same thing as enabling its tools for every agent

### V1 Important Use Cases

#### 1. Core Aura workflow

Aura-native tools should continue to cover:
- specs
- tasks
- project state
- dev loop

This is non-negotiable because Aura OS owns that workflow.

#### 2. Model-backed runtime execution

Connections should power adapters like:
- `Claude Code` through `Anthropic`
- `Codex` through `OpenAI`
- `Gemini CLI` through `Google Gemini`
- `OpenCode` through multiple provider connections

#### 3. External work systems through MCP

Apps like:
- `Linear`
- `Slack`
- `GitHub`
- `Notion`

can contribute tools in two ways:
- as first-class app-provider tools when Aura wants a curated, stable product surface
- as MCP-backed tools when the app already exposes a useful tool server or when we want dynamic capability import

#### 4. Shared tool visibility

Aura OS and adapters should see the same registered tool surface, but not necessarily the full workspace inventory.

Only the active subset should be exposed to a given session.

## Tool Overload And Active Tool Selection

This is a major design requirement.

We do not want every agent session to receive:
- every workspace tool
- every MCP server
- every provider-specific capability

That would:
- confuse the LLM
- increase prompt/tool overhead
- make tool choice worse

So the system should distinguish between:

### Registered Tools

Everything known to the workspace.

### Active Tools

Only the tools exposed to a specific session.

Active tool selection should be filtered by:
- workspace-enabled state
- project relevance
- agent configuration
- current task or mode
- connected integration availability

This is how we keep the tool surface powerful without making it noisy.

## V2

### Objective

Unify Aura-native tools and MCP-backed tools under one internal registry and dispatch model.

### V2 Shape

In V2, Aura OS should have a unified internal tool registry that:
- stores normalized tool metadata
- tracks tool source
- tracks scope and activation rules
- dispatches calls to the right execution path

The registry should support at least:
- `aura_native`
- `app_provider`
- `mcp`

And be designed so we can later add:
- `plugin`

### V2 Registry Model

Every registered tool should have:
- stable id or namespaced name
- source type
- description
- input schema
- scope information
- enablement state
- permissions or gating metadata

Dispatch should then route to:
- native Aura handler
- MCP server call
- later plugin worker call

### V2 Benefits

This gives us:
- one mental model for all tools
- one registry for visibility and policy
- one dispatch layer
- one place to control activation and permissions
- less drift across runtimes

It also creates the foundation for:
- better admin UX
- better auditability
- better policy controls
- better future plugin support

## Future V3

V3 would be optional and larger in scope:
- host-native plugin runtime
- plugin manifests
- plugin lifecycle
- plugin worker dispatch
- plugin-contributed tools

This is probably worth doing only after:
- V1 is proven
- V2 registry exists
- we know we need host-native extensions beyond MCP

## Decision Rules

These rules should guide future implementation work.

### When something should be an Adapter

Use an Adapter when it is:
- the execution brain
- a runtime shell
- a model-facing coding/chat environment

Examples:
- `Claude Code`
- `Codex`
- `Gemini CLI`
- `OpenCode`
- `Cursor`

### When something should be a Workspace Connection

Use a Workspace Connection when it is:
- provider access
- an account or API credential used by runtimes
- not a direct user action surface

Examples:
- `OpenAI`
- `Anthropic`
- `xAI`
- `Google Gemini`
- `Groq`
- `OpenRouter`

### When something should be a Workspace Integration

Use a Workspace Integration when it is:
- an external work system
- a source of tools or actions
- not the runtime brain itself

Examples:
- `Linear`
- `Slack`
- `GitHub`
- `Notion`
- `Jira`

### When something should be an Aura-Native Tool

Use an Aura-native tool when:
- Aura OS owns the domain
- the action mutates Aura workflow state
- the action needs stable control-plane semantics

Examples:
- spec creation and updates
- task transitions and runs
- project state changes
- dev loop control

### When something should be an MCP-Backed Tool

Use MCP-backed tools when:
- the capability belongs to an external system
- we want the external system to expose its own tool surface
- we do not need to hand-build a bespoke Aura wrapper first

Examples:
- `Linear`
- `Slack`
- `GitHub`
- `Notion`

## Implementation Direction

The next implementation steps should follow this order:

1. clean up the product vocabulary in the UI
- `Adapters`
- `Connections`
- `Apps`
- `Workspace Tools`
- `MCP Servers`

2. formalize V1 tool sources
- `aura_native`
- `app_provider`
- `mcp`

3. formalize the first-class app provider contract
- GitHub
- Linear
- Slack
- Notion
- shared manifest parity

4. build the active-tool filtering model
- registered tools vs active tools

5. make `aura-integrations` explicitly canonical for persisted secrets and mark local storage as compatibility-only

6. keep Aura-native ownership for Aura domain tools

7. expose external workspace capabilities through MCP first where dynamic discovery is the better fit

8. design the V2 unified registry once V1 is working well without collapsing trusted app-provider tools and MCP-backed tools into one trust model

## Non-Goals For V1

V1 should not try to:
- build a full Paperclip-style plugin host
- create custom Aura-native wrappers for every integration
- expose every registered tool to every session
- solve every future extension mechanism at once

## Summary

The correct near-term system is:
- Adapters are the brains
- Connections power runtimes
- Apps connect external systems
- Workspace Tools are the action surface
- Aura-native tools own Aura's domain
- first-class app-provider tools give us a curated product surface for key apps
- MCP-backed tools give us the dynamic external integration path
- only a filtered active subset should be exposed per session

The correct long-term system is:
- one unified internal tool registry
- one dispatch model
- multiple tool sources
- optional plugin-host support later

That gives Aura OS a clear V1 we can ship and a V2 we can grow into without redesigning the product vocabulary again.
