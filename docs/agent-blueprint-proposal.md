# Agent Blueprints — Technical Proposal

## Problem

AURA agents are currently project-scoped and user-owned. There's no way to package an agent's knowledge and configuration into something shareable, discoverable, or monetizable. For the Agent Store vision (AURA OS + Agent Store, like iOS + App Store), we need a publishable artifact that captures everything required to deploy a functional domain-expert agent.

## Current Agent Model

```
Agent (aura-network)
  - name, role, personality, system_prompt
  - skills: string[]  (free-text labels, no structured definitions)
  - icon, machine_type, wallet_address
  - user_id, org_id
```

An agent today is essentially a system prompt with metadata. Skills are just labels ("coding", "analysis") with no executable definition. There's no knowledge layer, no versioning, no way to share or install agents across orgs.

## Proposed: Agent Blueprint

A Blueprint is a versioned, publishable package that captures everything needed to instantiate a domain-expert agent.

### Data Model

```
AgentBlueprint
  id: UUID
  author_id: UUID              (creator user)
  author_org_id: UUID          (optional: org that owns it)
  slug: string                 (globally unique handle, e.g. "legal-contract-reviewer")
  name: string                 (display name)
  description: string          (marketplace listing description)
  category: enum               (see Category enum below)
  tags: string[]               (searchable tags)
  icon: string                 (avatar/logo URL)
  visibility: enum             (private | unlisted | public)

  # Agent Configuration
  role: string                 (agent role)
  personality: string          (behavior profile)
  system_prompt: string        (core LLM instructions)
  skills: SkillDefinition[]    (structured skill definitions, see below)
  required_integrations: string[]  (integrations the agent needs, e.g. ["slack", "github"])
  default_model: string        (recommended model, e.g. "claude-sonnet-4-6")
  machine_type: string         (local | remote — proprietary blueprints must be remote)

  # Knowledge Layer
  knowledge: KnowledgeEntry[]  (domain expertise, see below)

  # Marketplace Metadata
  pricing: PricingConfig       (free | per_invocation | subscription)
  latest_version: string       (semver, e.g. "1.2.0")
  total_installs: i64
  avg_rating: f32

  created_at: timestamp
  updated_at: timestamp
```

#### Category Enum

Controlled list for marketplace discovery:

```
engineering, legal, finance, marketing, sales, operations,
hr, support, research, design, data, security, other
```

New categories can be added via migration as the marketplace grows, but keeping a controlled list ensures consistent discovery and filtering.

### Blueprint Version

Each publish creates an immutable version snapshot:

```
BlueprintVersion
  id: UUID
  blueprint_id: UUID
  version: string              (semver: "1.0.0", "1.1.0", etc.)
  changelog: string            (what changed in this version)

  # Full snapshot of configuration at this version
  role: string
  personality: string
  system_prompt: string
  skills: SkillDefinition[]
  knowledge: KnowledgeEntry[]
  required_integrations: string[]
  default_model: string

  published_at: timestamp
```

Once published, a version is immutable (like npm). The author can publish new versions but cannot modify or delete existing ones. This ensures installers pinned to a version get consistent behavior.

### Structured Skills (MCP-Compatible)

Anthropic's Agent Skills spec (launched as an open standard, March 2026) and the Model Context Protocol (MCP) are now the de facto industry standards for agent tool use — 97M monthly downloads, all major providers on board. AURA's skill model should be compatible with this ecosystem rather than inventing a proprietary format.

Replace free-text skill labels with structured definitions:

```
SkillDefinition
  name: string                 (e.g. "contract_review")
  description: string          (what this skill does)
  tool_type: enum              (builtin | mcp | integration | custom)
  config: JSON                 (tool-specific configuration, see below)
  is_proprietary: bool         (if true, config is not exposed to installers)
```

#### Tool type configs:

- **`builtin`**: Ships with AURA (file system, git, terminal, web search, etc.)
  - config: `{ "tool_name": "web_search" }` — references a known AURA tool
