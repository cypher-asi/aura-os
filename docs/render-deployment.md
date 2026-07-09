# Render Deployment — aura-os

Production is split across two Render services: `aura-api` runs the Rust API,
and `aura-app` builds/serves the static interface. Secrets used for provider
calls belong on `aura-api`, never on the static frontend.

## Render Service Setup

| Service | Type | Responsibility |
|---------|------|----------------|
| `aura-api` | Web Service | Builds and runs `aura-os-server` at `https://api.aura.ai` |
| `aura-app` | Static Site | Builds `interface/` and publishes `interface/dist` |

Both services deploy `main`. Keep the actual Render build/start commands in
sync with the corresponding service settings; Render remains the operational
source of truth.

## Environment Variables

### `aura-api` required

| Variable | Value |
|----------|-------|
| `AURA_SERVER_PORT` | `10000` |
| `AURA_SERVER_HOST` | `0.0.0.0` |
| `AURA_SERVER_BASE_URL` | `https://api.aura.ai` |
| `AURA_ROUTER_URL` | `https://aura-router.onrender.com` |
| `Z_BILLING_URL` | `https://z-billing.onrender.com` |
| `BRAVE_SEARCH_PLATFORM_KEY` | Aura's Brave Search subscription key (secret) |

`BRAVE_SEARCH_PLATFORM_KEY` must exist only on `aura-api`. Do not add it to
`aura-app`, any `VITE_*` variable, GitHub Actions desktop secrets, or renderer
configuration.

### `aura-app` required

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://api.aura.ai` |

The static frontend receives only the public API origin. It never calls Brave
directly.

### Optional overrides

| Variable | Value |
|----------|-------|
| `VITE_API_URL` on `aura-api` | Optional fallback for `AURA_SERVER_BASE_URL`; prefer the explicit server variable in the split deployment. |

### Recommended (full functionality)

| Variable | Value |
|----------|-------|
| `AURA_NETWORK_URL` | `https://aura-network.onrender.com` |
| `AURA_STORAGE_URL` | `https://aura-storage.onrender.com` |
| `AURA_INTEGRATIONS_URL` | `https://aura-integrations.onrender.com` |
| `AURA_INTEGRATIONS_INTERNAL_TOKEN` | Must match `INTERNAL_SERVICE_TOKEN` on `aura-integrations` |
| `ORBIT_BASE_URL` | `https://orbit-sfvu.onrender.com` |
| `MIXPANEL_TOKEN` | Mixpanel project token. Enables **server-side** analytics (`session_active` True DAU backstop + share events). The server logs a loud warning at startup if unset. |
| `VITE_MIXPANEL_TOKEN` | Same Mixpanel token, consumed by the Vite build so the **web client** SDK sends engagement events. Without it the browser SDK silently no-ops. |

`X-Subscription-Token` is the HTTP header sent by `aura-api` to Brave. The
server derives it from `BRAVE_SEARCH_PLATFORM_KEY`; it is not another Render
environment variable.

Packaged desktop builds need
`AURA_PLATFORM_TOOL_ACTION_BASE_URL=https://api.aura.ai` as a GitHub
environment/repository variable. This value is public and routes desktop tool
actions to the cloud API; the Brave key remains server-side.

`APP_VERSION` in the build command stamps a real clean version into the bundle so analytics events are not bucketed under `app_version = "0.0.0"` or a `*-dirty` git fallback. `RENDER_GIT_COMMIT` is provided automatically by Render. It is `export`ed (not set inline on `npm run build` only) so both Vite and the analytics validator see it.

Analytics-enabled Vite builds and the `desktop-frontend-assets-validate.mjs --require-analytics` step **fail the build** if `VITE_MIXPANEL_TOKEN` is missing/empty or was not actually inlined into the bundle, or if `APP_VERSION` is empty/`0.0.0`/`*-dirty`. This is the web equivalent of the desktop release guard — a config regression that would silently ship a no-op or mis-versioned web analytics SDK now breaks the deploy loudly instead of going unnoticed. `VITE_MIXPANEL_TOKEN` must be present in the Render service env (above) for it to pass.

