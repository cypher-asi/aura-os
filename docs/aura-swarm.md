# aura-swarm Integration

How Aura OS works with **aura-swarm**, the platform that runs remote agents in confidential SEV-SNP VMs. This is the aura-os-side view; the platform itself is specified in the aura-swarm repo at [`../aura-swarm/docs/spec/v0.2.0/`](../../aura-swarm/docs/spec/v0.2.0/README.md) (sibling checkout).

## The local / swarm split

Every agent has a `machine_type`. Routing is decided per agent by `HarnessMode::from_machine_type` (`crates/aura-os-core/src/enums.rs`):

| `machine_type` | Mode | Runtime | Configured by |
|---|---|---|---|
| `"local"` | `Local` | aura-harness process on this machine (auto-spawned sidecar or external) | `LOCAL_HARNESS_URL`, `AURA_HARNESS_DIR`, `AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN` |
| anything else | `Swarm` | A confidential SEV-SNP VM managed by the aura-swarm gateway | `SWARM_BASE_URL` |

Both modes run the **same harness runtime** and speak the same run contract (`POST /v1/run` + `WS /stream/:run_id`), so chat, dev-loops, terminals, and file access behave identically. The differences are where the harness lives and what wraps it:

- **Local**: plaintext state on the local disk, no billing, no lifecycle (the process is just there).
- **Swarm**: each agent is a confidential VM — hardware-encrypted memory, state sealed (AES-256-GCM under a per-agent key released only after remote attestation), hibernate/wake lifecycle, and per-tier hourly billing (`small` 4¢/h, `standard` 8¢/h default, `pro` 15¢/h). The aura-os server, the swarm control plane, and the cloud provider cannot read agent content.

## What the aura-os server proxies

The server never lets the browser talk to the swarm gateway directly. It verifies the agent is a remote agent (via aura-network `machine_type`), then forwards to `SWARM_BASE_URL` with the **user's own zOS JWT** as the bearer — the gateway enforces ownership, so there is no shared swarm credential in aura-os.

| aura-os endpoint | Gateway endpoint | Purpose |
|---|---|---|
| `GET /api/agents/:id/remote_agent/state` | `GET /v1/agents/:id/state` | Lifecycle state, uptime, sessions, tier resources, harness build SHA |
| `GET /api/agents/:id/remote_agent/logs?tail&since` | `GET /v1/agents/:id/logs` | VM/platform logs (see below) |
| `POST /api/agents/:id/remote_agent/:action` | `POST /v1/agents/:id/{action}` | `hibernate` / `stop` / `restart` / `wake` / `start` |
| `POST /api/agents/:id/remote_agent/recover` | create/recover pipeline | Re-provision a lost VM for an existing agent |
| `POST /api/agents/:id/remote_agent/files`, `.../read-file` | `POST /v1/agents/:id/files`, `.../read-file` | Remote workspace browsing |
| chat / dev-loop sessions | `POST /v1/agents/:id/run` + `WS .../stream/:run_id` | Runs, via the swarm harness adapter (`crates/aura-os-harness/src/swarm_harness.rs`) |

Agent creation goes through the server's swarm provisioning pipeline (`apps/aura-os-server/src/handlers/agents/crud/swarm/`), which creates the gateway-side agent and polls readiness (2s interval, 90s budget) — a remote agent is "ready" once its VM has attested, fetched its sealing key, and opened sealed state.

## Processes and the trigger registration path

Remote agents support **processes** (cron automations) that follow the "trigger outside, data inside" design:

1. The process definition (cron + prompt + config) is created **inside the VM** via the harness `/v1/processes` API and sealed at rest there.
2. After every process mutation, the harness pushes only content-free trigger metadata — `(process_id, cron, enabled, next_run_at)` — to the swarm gateway (best-effort replace-sync, authenticated with a platform-internal token the swarm scheduler injects into the VM).
3. The gateway's cron service (~30s tick) wakes the agent when a trigger is due, fires `POST /v1/processes/:id/trigger` into the VM (process id only, never a payload), and the platform's auto-hibernate loop puts the idle agent back to sleep afterwards. Scheduling works even while the agent is hibernated — that is the point.

**Local agents:** the harness trigger registrar is disabled when the swarm environment variables are absent, and registration of local-agent triggers into aura-storage scheduling rows is **not implemented yet**. A local agent can define processes and fire them manually (`POST /v1/processes/:id/trigger` on the local harness), but nothing schedules them externally while aura-os is closed.

## VM logs tab

Remote agent details (the agent environment popup / `ProjectAgentDetailsView`) include a **VM logs** panel (`interface/src/components/RemoteLogsPanel/`):

- Shows the VM/platform log plane: pod stdout — boot, attestation, health, and harness lifecycle lines. The harness keeps agent content off stdout, and detailed in-VM agent logs stay sealed inside the guest, so nothing sensitive appears here.
- The gateway merges the **live tail** (while the VM runs) with **termination snapshots** (the final ~1000 lines captured whenever a VM hibernates/stops), each entry tagged `live` or `snapshot` — so you can see why a VM went down even after it's gone.
- The panel fetches 200 merged entries per refresh through `GET /api/agents/:id/remote_agent/logs`.

## Configuration summary

```bash
# .env
SWARM_BASE_URL=https://your-swarm-gateway.example.com   # enables remote agents
LOCAL_HARNESS_URL=http://localhost:8080                  # local agents
# AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN=1                 # remote-only deployments
```

- Unset `SWARM_BASE_URL` → remote-agent operations return `503 remote agent runtime is not configured (SWARM_BASE_URL)`.
- Desktop builds bake in a default `SWARM_BASE_URL` (`apps/aura-os-desktop/build.rs`); the env var overrides it.
- When sessions route off-box, set `AURA_SERVER_BASE_URL`/`VITE_API_URL` so cross-agent tool callbacks can reach the server.

## Further reading

- Day-to-day operations (wake/hibernate, tiers, usage, logs): [runbooks/swarm-operations.md](./runbooks/swarm-operations.md)
- Platform spec (sibling checkout): [`../aura-swarm/docs/spec/v0.2.0/`](../../aura-swarm/docs/spec/v0.2.0/README.md) — start with [`01-system-overview.md`](../../aura-swarm/docs/spec/v0.2.0/01-system-overview.md) and [`10-security.md`](../../aura-swarm/docs/spec/v0.2.0/10-security.md)