- **`mcp`**: Uses an MCP server (the emerging standard for agent tools — 10,000+ servers available)
  - config: `{ "server": "mcp-server-slack", "registry": "npmjs.com", "version": "^1.0.0" }` — references a published MCP server
  - This makes AURA's marketplace compatible with the broader MCP ecosystem. Blueprint authors can compose from existing MCP servers rather than building everything from scratch.
- **`integration`**: Uses an external service via AURA's integration layer (Shahroz's work)
  - config: `{ "integration": "slack", "scopes": ["channels:read", "chat:write"] }` — declares which AURA-managed integration and what permissions are needed
  - The installer provides their own API keys when they install the blueprint
- **`custom`**: User-defined proprietary logic (Phase 5 — WASM sandbox)
  - config: `{ "wasm_hash": "sha256:...", "capabilities": ["http_fetch", "json_parse"] }` — references a sandboxed WASM module with declared capabilities
  - Prior art: Microsoft's Wassette (WASM-based MCP tool execution with deny-by-default permissions) validates this approach and provides tooling to build on

### Knowledge Layer

Domain expertise beyond the system prompt. This is the moat — the thing that makes a "legal agent" actually useful vs a generic LLM with a legal system prompt.

```
KnowledgeEntry
  id: UUID
  name: string                 (e.g. "California Employment Law Edge Cases")
  type: enum                   (document | rules | examples | faq)
  content: string              (markdown text, rules in structured format, etc.)
  is_proprietary: bool         (if true, content is server-side only — see IP Protection)
  order: i32                   (injection priority — lower = injected first)
```

#### Knowledge type semantics:

- **`document`**: Reference material (legal codes, product specs, industry standards)
- **`rules`**: Decision logic ("if X then do Y", "never do Z in this jurisdiction")
- **`examples`**: Few-shot examples of desired agent behavior
- **`faq`**: Common questions and expert answers for the domain

#### Context injection strategy:

The industry has converged on "context engineering" — combining multiple approaches rather than relying on a single method. AURA's knowledge layer should support a tiered approach:

**Tier 1 — Always-on context (small, high-priority knowledge):**
Knowledge entries with low `order` values are concatenated directly with the system prompt at invocation time:

```
[system_prompt]
---
[knowledge entry 1 — order 0, type: rules]
[knowledge entry 2 — order 1, type: examples]
...
```

Best for: decision rules, few-shot examples, critical edge cases. These entries should be concise enough to fit within the model's context window alongside conversation.

**Tier 2 — Retrieved context (large knowledge bases):**
Knowledge entries with higher `order` values or large `document` types are indexed for retrieval. At invocation time, relevant entries are selected based on the current task/query and injected into context.

Best for: reference documents, legal codes, product catalogs. Uses semantic search to inject only what's relevant to the current task.

**Context window management**: Total injected knowledge is capped per model (e.g. 30% of context window reserved for knowledge, rest for conversation). Lower `order` entries take priority. The blueprint author controls what's always-on vs retrieved by setting `order` and entry size.

### IP Protection for Proprietary Knowledge and Skills

This is the hardest problem. If an agent runs on the installer's local machine, the system prompt and knowledge are visible in the process — there's no way to prevent the user from reading them.

**Solution: Proprietary blueprints run server-side.**

Agents with `is_proprietary` knowledge or skills must use `machine_type: "remote"`. They execute on AURA's infrastructure (aura-swarm), not the installer's machine. The installer interacts with the agent through the AURA API — they send tasks and receive results, but never see the system prompt, knowledge entries, or proprietary skill configs.

This aligns with the existing architecture:
- `machine_type: "local"` → runs on user's machine via aura-harness → full transparency, no proprietary content allowed
- `machine_type: "remote"` → runs on AURA swarm → proprietary content stays server-side

**Enforcement**: When publishing a blueprint, if any `KnowledgeEntry.is_proprietary = true` or any `SkillDefinition.is_proprietary = true`, the blueprint's `machine_type` must be `"remote"`. The publish endpoint rejects it otherwise.

**Limitations**:
- Prompt injection attacks could theoretically extract injected knowledge via the LLM's outputs. Mitigations: output filtering, instruction hardening, monitoring for knowledge exfiltration patterns.
- Server-side execution has latency and cost implications vs local execution.