> **Apply on the Render dashboard:** add `BRAVE_SEARCH_PLATFORM_KEY` to
> `aura-api`, then redeploy that service. No `aura-app` redeploy is required for
> the secret itself.

### Optional

| Variable | Value |
|----------|-------|
| `REQUIRE_ZERO_PRO` | `true` (default) or `false` |
| `SWARM_BASE_URL` | Swarm gateway URL if using remote agents |
| `LOCAL_HARNESS_URL` | Hosted harness URL when web should support `machine_type: "local"` agents through a separately deployed harness service. Leave unset for remote-only Render deployments. |
| `LOCAL_HARNESS_AUTH_TOKEN` | Shared transport bearer for a hosted harness. Must match that harness service's `AURA_NODE_AUTH_TOKEN`; leave unset unless `LOCAL_HARNESS_URL` points at a protected hosted harness. |

### Hosted local harness

Aura web can run local-agent traffic through a separately deployed harness
service instead of a loopback sidecar. Configure the two services as a pair:

| Service | Variable | Value |
|---------|----------|-------|
| aura-os web service | `LOCAL_HARNESS_URL` | `https://YOUR-HARNESS-SERVICE.onrender.com` |
| aura-os web service | `LOCAL_HARNESS_AUTH_TOKEN` | Shared secret value |
| aura-os web service | `AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN` | `1` |
| aura-os web service | `AURA_REMOTE_ONLY` | unset / `false` when local-agent chat or dev-loop should use the hosted harness |
| harness image service | `AURA_NODE_REQUIRE_AUTH` | `1` |
| harness image service | `AURA_NODE_AUTH_TOKEN` | Same shared secret value |
| harness image service | `AURA_OS_SERVER_URL` | Public aura-os web service URL |

`LOCAL_HARNESS_AUTH_TOKEN` authenticates only the server-to-harness transport.
The signed-in user's JWT still travels inside `RuntimeRequest.auth_jwt`, and
must not be replaced with the harness shared secret.

Do not enable `AURA_REMOTE_ONLY=1` for this mode. Remote-only deployments reject
local-agent chat/dev-loop routes before they reach the hosted local harness.

## Prerequisites

1. **Vendored ZUI** — Aura now vendors `@cypher-asi/zui` under `vendor/zui`, and `interface/package.json` resolves it from inside this repo. Render builds no longer need a sibling checkout or a separately published ZUI package.

2. **Local storage model** — Aura no longer depends on the old embedded C++ database layer. Browser-owned persistence lives in IndexedDB, while the local backend uses a lightweight JSON/runtime store.

## Post-Deploy Verification

```bash
# Health check (should return 401 — no auth)
curl https://api.aura.ai/api/auth/session

# Login
curl -X POST https://api.aura.ai/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"..."}'

# Frontend loads
open https://YOUR-AURA-APP-DOMAIN
```

After signing in, start a chat and ask for current information. Verify the
assistant invokes Web Search without a connect step. Then inspect `aura-api`
logs for a successful Brave response and confirm the browser network request is
to `https://api.aura.ai/api/orgs/.../tool-actions/brave_search_*`, never to
Brave directly.

## Notes

- Port 10000 is Render's default. The server reads `AURA_SERVER_PORT`.
- Host `0.0.0.0` is required — Render rejects `127.0.0.1` bindings.
- `AURA_SERVER_BASE_URL` is the API's own public URL. It is stamped into cross-agent tool endpoints (`send_to_agent`, `spawn_agent`, etc.) so the remote harness / `aura-swarm` can call back in. Without it the server falls back to `http://<AURA_SERVER_HOST>:<AURA_SERVER_PORT>`, and `0.0.0.0` is normalized to `127.0.0.1` — which is unreachable from any other host.
- Keep `aura-api` at one instance with autoscaling disabled while Web Search quotas use the in-process limiter. Adding API instances multiplies the effective allowance, and a deploy/restart resets counters. Move counters to shared storage or z-billing before scaling horizontally or relying on the limits as a strict accounting ledger.
- Render instances still have ephemeral local disk. Browser-owned persisted state remains in the browser, server auth uses the in-memory validation cache, and any local backend compatibility state should be treated as rebuildable.
- The build takes ~2-3 minutes (Node frontend + Rust backend).
- `LOCAL_HARNESS_URL` should NOT be set on Render unless a harness service is deployed alongside and protected with the matching token pair above.

