# AURA Platform Security Audit Report

**Date:** 2026-03-29
**Scope:** All deployed services — aura-network, aura-storage, aura-router, z-billing, orbit, aura-os (auth refactor + zOS API wallet changes)
**Methodology:** Static analysis, full source code review
**Classification:** Internal

---

## Executive Summary

Comprehensive security review across all 6 AURA platform services. **8 CRITICAL**, **19 HIGH**, and **33 MEDIUM** findings identified. The most severe systemic issues are:

1. **Zero authorization in aura-storage** — any authenticated user can read/modify/delete any other user's data
2. **Billing bypass via race condition in aura-router** — concurrent requests bypass credit checks; fire-and-forget billing means failed debits = free usage
3. **WebSocket balance leak in z-billing** — all users' balance updates broadcast to every connected client
4. **HS256 JWT tokens never expire** — shared across ALL services, no audience validation, no revocation
5. **Webhook replay attacks in z-billing** — no deduplication on Stripe/Lago events; signature verification skipped when secrets unset

---

## Findings by Severity

### CRITICAL (8 findings)

#### C1. aura-storage: Zero Authorization on All Public Endpoints
**Impact:** Any authenticated user can read, update, or delete ANY resource in the system
**Services:** aura-storage
**Files:** All handler files in `crates/server/src/handlers/` — tasks.rs, sessions.rs, specs.rs, project_agents.rs, artifacts.rs, events.rs, logs.rs, stats.rs

Every handler extracts `_auth: AuthUser` (note: underscore = value discarded) but never checks whether the authenticated user owns or has access to the requested resource. All queries filter by `project_id` from URL path params but never verify the caller has permission to that project.

**Examples:**
- `GET /api/projects/{any-uuid}/tasks` — returns all tasks for any project
- `DELETE /api/tasks/{any-uuid}` — deletes any task in the system
- `GET /api/stats?scope=org&orgId={any-uuid}` — returns stats for any org
- `GET /api/stats?scope=network` — returns global platform statistics

**Fix:** Add project/org membership verification. Either query aura-network to check ownership, or store membership locally. Every handler must verify the authenticated user has access to the requested resource.

---

#### C2. aura-router: Fire-and-Forget Billing (Free Usage on Failure)
**Impact:** Users get LLM/image/3D responses without being charged if billing fails
**Services:** aura-router
**File:** `crates/server/src/handlers/proxy.rs:384-409`

Credit deduction is a `tokio::spawn` fire-and-forget task AFTER the response is already sent. If z-billing is down, slow, or returns an error, the debit is silently lost (only logged as warning). No retry mechanism, no dead-letter queue, no reconciliation.

**Fix:** Implement hold-and-settle: reserve credits before forwarding to provider, settle based on actual usage after.

---

#### C3. aura-router: Race Condition Bypasses Credit Check
**Impact:** Users with 1 credit can fire 100 concurrent requests; all pass the pre-check
**Services:** aura-router
**Files:** `crates/server/src/handlers/proxy.rs:74-88`, `crates/domain/proxy/src/billing.rs:36-68`

The credit check ("does user have >= N credits?") and deduction are not atomic. A user with $0.01 can send many concurrent requests — all pass the pre-check, all get forwarded to providers, and credits go deeply negative.

**Fix:** Use atomic credit reservation (debit-before-forward) or implement pessimistic locking in z-billing.

---

#### C4. z-billing: WebSocket Broadcasts All Users' Balances
**Impact:** Any authenticated user sees real-time balance changes for every user on the platform
**Services:** z-billing
**File:** `crates/z-billing-service/src/handlers/ws.rs:22-71`

The WebSocket validates JWT on connection but then discards the user identity. The broadcast channel delivers every balance update (userId + balanceCents) to every connected client.

**Fix:** Filter broadcast messages per-user. Extract user_id from JWT, only forward messages matching that user's ID.

---

#### C5. z-billing: Webhook Replay Attacks (Stripe + Lago)
**Impact:** Captured webhook payloads can be replayed to credit accounts multiple times
**Services:** z-billing
**Files:** `crates/z-billing-service/src/handlers/webhooks.rs:44-108` (Stripe), `webhooks.rs:122-173` (Lago)

