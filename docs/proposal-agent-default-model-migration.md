# Proposal: Agent AI `default_model` — add to aura-network (a migration)

> Why agent model selection needs to move cloud-side — a small schema migration on `aura-network`.

## The `default_model` gap

The pattern of "bake the model into each delegate" only works if `default_model` sticks. Today it doesn't sync. Below: the gap, the consequences, and the case for fixing it via a small migration on `aura-network`.

---

## Agent-record field audit — what aura-network knows vs what only your machine knows

Every field that defines an agent should follow the same persistence rule. One field doesn't — and it's the one we'd want to lean on most for multi-agent workflows.

**✓ Cloud-synced (on aura-network) — 15 fields**

`name` · `role` · `personality` · `system_prompt` · `skills` (labels) · `icon` · `machine_type` · `permissions` · `intent_classifier` · `listing_status` · `expertise` · `tags` · `wallet_address` · `vm_id` · `jobs / revenue_usd / reputation`

All survive device changes. All visible in marketplace browse. All travel if the agent is hired.

**✗ Local-only (per-machine) — 1 field**

⚠ **`default_model`** — the only piece of an agent's configuration that **doesn't** follow the same persistence rule as everything else.

*Stored at:* local Aura server's agent shadow + runtime config (`aura-os-core`, not `aura-network`).

| 15 | 1 |
|----|---|
| fields synced via `aura-network` | field stuck on the local machine |

---

## Current behavior vs the path with cloud-synced `default_model`

| Today (local-only) | → | With cloud-synced `default_model` (after migration) |
|--------------------|---|------------------------------------------------------|
| **No UI input** — User never sets `default_model`. New agents end up with `None`. | → | User picks a model in the editor. Value stored on the aura-network record. |
| **Multi-agent call** — CEO delegates to worker. Worker has no `default_model`. Worker runs on the harness env-default — whatever the deployment configured. | → | **Multi-agent call** — CEO delegates to worker. Worker's `default_model` arrives with the agent record. `effective_model()` resolves to it. **Predictable model per worker, every call.** |
| **Side effect** — No prompt cache key gets pinned. Cost/latency penalty on repeated calls. | → | **Side effect** — Cache key + 24h retention auto-engage via `session_model_overrides_with_cache`. Cheaper, faster for hot agents. |
| **Move to a new device** — Even if you'd set it via API, the new device's local store doesn't have it. Setting drifts per machine. | → | **Move to a new device** — Setting follows the agent. Same behavior everywhere. No drift. |

---

## What stays broken if `default_model` stays local

- 🖥️ **Per-device drift** — Same agent on your laptop vs desktop runs on different models if you only set the dropdown on one. No way to make a setting that follows the agent.
- 🛒 **Marketplace gap — hired agents lose their model** — When an agent is marked `hireable`, all 15 cloud-synced fields are part of what's discoverable. `default_model` isn't — so a buyer can't see what model the agent runs on, and the owner can't guarantee consistent behavior across hire flows.
- 📦 **Blueprint marketplace blocker** — The proposed Blueprint Marketplace (`docs/agent-blueprint-proposal.md`) versions agent definitions for distribution. If `default_model` isn't a cloud-side field, it can't ship as part of a blueprint version — the new installer would need to re-pick the model manually.
- 🔁 **Cloud agent runs lose the preference** — A `machine_type: remote` agent runs on a swarm pod whose harness doesn't know about your local store. Even if you set `default_model` locally, it never reaches the pod — the remote agent always uses the harness env-default.
- 📊 **No marketplace analytics by model** — The aura-network agent record drives discoverability, reputation, revenue tracking. Without `default_model` on the record, "show me all agents running on Sonnet" isn't queryable. Cost-per-model breakdowns aren't easy to compute server-side either.
- ⚙️ **Inconsistent persistence rule** — Every other piece of an agent's identity and config follows the "cloud is source of truth" rule. `default_model` is the outlier. New engineers reading the code will assume it works like the rest — and be surprised.

---

## The fix — a small migration on aura-network

Three coordinated changes. The local side is already wired — these changes complete the round-trip.

### Step 1 · Database migration

Add the column on `aura-network/crates/db/migrations/00XX_add_agent_default_model.sql`:

```sql
ALTER TABLE agents ADD COLUMN default_model TEXT;
```

Nullable. No backfill needed — existing rows default to NULL, preserving current behavior (harness env-default).

### Step 2 · Domain model

In `aura-network/crates/domain/agents/src/models.rs`, add three field lines:

```rust
// Agent struct
pub default_model: Option<String>,

// CreateAgentRequest
pub default_model: Option<String>,

// UpdateAgentRequest
pub default_model: Option<Option<String>>,    // outer None = don't change
```

### Step 3 · Conversion plumbing on aura-os-server

The local `agent_from_network` conversion (in `handlers/agents/conversions/`) needs one extra line copying `net.default_model` onto the local `Agent`. Symmetric line on the create/update side. **Once both sides match, serde does the rest automatically.**

### What stays the same — zero refactoring needed

- The local `CreateAgentRequest` DTO already has `default_model` — no change.
- `effective_model()` resolver already reads `agent.default_model` — no change.
- `session_model_overrides_with_cache` already wraps the value with cache key + retention — no change.
- The form's React state already manages `defaultModel` — no change. The form just needs the input field exposed in `AgentEditorForm.tsx`.

---

## Why this migration is consistent — the symmetry argument

Look at how every other "agent runtime preference" field is currently handled:

| Field | Where stored | Synced? | Why |
|-------|--------------|---------|-----|
| `system_prompt` | aura-network | Yes | Defines agent behavior |
| `permissions` | aura-network | Yes | Defines agent capabilities |
| `intent_classifier` | aura-network | Yes | Defines per-turn tool narrowing |
| `machine_type` | aura-network | Yes | Defines where the agent runs |
| `icon` | aura-network | Yes | Visual identity |
| **`default_model`** | **local only** | **No** | **Defines which model the agent uses ← inconsistent** |

**The pattern is clear.** Anything that defines what an agent *is* or *how it behaves* lives on aura-network. `default_model` is one of the most behavior-defining fields possible — and it's the lone outlier in the local store. Moving it to `aura-network` isn't a new pattern; it's restoring the existing one. Three small changes; downstream code already supports it.