## Troubleshooting

- `external tool callback unreachable: http://127.0.0.1:<port>/...` — `aura-api` is handing remote harnesses a loopback URL. Set `AURA_SERVER_BASE_URL=https://api.aura.ai` on `aura-api` and redeploy.
- `platform web search is not configured` — add `BRAVE_SEARCH_PLATFORM_KEY` to `aura-api`, not `aura-app`, and redeploy `aura-api`.
- Desktop Web Search callback points at loopback — set the GitHub variable `AURA_PLATFORM_TOOL_ACTION_BASE_URL=https://api.aura.ai` and publish a new desktop build. No Brave key belongs in that build.

## Orbit ENOSPC runbook

Symptom: users see repeated push failures whose reason text contains

```
remote: fatal: write error: No space left on device
error: remote unpack failed: index-pack abnormal exit
error: RPC failed; curl 18 transfer closed with outstanding read data remaining
```

This is orbit (`ORBIT_BASE_URL`, typically `https://orbit-sfvu.onrender.com`)
reporting that its local filesystem is full. The aura-os-server classifies
this as `remote_storage_exhausted` (see `classify_push_failure` in
`apps/aura-os-server/src/handlers/dev_loop.rs`) and, starting with the orbit
capacity guard:

1. Trips `OrbitCapacityGuard` for the configured `ORBIT_BASE_URL` so
   retries are annotated with a cooldown window instead of silently piling
   more `tmp_pack_*` objects onto orbit's already-full rootfs.
2. Emits a `push_deferred` + `project_push_stuck` event carrying
   `class: "remote_storage_exhausted"`, a remediation string, and
   `retry_after_secs`. The UI renders a dedicated "Orbit out of disk"
   status (amber dot on the Orbit indicator, banner on the project
   header, and a class-specific row on the task card).

### Diagnosis

```bash
# 1. Confirm the orbit service is live (health endpoint is unauth'd).
curl -s -o /dev/null -w "%{http_code}\n" "$ORBIT_BASE_URL/health"
# Expect 2xx; a timeout or 5xx suggests orbit itself is down, not ENOSPC.

# 2. Inspect orbit's disk usage through the Render dashboard
#    (Service → Metrics → Disk). Note that Render surfaces the
#    *persistent disk* only; pack indexing happens on the ephemeral
#    rootfs so 0% persistent disk usage does NOT mean orbit has space.

# 3. Shell into the orbit service (Render → Shell) and run:
df -h /                          # ephemeral rootfs usage
du -sh /path/to/orbit/repos/*    # per-repo size
find /path/to/orbit/repos -type d -name 'tmp_pack_*' | xargs -r du -sh
```

### Operator action (on the orbit Render service)

1. Remove stale quarantine / `tmp_pack_*` directories left behind by
   earlier failed pushes:

   ```bash
   find /path/to/orbit/repos -type d \
     \( -name 'tmp_pack_*' -o -path '*/objects/incoming-*' \) \
     -mmin +10 -print -exec rm -rf {} +
   ```

2. Run `git gc --prune=now` inside affected repos to drop unreferenced
   loose objects.
3. If disk usage stays high, upgrade the Render plan — the ephemeral
   rootfs scales with instance tier.

Once space is freed, the *next* successful push from aura-os
automatically clears the guard (`git_pushed` handler calls
`OrbitCapacityGuard::clear`) and restores the Orbit indicator to
green.

### Cooldown tuning

The guard's window is controlled by `AURA_ORBIT_ENOSPC_COOLDOWN_SECS`
on the aura-os-server side (default 900s / 15 minutes). Setting it to
`0` disables the cooldown entirely — use only for integration tests
that need to hammer orbit on purpose.