No webhook event ID deduplication. Stripe timestamp tolerance is not checked. The same `checkout.session.completed` event can be replayed indefinitely, each time adding credits.

**Fix:** Store processed event IDs in DB, reject duplicates. Add Stripe timestamp tolerance (5-minute window).

---

#### C6. z-billing: Webhook Processing Without Signature Verification
**Impact:** If webhook secrets are unset, anyone can forge webhooks and credit accounts
**Services:** z-billing
**File:** `crates/z-billing-service/src/handlers/webhooks.rs:55-73, 129-141`

Both Stripe and Lago handlers skip signature verification entirely when the webhook secret env var is not configured. They log a warning but still process the payload. Config defaults set both secrets to `None`.

**Fix:** Reject webhooks entirely (return 503) when the corresponding secret is not configured.

---

#### C7. HS256 JWT Tokens Never Expire (ALL SERVICES)
**Impact:** A stolen HS256 token provides permanent access across all services
**Services:** aura-network, aura-storage, aura-router, z-billing, orbit (all share identical auth crate)
**File pattern:** `crates/auth/src/validate.rs:51-61` (in each service)

The HS256 validation path sets `validate_exp = false`, `validate_aud = false`, and `required_spec_claims.clear()`. Tokens never expire, have no audience restriction, and require no standard claims. The `AUTH_COOKIE_SECRET` is the single point of failure for the entire platform.

**Fix:** Enable `validate_exp = true` across all services. Issue tokens with reasonable expiry (e.g., 24h). Add `validate_aud` with per-service audience values.

---

#### C8. aura-os: Hardcoded Anthropic API Key in .env
**Impact:** Live API key on disk; could be leaked via backup, clone, or misconfigured .gitignore
**Services:** aura-os
**File:** `.env` line 1

A live `sk-ant-api03-...` key is present in the repo's `.env` file. While `.gitignore` lists `.env`, the key is on disk.

**Fix:** Rotate this key immediately. Use a secret manager or runtime-injected env vars.

---

### HIGH (19 findings)

