# Runbook: Operating Remote Agents on aura-swarm

Day-to-day operational expectations for remote agents (confidential SEV-SNP VMs managed by the aura-swarm gateway). Background and architecture: [docs/aura-swarm.md](../aura-swarm.md); platform spec: [`../aura-swarm/docs/spec/v0.2.0/`](../../../aura-swarm/docs/spec/v0.2.0/README.md) (sibling checkout).

All gateway calls below can be made directly with the user's zOS JWT (`Authorization: Bearer <jwt>` against `SWARM_BASE_URL`), or through the aura-os proxy routes where noted.

## Wake / hibernate expectations

**Auto-hibernate is the default.** The platform hibernates a remote agent after it has been continuously idle (no active sessions) for the configured window — 30 minutes by default (`HIBERNATE_AFTER_IDLE_SECONDS` on the gateway). Hibernation terminates the VM but preserves sealed state; a hibernated agent costs nothing.

There are **three wake paths**:

1. **Explicit** — `POST /v1/agents/:id/wake` (aura-os: `POST /api/agents/:id/remote_agent/wake`, or the lifecycle buttons in the agent environment popup).
2. **New session/run** — starting a chat or run against a hibernating agent auto-wakes it. Expect a cold-start delay: the VM boots, attests, fetches its sealing key, and opens sealed state before going Ready (aura-os polls readiness for up to 90s).
3. **Cron trigger** — the platform's cron service wakes the agent when one of its process triggers is due, fires the trigger, and lets auto-hibernate put it back to sleep. This works while aura-os is closed.

Operational notes:

- Wake is not instant — budget tens of seconds (attestation boot), not milliseconds.
- A lifecycle action recycles the VM's harness runs; in-flight runs are interrupted (state and secrets persist).
- If an agent is stuck (`error` state, VM lost), use `POST /api/agents/:id/remote_agent/recover` to re-provision a VM against the same sealed state.
- States: `provisioning → running ⇄ idle → hibernating/stopped`, plus `error`. Check with `GET /api/agents/:id/remote_agent/state`.

## Tier changes

Tiers: `small` (500m / 1 GiB, 4¢/h), `standard` (1000m / 2 GiB, 8¢/h, default), `pro` (2000m / 4 GiB, 15¢/h). All tiers have identical isolation and sealing — a tier change is purely a resize.

```
POST {SWARM_BASE_URL}/v1/agents/{agent_id}/tier
Authorization: Bearer <user-jwt>
Content-Type: application/json

{ "tier": "pro" }
```

Semantics:

- **Asleep (hibernating/stopped)**: record-only; the new size applies on the next wake. No interruption.
- **Awake (running/idle)**: the platform checks credit at the new rate, closes active sessions, and recreates the VM at the new size — in-flight runs are interrupted; sealed state, vault, and processes persist. Same-tier requests are no-ops.
- **Billing split**: a `tier_changed` usage event records both hourly prices, so cost intervals split exactly at the change — you are never billed the new rate for time before the change (or vice versa).

(aura-os does not currently expose a tier-change button; use the gateway API directly.)

## Usage / cost queries

zbilling is the billing ledger; these endpoints are user-facing statistics. Ranges are RFC3339 `from`/`to` query params, defaulting to the last 30 days.

Per-agent:

```
GET {SWARM_BASE_URL}/v1/agents/{agent_id}/usage?from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z
```

Returns billable intervals (each priced at the tier rate in force at the time), `awake_seconds`, `cost_cents`, counters (`wakes`, `triggers_fired`, `tier_changes`), and recent raw events.

All your agents:

```
GET {SWARM_BASE_URL}/v1/usage?from&to
```

Returns a per-agent summary table plus `total_awake_seconds` / `total_cost_cents` (scoped to your JWT; destroyed agents are excluded).

Quick health check: `GET /v1/agents/:id/status` includes 24h figures (`awake_seconds_24h`, `estimated_cost_cents_24h`, `wakes_24h`, `triggers_fired_24h`).

Cost rules of thumb:

- You pay only while a VM exists (running or idle) — hibernated time is free, so auto-hibernate is your cost control.
- An agent with cron processes wakes, runs, and re-hibernates on its own; check `triggers_fired` if costs look unexpected.

## Logs access

Two log planes:

- **VM/platform logs** (visible): VM stdout — boot, attestation, health, harness lifecycle. In aura-os: the **VM logs** tab in the remote agent's details view (live tail merged with termination snapshots, entries tagged `live` / `snapshot`). Direct: `GET {SWARM_BASE_URL}/v1/agents/{id}/logs?tail=200&since=...` or the aura-os proxy `GET /api/agents/:id/remote_agent/logs`.
- **In-VM agent logs** (sealed): detailed agent activity stays encrypted inside the VM and is not collected by the platform.

Notes:

- Termination snapshots keep the last ~1000 lines from every VM shutdown (hibernate, stop, crash, resize), so post-mortems work on hibernated agents — look for `"source": "snapshot"` entries.
- Snapshots are capped per agent (oldest pruned); don't expect unbounded history.
- For a wake that never goes Ready, the live tail is the first place to look (attestation or key-release failures appear there).