### Pricing

```
PricingConfig
  type: enum                   (free | per_invocation | subscription)
  price_usd_cents: i64         (price in USD cents — stable unit of account)
  trial_invocations: i32       (free invocations before billing starts, 0 = no trial)
```

- **`free`**: No charge. Open source blueprints.
- **`per_invocation`**: Charged each time the agent starts a task/session. Billed through z-billing.
- **`subscription`**: Monthly fee for unlimited use. Billed through z-billing.

Prices are denominated in **USD cents** for stability. If AURA token is used for payment, conversion happens at transaction time at current market rate. This avoids blueprints becoming worthless or absurdly expensive due to token price swings.

An **invocation** is defined as starting a new agent session (not per-message or per-token — those costs are covered separately by the LLM usage billing in z-billing).

### Installation

When a user "installs" a blueprint into their org:

```
BlueprintInstallation
  id: UUID
  blueprint_id: UUID
  blueprint_version: string    (pinned version at install time)
  org_id: UUID                 (installer's org)
  installed_by: UUID           (user who installed)
  agent_id: UUID               (the agent created from this blueprint)
  installed_at: timestamp
  auto_update: bool            (auto-upgrade to new minor/patch versions)
```

#### Install behavior:
- Creates a real Agent in aura-network with the blueprint's config
- Agent works independently — no runtime dependency on the blueprint registry
- If the blueprint is later unpublished or deleted, the installed agent **keeps working** (it's a real agent, not a reference)

#### Update behavior:
- If `auto_update = true`, when a new version is published, the installed agent's config is updated **only if the agent is idle** (not currently running a task)
- Major version bumps (1.x → 2.x) are never auto-applied — require manual upgrade confirmation
- Updates are applied by syncing: system_prompt, personality, role, skills, knowledge from the new version

#### Required integrations on install:
- If the blueprint declares `required_integrations: ["slack", "github"]`, the install flow checks whether the org has those integrations configured
- If missing, the installer is prompted to set them up before the agent can be used
- The agent is created but marked as `blocked` until all required integrations are connected

## Where This Lives

### aura-network (the registry)

New tables:
- `agent_blueprints` — blueprint metadata, author, visibility, pricing, category
- `blueprint_versions` — immutable version snapshots with full config
- `blueprint_knowledge` — knowledge entries per version (separate table for large content)
- `blueprint_installations` — who installed what, version pinning, auto-update preference

New endpoints:
- `POST /api/blueprints` — create blueprint (draft)
- `GET /api/blueprints` — search/browse marketplace (public only, filterable by category/tags)
- `GET /api/blueprints/:slug` — get blueprint detail + latest version
- `GET /api/blueprints/:slug/versions` — list all versions
- `POST /api/blueprints/:slug/versions` — publish new version (validates proprietary constraints)
- `POST /api/blueprints/:slug/install` — install into org (creates agent, checks integrations)
- `DELETE /api/blueprints/:slug/installations/:installId` — uninstall (deletes agent)
- `GET /api/orgs/:orgId/installations` — list installed blueprints for an org

### aura-os (the client)

- Blueprint browsing/search UI in the agent management area
- "Publish as Blueprint" action on existing agents
- "Install from Store" flow that creates a local agent from a blueprint
- Integration check during install (prompts user to configure missing integrations)

### Billing (z-billing)

- Track per-invocation or subscription charges for blueprint-installed agents
- Route payments from installer's org to blueprint author
- Revenue split: author gets X%, AURA platform gets Y% (percentages TBD)
- Existing LLM token billing continues separately (installer pays for compute, author pays nothing)

## Implementation Phases

### Phase 1: Foundation (data model + CRUD)
- Blueprint and version tables in aura-network
- Create, read, update, publish endpoints
- "Publish" flow: user creates a blueprint from an existing agent
- Slug validation (globally unique, URL-safe)
- No marketplace UI yet — API only

### Phase 2: Knowledge Layer
- Knowledge entries table, attached to blueprint versions
- Context injection at agent invocation time (system_prompt + knowledge concatenation)
- Context window management (priority-based truncation)
- Proprietary flag enforcement (must be remote if proprietary)

### Phase 3: Marketplace + Install
- Browse/search/filter UI in aura-os
- Category and tag filtering
- Install flow (blueprint → agent in your org)
- Required integrations check on install
- Installation tracking and management
- Ratings and reviews

### Phase 4: Monetization
- Pricing configuration per blueprint
- Per-invocation billing through z-billing
- Subscription billing through z-billing
- Revenue share routing to authors
- AURA token payment integration (USD conversion at transaction time)

### Phase 5: Safe Proprietary Skills
- WASM sandbox for custom tool execution
- Code signing and verification
- Capability-based permissions (what resources can a skill access?)
- Skill audit/review process before marketplace listing

### Future: Multi-Agent Blueprints
- A blueprint that defines a coordinated team of agents (a "crew")
- CEO agent + specialist agents with defined delegation patterns
- Maps to Neo's SuperAgent/process architecture
- Deferred until single-agent blueprints are proven

## Relationship to Current Architecture

```
Before:
  User → Agent → AgentInstance (in project)

After:
  Blueprint Author → Blueprint (in marketplace)
                          ↓ install
  User → Agent (from blueprint) → AgentInstance (in project)
                          ↑ updates (if auto_update)
  Blueprint Author → New Version
```

The existing Agent → AgentInstance → ProjectAgent model stays exactly as-is. Blueprints sit above it as the packaging and distribution layer. No breaking changes to current functionality.

## Governance and Audit

Enterprise adoption requires accountability (GitHub spent March 2026 building exactly this layer). The blueprint system should include:

- **Installation audit trail**: Every install, uninstall, and version update is logged with timestamp, user, and org. Queryable via API.
- **Usage tracking**: Per-blueprint invocation counts, token usage, and error rates. Visible to both author (for analytics) and installer (for cost management).
- **Blueprint review process**: Public blueprints go through a review before marketplace listing (like CrewAI's enterprise marketplace). Initially manual, later automated with safety checks.
- **Abuse reporting**: Installers can flag blueprints for malicious behavior, knowledge exfiltration attempts, or misrepresentation.

## Key Design Decisions

1. **Blueprints live in aura-network** — it's the social/registry layer, already handles discovery (feed, profiles, orgs)
2. **Slugs are globally unique** — like npm package names, avoids collision and enables clean URLs
3. **Versions are immutable** — once published, a version cannot be changed or deleted (like npm)
4. **Knowledge is the moat** — system prompts are commoditized, domain knowledge is not
5. **Proprietary content requires remote execution** — local agents are transparent by nature; proprietary knowledge/skills stay server-side on AURA swarm
6. **Install creates a real Agent** — no runtime dependency on the registry, agents work offline and survive blueprint deletion
7. **Auto-update is conservative** — only applies to idle agents, never during execution, never across major versions
8. **Prices in USD cents** — stable unit of account; token conversion at transaction time
9. **MCP-compatible, not MCP-exclusive** — skills can reference MCP servers (10,000+ ecosystem) but also support AURA-native integrations and proprietary WASM tools. This keeps AURA open to the broader ecosystem while offering capabilities MCP alone doesn't provide (tokenized billing, proprietary IP protection, agent wallets)
10. **Multi-agent blueprints deferred** — get single-agent right first, crews are a natural extension

## AURA's Differentiators vs Existing Marketplaces

| Feature | CrewAI Marketplace | MCP Ecosystem | AURA Agent Store |
|---------|-------------------|---------------|------------------|
| Agent packaging | Crew templates (Python) | MCP servers (tools only) | Full blueprint (prompt + knowledge + skills + config) |
| IP protection | Open source only | Open source only | Proprietary knowledge + skills via server-side execution |
| Monetization | Revenue share (planned) | Free / donations | Per-invocation, subscription, token-native billing |
| Agent identity | None | None | Wallet address, on-chain identity, tokenizable |
| Knowledge layer | None (just code) | None (tools only) | Structured domain expertise with tiered context injection |
| Composability | Python code | Composable MCP servers | MCP-compatible + AURA integrations + WASM custom tools |