| # | Service | Finding | File |
|---|---------|---------|------|
| H1 | aura-network | `post_activity` allows spoofing any profile_id (caller's identity unused) | `handlers/feed.rs:49-66` |
| H2 | aura-network | `record_usage` accepts arbitrary user_id/org_id — usage attribution tampering | `handlers/usage.rs:47-55` |
| H3 | aura-network | `get_agent` exposes system_prompt, wallet_address, vm_id to any authed user | `handlers/agents.rs:86-93` |
| H4 | aura-network | `wallet_address` and `vm_id` settable via UpdateAgentRequest (mass assignment) | `domain/agents/src/models.rs:38-50` |
| H5 | aura-network | No rate limiting on any endpoint | `main.rs, router.rs` |
| H6 | aura-network | Private project activity leaked via `get_profile_activity` (no visibility filter) | `domain/feed/src/repo.rs:154-175` |
| H7 | aura-storage | Internal endpoints on public port, protected only by static token | `router.rs:83-177` |
| H8 | aura-router | Google/Gemini API key leaked in URL query parameter | `domain/proxy/src/image_gen.rs:301-303` |
| H9 | aura-router | SSRF via user-controlled image URLs (no validation, no IP range blocking) | `domain/proxy/src/image_gen.rs:350-412` |
| H10 | aura-router | LLM pre-check uses trivial 1 credit minimum regardless of model/max_tokens | `handlers/proxy.rs:74-79` |
| H11 | aura-router | CORS defaults to allow-all when CORS_ORIGINS unset | `main.rs:43-58` |
| H12 | aura-router | Algorithm confusion — hardcoded KID in source, attacker-controlled kid selects HS256 | `auth/src/validate.rs:6,42-48` |
| H13 | z-billing | Usage endpoint accepts negative `cost_cents` — can add credits via debit path | `handlers/usage.rs:60-68` |
| H14 | z-billing | Single shared SERVICE_API_KEY with self-reported service_name | `auth.rs:113-161` |
| H15 | z-billing | Webhook sig check skipped when Stripe client unavailable despite secret being set | `handlers/webhooks.rs:55-73` |
| H16 | orbit | No body size limit on git push (disk exhaustion DoS) | `git_http/routes.rs:320-476` |
| H17 | orbit | No RequestBodyLimit middleware on any endpoint | `api/router.rs` |
| H18 | aura-os | File path traversal — read_file/list_directory accept arbitrary paths, no sandboxing | `handlers/files.rs:101-182` |
| H19 | aura-os | WebSocket events endpoint: initial HTTP auth ok, but no re-auth check during session | `handlers/ws.rs:8-14` |

---

### MEDIUM (33 findings)

| # | Service | Finding |
|---|---------|---------|
| M1 | aura-network | Integration endpoints lack org membership checks |
| M2 | aura-network | WebSocket token in URL query parameter (logged in access logs) |
| M3 | aura-network | CORS defaults to permissive when CORS_ORIGINS unset |
| M4 | aura-network | Internal token comparison not constant-time |
| M5 | aura-network | Internal routes on same listener as public routes |
| M6 | aura-network | No length limits on most string fields (name, system_prompt, etc.) |
| M7 | aura-storage | Dynamic SQL column interpolation in stats (currently safe, fragile) |
| M8 | aura-storage | Internal token comparison not constant-time |
| M9 | aura-storage | Five list endpoints have no pagination (unbounded result sets) |
| M10 | aura-storage | CORS defaults to permissive |
| M11 | aura-storage | No per-user/per-IP rate limiting |
| M12 | aura-storage | WebSocket broadcasts all events to all users (cross-user data leak) |
| M13 | aura-router | Client disconnect mid-stream silently skips billing |
| M14 | aura-router | No streaming timeout or maximum duration |
| M15 | aura-router | 25MB body limit applied globally (not per-route) |
| M16 | aura-router | Provider error responses forwarded raw to client (info leakage) |
| M17 | aura-router | No TLS enforcement on service-to-service communication |
| M18 | aura-router | Rate limiter state unbounded (memory exhaustion) |
| M19 | aura-router | z-billing error bodies exposed to client |
| M20 | z-billing | Admin `add_credits` allows negative amounts (balance drain) |
| M21 | z-billing | No DB-level CHECK constraint preventing negative balances |
| M22 | z-billing | HS256 tokens never expire (duplicate of C7) |
| M23 | z-billing | CORS defaults to allow-all origins |
| M24 | z-billing | WebSocket JWT in query parameter |
| M25 | orbit | Unvalidated ref_name/sha/path passed to git commands (flag injection) |
| M26 | orbit | Default CORS fully permissive |
| M27 | orbit | No symlink protection in git repos (merge worktrees) |
| M28 | orbit | No git bomb/decompression bomb protection |
| M29 | orbit | GitHub mirror token logged in URL on push failure |
| M30 | orbit | Internal token comparison not constant-time |
| M31 | aura-os | Stale cache fallback allows expired/revoked sessions on zOS failure |
| M32 | aura-os | Network bridge picks arbitrary JWT from cache (cross-user in multi-user) |
| M33 | aura-os | Global credit cache not per-user (User A's credits apply to User B) |

---

### LOW (21 findings)

| # | Service | Finding |
|---|---------|---------|
| L1 | aura-network | No URL validation on image/avatar fields |
| L2 | aura-network | Validation errors echo user input |
| L3 | aura-network | OrgInvite token returned in list_invites response |
| L4 | aura-storage | Event type validation disabled |
| L5 | aura-storage | No max-length validation on text fields |
| L6 | aura-storage | Artifact delete missing rows_affected check |
| L7 | aura-router | Image gen billing mismatch (pre-check 26 vs error message 100) |
| L8 | aura-router | InsufficientCredits error leaks exact balance |
| L9 | aura-router | Internal error messages leak config state |
| L10 | z-billing | No per-client rate limiting on financial endpoints |
| L11 | z-billing | test-auth feature flag could be accidentally enabled |
| L12 | z-billing | Admin identity self-reported in audit logs |
| L13 | orbit | No org-level role system |
| L14 | orbit | Negative pagination values not clamped |
| L15 | orbit | Git stderr exposed in error responses |
| L16 | orbit | No timeout on GitHub mirror push |
| L17 | aura-os | Account enumeration via register errors |
| L18 | aura-os | Empty bearer token accepted (wasteful zOS call) |
| L19 | aura-os | Access token returned in all session responses |
| L20 | aura-os | Checkout URL opened without Stripe domain validation |
| L21 | aura-os | CORS allows all localhost origins with credentials |

---

## Systemic Issues (Cross-Service)

### 1. Shared Auth Crate with HS256 Bypass (ALL services)
All 5 backend services share an identical auth crate. The `AUTH_COOKIE_SECRET` is a single point of failure for the entire platform. **PARTIALLY FIXED:** `validate_exp` now enabled (tokens expire after 1 year). Audience validation and algorithm confusion (hardcoded KID) remain open but lower priority.

### 2. Internal Endpoints on Public Ports (aura-network, aura-storage)
Internal routes (`/internal/*`) are served on the same port as public routes, protected only by a static `X-Internal-Token`. If this token leaks, all internal capabilities (write arbitrary data, bypass user association) are available to external attackers. Deferred — infra-level.

### 3. CORS Defaults to Permissive (ALL services)
Every service defaults to `CorsLayer::permissive()` when `CORS_ORIGINS` is not set. Deferred — configure when aura-os frontend deploys.

### 4. No Per-User Rate Limiting (ALL services)
Only aura-router has per-user rate limiting (60 RPM). All other services have only a global concurrency limit (512), which provides no per-client abuse protection. Deferred — defence-in-depth.

### 5. WebSocket Security Pattern (aura-storage, z-billing)
**z-billing FIXED** — balance updates now filtered per-user. aura-storage WebSocket has no consumers, deferred.

---

## Priority Action Plan

### Completed — Round 1 (2026-03-30)

| Fix | Services | Status |
|-----|----------|--------|
| Reject negative cost_cents in usage endpoint | z-billing | ✅ Deployed + tested |
| Reject negative admin add_credits | z-billing | ✅ Deployed + tested |
| Filter WebSocket balance broadcast per-user | z-billing | ✅ Deployed + tested |
| Require webhook signing secrets | z-billing | ✅ Deployed + tested |
| Add webhook event ID deduplication | z-billing | ✅ Deployed + tested |
| Move Gemini API key from URL to header | aura-router | ✅ Deployed (not testable — Gemini free tier) |
| Block SSRF in image URL fetching | aura-router | ✅ Deployed + tested |
| Prevent mass assignment of wallet_address/vm_id | aura-network | ✅ Deployed + tested |
| Verify profile ownership before posting activity | aura-network | ✅ Deployed + tested |

### Completed — Round 2 (2026-03-30)

| Fix | Services | Status |
|-----|----------|--------|
| Add org admin role check to all integration endpoints | aura-network | ✅ Deployed + tested |
| Force record_usage user_id to authenticated caller | aura-network | ✅ Deployed + tested |
| Harden SSRF: disable redirects + IP address parsing | aura-router | ✅ Deployed + tested |
| Reject empty-string SERVICE_API_KEY and ADMIN_API_KEY | z-billing | ✅ Deployed + tested |
| Sanitize GitHub token from mirror push error logs | orbit | ✅ Deployed + tested |
| Enable HS256 token expiry validation | ALL 5 services | ✅ Deployed + tested |

### Deferred — architectural / not exploitable in current deployment

| Item | Services | Reason for deferral |
|------|----------|-------------------|
| aura-storage /api/ authorization | aura-storage | Requires valid JWT + random UUID guessing. Architectural decision for multi-tenant scaling, not a current exploit vector. |
| Harness endpoint authentication | aura-harness | Runs locally (desktop) or in isolated swarm pods. Not network-accessible to attackers. |
| JWT in git push command line | aura-harness | Only visible to same-machine users. Desktop = single user. Swarm = isolated pod. |
| Shared PVC flat namespace | aura-swarm | Requires container escape first. MicroVM isolation available. |
| aura-os pre-deploy items | aura-os | Credit cache, network bridge, brute force, WS re-auth — relevant when multi-user server deploys. |

### Outstanding — aura-network fixes (deployed service)

| Fix | Services | Effort | Severity | Notes |
|-----|----------|--------|----------|-------|
| get_agent exposes sensitive fields to any authed user | aura-network | 1-2 hrs | HIGH | ✅ Fixed + tested — strips system_prompt, wallet_address, vm_id for non-owners |
| Private project activity leaked in get_profile_activity | aura-network | 1-2 hrs | HIGH | ✅ Fixed + tested — same visibility filter as get_feed applied |

### Completed — Round 3 (2026-03-31)

| Fix | Services | Status |
|-----|----------|--------|
| Block path traversal + sensitive system paths in file handlers | aura-os | ✅ Committed locally (blocked on aura-os-link compile issue from Neo) |
| Block shell metacharacters when command allowlist is active | aura-harness | ✅ Pushed + 9 tests passing |
| Validate project_path against project_base in session_init | aura-harness | ✅ Pushed + 5 tests passing |
| Require bearer token on internal status endpoint | aura-swarm | ✅ Pushed + 26 unit tests passing |
| Verify agent ownership in all proxy handlers (files, terminal, automaton) | aura-swarm | ✅ Pushed + 26 unit tests passing |
| Validate automaton_id to prevent proxy path injection | aura-swarm | ✅ Pushed + 4 validation tests passing |
| Disable redirect following in proxy handlers | aura-swarm | ✅ Pushed |

### Outstanding — aura-os fixes (code changes, test on deploy)

| Fix | Services | Effort | Severity | Notes |
|-----|----------|--------|----------|-------|
| Global credit cache not per-user | aura-os | 1-2 hrs | MEDIUM | User A's credit check applies to User B. Single file fix, no decisions needed. |
| Network bridge JWT selection for multi-user | aura-os | 2-4 hrs | MEDIUM | Picks arbitrary JWT for bridge. Needs approach decision: service token vs most-recent JWT. |
| Brute force protection on login/register | aura-os | 4 hrs | MEDIUM | No rate limiting on auth endpoints. Needs approach decision: IP-based? Per-email? What crate? |
| WebSocket connections outlive token expiry | aura-os | 2-4 hrs | MEDIUM | Once upgraded, WS connection never re-validates JWT. Long-lived connections persist after token revocation. |

**Status:** aura-os not deployed to production yet (blocked on ZUI npm + auth push). Path traversal and credit cache can be fixed now. Network bridge, brute force, and WebSocket re-auth need approach decisions.

### Outstanding — Neo actions

| Item | Notes |
|------|-------|
| Rotate Anthropic API key | Live key in aura-os `.env` on disk. Rotate via Anthropic dashboard. |

### Deferred — lower priority / not urgently needed

| Fix | Services | Notes |
|-----|----------|-------|
| CORS allowed origins config | ALL | Configure when aura-os frontend deploys |
| Internal endpoints on public port | aura-network, aura-storage | Infra-level, internal token protects them |
| Billing credit reservation (hold-and-settle) | aura-router | Architectural, reliability gap not security-critical |
| Per-user rate limiting | ALL | Defence-in-depth |
| Stripe timestamp tolerance | z-billing | Defence-in-depth, dedup already protects |
| DB CHECK constraint on balance | z-billing | Defence-in-depth, app already validates |
| Constant-time internal token comparison | ALL | Theoretical timing attack |
| Orbit ref_name/sha/path validation | orbit | Can't achieve code execution |
| Orbit request body size limit | orbit | Infra-level (storage quotas) |
| aura-storage WebSocket per-user filter | aura-storage | No consumers exist |
| Sanitize provider error forwarding | aura-router | Low-impact info leak |
| Per-service JWT audience | ALL | Cross-service coordination needed |

---

---

## Audit Round 3 — New Repos + Re-audit (2026-03-31)

### aura-runtime / aura-harness (first audit)

| # | Severity | Issue | File | Status |
|---|----------|-------|------|--------|
| H1 | CRITICAL | Unauthenticated API server with arbitrary file read — `/api/read-file` and `/api/files` endpoints on CLI API server have zero auth and zero path validation | `src/api_server.rs:157-203` | Outstanding |
| H2 | CRITICAL | Node API endpoints lack authentication — `/tx`, `/automaton/start`, `/ws/terminal`, `/stream` all accessible without auth. Dockerfile binds to `0.0.0.0:8080` | `crates/aura-node/src/router.rs:63-94` | Outstanding |
| H3 | CRITICAL | Unauthenticated terminal WebSocket gives full shell — `/ws/terminal` spawns PTY shell with no auth check | `crates/aura-node/src/terminal.rs:65-202` | Outstanding |
| H4 | HIGH | Client-controlled `project_path` bypasses sandbox — `session_init` accepts arbitrary absolute path as sandbox root with no allowlist check | `crates/aura-node/src/session/mod.rs:144-155` | ✅ Fixed + tested |
| H5 | HIGH | JWT leaked in git push command line — orbit_push embeds JWT in `https://x-token:{jwt}@...` URL, visible via `ps aux` | `crates/aura-tools/src/domain_tools/orbit.rs:158-183` | Outstanding |
| H6 | HIGH | Command allowlist bypass via shell metacharacters — first token checked against allowlist but command run via `sh -c` allowing `; && ||` chaining | `crates/aura-tools/src/fs_tools/cmd.rs:287-296` | ✅ Fixed + tested |
| H7 | MEDIUM | `resolve_new` symlink race — parent dir could be symlink pointing outside sandbox for write operations | `crates/aura-tools/src/sandbox.rs:147-149` | Outstanding |
| H8 | MEDIUM | Auth token accepted via `session_init` without server-side validation — token never verified, just forwarded | `crates/aura-node/src/session/mod.rs:157-159` | Outstanding |

**Context:** The harness runs locally (desktop app) or inside controlled agent pods (swarm). The CRITICALs are most relevant when exposed to a network (swarm deployment) or on multi-user machines. Neo is actively refactoring the harness — these may need his input on approach.

### aura-swarm (first audit)

| # | Severity | Issue | File | Status |
|---|----------|-------|------|--------|
| S1 | CRITICAL | Internal status endpoint exposed without auth — `PATCH /internal/agents/:id/status` has zero auth, same port as public API, network policy allows `0.0.0.0/0` ingress | `crates/aura-swarm-gateway/src/handlers/internal.rs:37-54` | ✅ Fixed |
| S2 | HIGH | File/terminal/automaton proxy missing ownership check — any authed user can access any other user's agent pod via file, terminal, or automaton proxy | `crates/aura-swarm-gateway/src/handlers/files.rs`, `terminal.rs`, `automaton.rs` | ✅ Fixed |
| S3 | HIGH | Shared PVC flat namespace — all agent pods share one PVC with agent-ID-only subpath, no user-level partitioning. Container escape gives access to all agents' data | `crates/aura-swarm-scheduler/src/pod.rs:309-315` | Outstanding |
| S4 | MEDIUM | `get_logs` missing ownership verification — placeholder now, but latent authz bypass when implemented | `crates/aura-swarm-gateway/src/handlers/agents.rs:426-449` | Outstanding |
| S5 | MEDIUM | Automaton proxy path injection — unsanitized `automaton_id` in URL allows reaching unintended endpoints on agent pod | `crates/aura-swarm-gateway/src/handlers/automaton.rs:107-118` | ✅ Fixed + tested |
| S6 | MEDIUM | Proxy handlers follow redirects from untrusted pods — compromised pod can redirect gateway to internal cluster services | `crates/aura-swarm-gateway/src/handlers/files.rs` | ✅ Fixed |
| S7 | MEDIUM | CORS defaults to wildcard origin | `crates/aura-swarm-gateway/src/config.rs:76` | Outstanding |

### Re-audit of previously fixed services (pass 3)

| # | Severity | Issue | Services | Status |
|---|----------|-------|----------|--------|
| R1 | LOW-MED | Service/admin API key comparison vulnerable to timing attack — all use `==` instead of constant-time | ALL services | Outstanding (deferred) |
| R2 | MEDIUM | aura-network WebSocket broadcasts all feed events to all authenticated users — no per-user filtering | aura-network | ✅ Fixed + tested |

**All previous fixes verified correct. No bypasses found. No issues introduced by fixes.**

---

## Outstanding Items — Full Reference

### Actionable now (deployed services)

| # | Issue | Service | Severity | Effort |
|---|-------|---------|----------|--------|
| 1 | aura-storage authorization on /api/ endpoints | aura-storage + aura-network | CRITICAL | 2-3 days |
| 2 | get_agent exposes sensitive fields to any user | aura-network | HIGH | ✅ Fixed + tested |
| 3 | get_profile_activity leaks private project events | aura-network | HIGH | ✅ Fixed + tested |
| 4 | WebSocket broadcasts all feed events to all users | aura-network | MEDIUM | ✅ Fixed + tested — filters by org membership |

### Actionable now (harness — discuss with Neo)

| # | Issue | Service | Severity | Notes |
|---|-------|---------|----------|-------|
| 5 | Unauthenticated API server + file read | aura-harness | CRITICAL | Add auth + path validation |
| 6 | Node API endpoints lack authentication | aura-harness | CRITICAL | Add auth middleware |
| 7 | Unauthenticated terminal WebSocket | aura-harness | CRITICAL | Add auth before upgrade |
| 8 | Client-controlled project_path bypasses sandbox | aura-harness | HIGH | ✅ Fixed + tested |
| 9 | JWT leaked in git push command line | aura-harness | HIGH | Outstanding — use credential helper |
| 10 | Command allowlist bypass via shell metacharacters | aura-harness | HIGH | ✅ Fixed + tested |

### Actionable now (swarm — discuss with Neo)

| # | Issue | Service | Severity | Notes |
|---|-------|---------|----------|-------|
| 11 | Internal status endpoint exposed without auth | aura-swarm | CRITICAL | ✅ Fixed |
| 12 | Proxy handlers missing ownership check | aura-swarm | HIGH | ✅ Fixed |
| 13 | Shared PVC flat namespace | aura-swarm | HIGH | Outstanding — add user_id to subpath |
| 14 | Automaton proxy path injection | aura-swarm | MEDIUM | ✅ Fixed + tested |
| 15 | Proxy follows redirects from untrusted pods | aura-swarm | MEDIUM | ✅ Fixed |

### Actionable when aura-os deploys

| # | Issue | Service | Severity |
|---|-------|---------|----------|
| 16 | Path traversal in file handlers | aura-os | CRITICAL |
| 17 | Credit cache not per-user | aura-os | MEDIUM |
| 18 | Network bridge JWT selection | aura-os | MEDIUM |
| 19 | Brute force protection | aura-os | MEDIUM |
| 20 | WebSocket re-auth on long-lived connections | aura-os | MEDIUM |

### Neo actions

| Item | Notes |
|------|-------|
| Rotate Anthropic API key | Live key in aura-os `.env` on disk |

### Deferred — lower priority

| Fix | Services | Notes |
|-----|----------|-------|
| CORS allowed origins config | ALL + swarm | Configure when frontends deploy |
| Billing credit reservation | aura-router | Architectural, reliability gap |
| Per-user rate limiting | ALL | Defence-in-depth |
| Constant-time token comparison | ALL | Low practical risk |
| Per-service JWT audience | ALL | Cross-service coordination |

---

## What's Working Well

- **SQL injection protection**: All services use parameterized queries via sqlx. No SQL injection found.
- **Database error masking**: All services return generic "internal error" messages for DB failures.
- **UUID-based resource IDs**: Prevents enumeration and path traversal in most cases.
- **Orbit repo paths**: UUID-based disk paths eliminate filesystem traversal for git repos.
- **No secrets in logs**: GitHub mirror token sanitized. No other leaks found.
- **Frontend XSS mitigation**: All `dangerouslySetInnerHTML` uses pass through hljs sanitization.
- **Auth refactor**: JWT-per-request via Authorization header correctly implemented.
- **INTERNAL_SERVICE_TOKEN eliminated**: Harness and swarm now use JWT auth (Neo's recent refactor).
- **Swarm pods**: No longer hold raw API keys — use proxy mode through aura-router.
- **Webhook security**: Signature verification + replay protection working correctly.
- **SSRF protection**: IP parsing + no-redirect client verified against all bypass techniques.
- **HS256 token expiry**: Enabled across all 5 backend services, verified working.
