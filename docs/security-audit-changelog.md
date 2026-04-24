# Security Audit Changelog (2026-03-29/30)

Tracks every change made during the security audit. Each entry notes:
- What changed and why
- Whether it could break existing behavior
- What to test on deploy

---

## z-billing

### Commit: ce48e48 — validate billing inputs + filter WebSocket per-user

**1. usage.rs: Reject cost_cents < 0 in report_usage and process_single_usage**
- Why: Negative cost_cents would add credits via the debit path
- Originally used `<= 0` but fixed in c2ddd69 to `< 0` because `calculate_llm_cost` can legitimately return 0 when both input_tokens and output_tokens are 0 (e.g. immediate client disconnect)
- Breaking? No — no legitimate caller sends negative costs. Zero costs pass through harmlessly.
- Test: Send a usage event with cost_cents=-100, verify 400 response. Send cost_cents=0, verify it passes. Send normal usage, verify still works.

**2. credits.rs: Reject amount_cents <= 0 in admin_add_credits**
- Why: Negative amounts would drain user balances
- Breaking? No — admin endpoint, no legitimate use for negative credits.
- Test: Call admin add_credits with amount_cents=-100, verify 400. Positive amount still works.

**3. ws.rs: Filter WebSocket balance updates per-user**
- Why: Was broadcasting ALL users' balance updates to every connected client
- Breaking? **Behavioral change** — clients that previously received all updates now only receive their own. This is the correct/intended behavior. If any admin dashboard relied on seeing all updates, it would need a separate endpoint.
- Test: Connect two users to /ws/balance, trigger a debit for user A, verify only user A receives the update. Verify user B does not.

### Commit: f665edb — webhook signature enforcement + replay protection

**4. webhooks.rs: Reject Stripe webhooks when STRIPE_WEBHOOK_SECRET is not set**
- Why: Was silently processing unsigned payloads (anyone could forge webhooks)
- Breaking? **Yes if secrets are not configured in production.** If STRIPE_WEBHOOK_SECRET env var is missing, Stripe webhooks will return 500 instead of processing. Must ensure env var is set before deploying.
- **ACTION REQUIRED**: Confirm with Neo that STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET are set in production z-billing. If Stripe integration is not active yet, the webhook routes simply won't be hit, so no issue.
- Test: Verify STRIPE_WEBHOOK_SECRET is set in prod. Send a valid Stripe webhook, verify it processes. Remove the secret, verify 500.

**5. webhooks.rs: Reject Stripe webhooks when Stripe client is not configured**
- Why: Signature check was skipped when client was unavailable
- Breaking? Same as above — requires STRIPE_API_KEY to be set for Stripe client to initialize.
- Test: Covered by above.

**6. webhooks.rs: Reject Lago webhooks when LAGO_WEBHOOK_SECRET is not set**
- Why: Same as Stripe — was processing unsigned Lago webhooks
- Breaking? Same pattern — requires LAGO_WEBHOOK_SECRET env var.
- **ACTION REQUIRED**: Confirm with Neo that LAGO_WEBHOOK_SECRET is set in production if Lago webhooks are active. If Lago is not active, no issue.
- Test: Verify env var is set in prod.

**7. webhooks.rs: Add Stripe webhook event ID deduplication**
- Why: Same webhook could be replayed to credit accounts multiple times
- Breaking? No — first delivery processes normally, only replays are rejected (returns 200 with received:true). Requires 0002_create_processed_webhooks migration to be run.
- Test: Send same Stripe webhook twice, verify credits only added once. Check processed_webhooks table has the event_id.

**8. webhooks.rs: Add Lago webhook deduplication (composite key)**
- Why: Same as Stripe replay issue
- Breaking? No — same pattern. Dedup key is `lago:{webhook_type}:{lago_id}`.
- Test: Same as Stripe.

**9. Store trait + PgStore + RocksStore: has_webhook_event / record_webhook_event**
- Why: Backend for dedup above
- Breaking? No — additive only. New trait methods, new table.
- Deploy note: Run migration `0002_create_processed_webhooks.sql` BEFORE deploying new code.

