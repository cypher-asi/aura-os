# Render Deployment — aura-os

Single Web Service that builds both frontend and backend. The backend serves the frontend from `interface/dist` (same as local development).

## Render Service Setup

| Setting | Value |
|---------|-------|
| **Type** | Web Service |
| **Repository** | `cypher-asi/aura-os` |
| **Branch** | `main` |
| **Build Command** | `cd interface && npm ci && npm run build && cd .. && cargo build --release -p aura-os-server` |
| **Start Command** | `./target/release/aura-os-server` |
| **Plan** | Starter ($7/mo) or higher |

## Environment Variables

### Required

| Variable | Value |
|----------|-------|
| `AURA_SERVER_PORT` | `10000` |
| `AURA_SERVER_HOST` | `0.0.0.0` |
| `AURA_SERVER_BASE_URL` | `https://YOUR-SERVICE.onrender.com` |
| `AURA_ROUTER_URL` | `https://aura-router.onrender.com` |
| `Z_BILLING_URL` | `https://z-billing.onrender.com` |

### Recommended (full functionality)

| Variable | Value |
|----------|-------|
| `AURA_NETWORK_URL` | `https://aura-network.onrender.com` |
| `AURA_STORAGE_URL` | `https://aura-storage.onrender.com` |
| `ORBIT_BASE_URL` | `https://orbit-sfvu.onrender.com` |
| `INTERNAL_SERVICE_TOKEN` | (same value as other services) |

### Optional

| Variable | Value |
|----------|-------|
| `REQUIRE_ZERO_PRO` | `true` (default) or `false` |
| `SWARM_BASE_URL` | Swarm gateway URL if using remote agents |
| `LOCAL_HARNESS_URL` | Harness URL (not needed on Render — no local harness) |

## Prerequisites

1. **Vendored ZUI** — Aura now vendors `@cypher-asi/zui` under `vendor/zui`, and `interface/package.json` resolves it from inside this repo. Render builds no longer need a sibling checkout or a separately published ZUI package.

2. **Local storage model** — Aura no longer depends on the old embedded C++ database layer. Browser-owned persistence lives in IndexedDB, while the local backend uses a lightweight JSON/runtime store.

## Post-Deploy Verification

```bash
# Health check (should return 401 — no auth)
curl https://YOUR-SERVICE.onrender.com/api/auth/session

# Login
curl -X POST https://YOUR-SERVICE.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"..."}'

# Frontend loads
open https://YOUR-SERVICE.onrender.com
```

## Notes

- Port 10000 is Render's default. The server reads `AURA_SERVER_PORT`.
- Host `0.0.0.0` is required — Render rejects `127.0.0.1` bindings.
- `AURA_SERVER_BASE_URL` is the server's own public URL. It's stamped into cross-agent tool endpoints (`send_to_agent`, `spawn_agent`, etc.) so the remote harness / `aura-swarm` can call back in. Without it the server falls back to `http://<AURA_SERVER_HOST>:<AURA_SERVER_PORT>`, and `0.0.0.0` is normalized to `127.0.0.1` — which is unreachable from any other host.
- Render instances still have ephemeral local disk. Browser-owned persisted state remains in the browser, server auth uses the in-memory validation cache, and any local backend compatibility state should be treated as rebuildable.
- The build takes ~2-3 minutes (Node frontend + Rust backend).
- `LOCAL_HARNESS_URL` should NOT be set on Render unless a harness service is deployed alongside.

## Troubleshooting

- `external tool callback unreachable: http://127.0.0.1:<port>/api/agent_tools/...` — the server is handing remote harnesses a loopback URL because `AURA_SERVER_BASE_URL` is not set. Set it to the service's public https URL (e.g. `https://YOUR-SERVICE.onrender.com`) and redeploy.