### Commit: 59a68b3 — Cargo.lock update
- No behavioral changes.

---

## aura-router

### Commit: cb96f8e — move Gemini API key to header

**10. image_gen.rs: Use x-goog-api-key header instead of ?key= query param**
- Why: API keys in URLs are logged by proxies and CDNs
- Breaking? No — Google's Generative AI API accepts both query param and header auth. The `x-goog-api-key` header is their documented preferred method.
- Test: Generate an image via Gemini, verify it still works with the header auth.

---

## aura-network

### Commit: 6d3767e — prevent agent mass assignment

**11. models.rs: Add #[serde(skip_deserializing)] to wallet_address and vm_id on UpdateAgentRequest**
- Why: Users could set wallet_address to redirect agent funds to their own address
- Breaking? **Possible if any frontend/caller sets wallet_address via the public API.** The server-side code (agent creation handler) still sets it via Rust struct construction (not deserialization), so that path is unaffected. The aura-os frontend does not send wallet_address in update requests.
- Test: Create an agent, verify wallet is auto-created. Update agent name, verify wallet_address unchanged. Try to send wallet_address in update body, verify it's ignored.

### Commit: 291d5e5 — cargo fmt
- No behavioral changes. Purely formatting.

### Commit: 9d75d6a — block SSRF in image URL fetching

**13. image_gen.rs: Add validate_fetch_url() to block private IPs and non-HTTP schemes**
- Why: Users could supply URLs like http://169.254.169.254/latest/meta-data/ to probe cloud metadata or internal services
- Breaking? No — only blocks private/internal IPs and non-HTTP schemes. Legitimate image URLs (S3, CDNs, public hosts) are unaffected. Data URLs bypass validation entirely.
- Test: Generate an image with iteration using a public image URL, verify it works. Try with http://169.254.169.254/, verify it's rejected. Try with http://localhost:3000/, verify rejected.

---

## Pending / In Progress

### Commit: dc7c6b2 — verify profile ownership before posting activity

**12. feed.rs: Add verify_profile_ownership check to post_activity**
- Why: Any authenticated user could post activity as any other user/agent profile by supplying an arbitrary profile_id
- Approach: SQL query checks if profile_id belongs to either (a) the caller's user profile or (b) an agent profile where the agent is owned by the caller. Returns 403 if not.
- Initial approach (simple override) was reverted after finding the harness sends agent profile_ids with the user's JWT — override would have broken agent-authored posts.
- Breaking? No — harness injects the session user's JWT, and agent profiles are owned by the session user. All legitimate callers pass the ownership check.
- Callers verified: aura-harness post_to_feed (sends agent profile_id + user JWT ✅), aura-code BFF (doesn't send profileId — already broken before our change), frontend (goes through BFF)
- Test: Post as own profile → 200 ✅, post as own agent → 200 ✅, post as other user → 403 ✅, post as fake UUID → 403 ✅

---

## Deploy + Test Results (2026-03-30)

All three repos pushed and deployed to Render production. All tests passing.

- [x] Run migration 0002_create_processed_webhooks.sql — auto-ran on z-billing startup
- [x] Verify STRIPE_WEBHOOK_SECRET env var is set — confirmed in Render dashboard
- [x] LAGO_WEBHOOK_SECRET — Lago is deferred/not active, not needed yet
- [x] Negative cost_cents rejected (400), zero cost_cents accepted (200)
- [x] Admin negative amount_cents rejected (400)
- [x] WebSocket per-user filter — User A gets own update, User B gets nothing
- [x] Unsigned webhook rejected (400), fake signature rejected (400)
- [x] Webhook dedup — events stored in processed_webhooks, duplicate INSERT rejected at DB level
- [x] LLM call works end-to-end, credits deducted ($47.43 → $47.42)
- [x] Stripe purchase ($5) → webhook processed → credits landed ($42.43 → $47.43)
- [x] SSRF blocked: 169.254.169.254, localhost, 10.0.0.1 all rejected
- [x] Normal image generation works (GPT-Image-1)
- [x] Agent walletAddress mass assignment ignored, field unchanged
- [x] Gemini change isolated to generate_gemini only — not testable live (free tier key, not active)
