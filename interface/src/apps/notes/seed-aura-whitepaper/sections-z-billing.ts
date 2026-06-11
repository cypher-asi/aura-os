/**
 * Whitepaper sections for the z-billing repo (cypher-asi/z-billing): the
 * credit-based billing service. Authored from the repo README and
 * docs/spec/v0.1.0/*. Grouped under the "z-billing" nav key; sortOrder 500+.
 */

import { F, type WhitepaperSection } from "./sections-types";

export const Z_BILLING_SECTIONS: WhitepaperSection[] = [
  {
    title: "Overview",
    slug: "z-billing-overview",
    section: "z-billing",
    sortOrder: 500,
    excerpt:
      "Credit-based billing for the ecosystem: Z Credits (1 = $0.01) fund usage, with an immutable ledger, Stripe payments, and Lago analytics.",
    body: `# Overview

Z-Billing is the credit-based billing service for the Cypher ecosystem and AURA platform. It models money as **Z Credits** (1 Z Credit = $0.01, stored as integer cents) and records every balance change in an immutable ledger.

## Overview

- Per-user accounts with balance, lifetime stats, subscription plan, and optional auto-refill.
- Platform services (e.g. \`aura-router\`) report usage with a service API key; z-billing prices it and deducts atomically.
- An append-only, ULID-ordered transaction ledger backs every credit and debit.
- End users authenticate with ZERO-ID (ZID) JWTs; internal callers use a shared service \`X-API-Key\`.
- Stripe handles checkout and payment webhooks; Lago receives usage analytics and subscription events.

## Architecture

${F}text
 z-billing-service (Axum)
   handlers: accounts · credits · usage · webhooks
   auth: ZID JWT (end users) · X-API-Key (services)
   integrations: Stripe · Lago
        |
        v
 z-billing-store   Store trait -> RocksStore (RocksDB)
   CFs: accounts · transactions · transactions_by_user · usage_events
        |
        v
 z-billing-core   pure domain types: ids · account · credits · usage · pricing
${F}

## Internals

The crates layer strictly downward (\`service\` -> \`store\` -> \`core\`), with \`z-billing-client\` as the consumer SDK and \`z-billing-lago\` as standalone Docker Compose tooling.

${F}text
 z-billing-service --> z-billing-store --> z-billing-core
        '----------------------------------------^
 z-billing-client --> z-billing-core
 z-billing-lago (standalone Docker Compose)
${F}`,
  },
  {
    title: "Identifiers",
    slug: "z-billing-identifiers",
    section: "z-billing",
    sortOrder: 501,
    excerpt:
      "Strongly typed IDs: UserId from the ZID subject, time-ordered TransactionId ULIDs, and external AgentId.",
    body: `# Identifiers

Strongly typed identifiers keep the ledger unambiguous and time-ordered.

## Overview

- \`UserId\` - a UUID derived from the ZID JWT \`sub\` claim; one account per user.
- \`TransactionId\` - a ULID, so transactions sort lexicographically by creation time.
- \`AgentId\` - an external identifier optionally attached to a usage event.
- IDs double as storage keys (e.g. the \`transactions_by_user\` index is \`user_id\` + \`transaction_id\`).

## Architecture

${F}text
 ZID JWT.sub --> UserId (UUID) --> one Account
 every ledger entry --> TransactionId (ULID, time-ordered)
 usage event --> optional AgentId
${F}

## Internals

Because \`TransactionId\` is a ULID, the \`transactions_by_user\` index returns a user's history newest-first with no separate sort, and the keyspace stays naturally ordered on disk.

${F}text
 transactions_by_user key = user_id (16B) + transaction_id (ULID)
   -> range scan by user_id -> already time-ordered
${F}`,
  },
  {
    title: "Accounts",
    slug: "z-billing-accounts",
    section: "z-billing",
    sortOrder: 502,
    excerpt:
      "The per-user billing account: balance, lifetime counters, subscription plan and status, auto-refill, and lazy Stripe/Lago customer IDs.",
    body: `# Accounts

Each user has a single billing account tracking balance, history, and subscription state.

## Overview

- Balance in cents (\`i64\`) plus lifetime purchased / granted / used counters.
- A subscription \`Plan\` (Free / Standard / Pro / Enterprise) with a status machine and monthly grants.
- Optional auto-refill that buys credits when the balance drops below a threshold.
- Lazily-created Stripe and Lago customer IDs stored on the account.

## Architecture

${F}text
 Account (per UserId)
   balance_cents (i64)
   lifetime: purchased / granted / used
   subscription: { plan(Free|Standard|Pro|Enterprise), status }
   auto_refill: { enabled, threshold, amount }
   stripe_customer_id? · lago_customer_id?   (lazy)
${F}

## Internals

Customer IDs are created on first need (first checkout / first usage forward), so an account exists immediately from the ZID token without any upfront calls to Stripe or Lago.

${F}text
 first checkout  -> create Stripe customer -> store stripe_customer_id
 first usage fwd -> create Lago customer   -> store lago_customer_id
${F}`,
  },
  {
    title: "Credits",
    slug: "z-billing-credits",
    section: "z-billing",
    sortOrder: 503,
    excerpt:
      "The immutable credit-transaction ledger: transaction types, the running-balance invariant, and idempotent usage linkage.",
    body: `# Credits

Every balance change is an immutable \`CreditTransaction\`; together they form an auditable ledger.

## Overview

- Six transaction types: \`Purchase\`, \`Usage\`, \`SubscriptionGrant\`, \`Refund\`, \`Bonus\`, \`AutoRefill\` (only \`Usage\` is a debit).
- Each entry stores \`amount_cents\` (signed), \`balance_after_cents\`, a description, and metadata (model, provider, tokens).
- Credit-in flows converge on \`add_credits\`; usage converges on \`process_usage\`.
- Usage carries an \`event_id\` for idempotency so retries never double-charge.

## Architecture

${F}text
 credit in:  Purchase | SubscriptionGrant | Refund | Bonus | AutoRefill
                          \\__ add_credits() -> update balance + append TX (atomic)

 credit out: Usage (LLM tokens / compute / API)
                          \\__ process_usage() -> check balance -> deduct -> append TX + usage_event (atomic)
${F}

## Internals

The ledger maintains a running-balance invariant per user, which lets integrity be verified by replaying the chain.

${F}text
 transaction[n].balance_after_cents
     = transaction[n-1].balance_after_cents + transaction[n].amount_cents
${F}`,
  },
  {
    title: "Pricing",
    slug: "z-billing-pricing",
    section: "z-billing",
    sortOrder: 504,
    excerpt:
      "Centralized PricingConfig: per-model LLM token rates, compute/API/storage defaults, the minimum-1-credit rule, and plan discounts.",
    body: `# Pricing

\`PricingConfig\` is the single source of truth for what consumption costs.

## Overview

- Per-model LLM rates over input and output tokens (\`LlmPricing\`).
- Defaults for compute (CPU-hours, memory GB-hours), API calls (per request), and storage (GB-months).
- A minimum 1-credit rule so no billable action rounds to zero.
- Plan purchase discounts applied when buying credits.

## Architecture

${F}text
 PricingConfig
   llm:     model -> { input_per_token, output_per_token }
   compute: cpu_hour · mem_gb_hour
   api:     per_request
   storage: gb_month
        |
        v
 cost_cents = ceil(rate * quantity), min 1 credit
${F}

## Internals

Pricing is pure (no I/O), so the same config computes a cost identically whether at usage time or in a pre-check estimate, and the minimum-1 rule is applied after the raw computation.

${F}text
 usage metric + PricingConfig -> raw cost -> max(raw, 1) -> credits to deduct
${F}`,
  },
  {
    title: "Usage",
    slug: "z-billing-usage",
    section: "z-billing",
    sortOrder: 505,
    excerpt:
      "Usage events (metrics, sources, cost), the service reporting API, idempotent processing, and async Lago forwarding.",
    body: `# Usage

Usage events are how platform services turn consumption into deductions.

## Overview

- A \`UsageEvent\` carries a \`UsageMetric\`, a \`UsageSource\`, pre/post cost, and a unique \`event_id\`.
- Services report via \`POST /v1/usage\` (with batch and balance-check variants) using a service API key.
- Processing is idempotent on \`event_id\`; duplicate submissions are rejected.
- Each processed event is forwarded asynchronously to Lago for analytics.

## Architecture

${F}text
 aura-router / aura-swarm
   POST /v1/usage (X-API-Key) { metric, source, event_id, cost }
        |
        v
 idempotency check (event_id seen?) --yes--> reject (no double charge)
        |  no
        v
 price (PricingConfig) -> balance check -> process_usage() (atomic)
        |
        v
 async forward to Lago (analytics)   ;   response { new_balance, transaction_id }
${F}

## Internals

The hot path deducts credits and records the usage event in one atomic store operation; the Lago forward is detached so analytics latency never blocks the caller.

${F}text
 process_usage(): { deduct balance · append CreditTransaction · store usage_event } as one batch
   then (async) Lago.forward(usage_event)
${F}`,
  },
  {
    title: "Storage",
    slug: "z-billing-storage",
    section: "z-billing",
    sortOrder: 506,
    excerpt:
      "The Store trait over RocksDB column families and the atomic compound operations process_usage and add_credits.",
    body: `# Storage

A \`Store\` trait over RocksDB column families, with atomic compound operations.

## Overview

- \`Store\` trait abstracts persistence; \`RocksStore\` is the RocksDB implementation.
- Column families: \`accounts\`, \`transactions\`, \`transactions_by_user\` (index), \`usage_events\`.
- Compound ops \`process_usage\` and \`add_credits\` mutate balance + ledger (+ index/event) atomically.
- Values are CBOR-encoded; keys are the typed IDs.

## Architecture

${F}text
 Store trait
   |  RocksStore (RocksDB)
   v
 CF accounts             key=user_id        -> Account
 CF transactions         key=transaction_id -> CreditTransaction (CBOR)
 CF transactions_by_user key=user_id+tx_id  -> (index)
 CF usage_events         key=event_id       -> UsageEvent (idempotency)
${F}

## Internals

\`process_usage\` runs under a per-user lock and short-circuits on insufficient balance, then commits a single write batch across all affected column families - so a charge is all-or-nothing.

${F}text
 process_usage():
   lock(user) -> balance < cost ? abort
   else single batch { accounts(update) , transactions(put) , transactions_by_user(put) , usage_events(put) }
${F}`,
  },
  {
    title: "Authentication",
    slug: "z-billing-authentication",
    section: "z-billing",
    sortOrder: 507,
    excerpt:
      "End-user ZID JWT validation vs service X-API-Key auth, plus webhook signature verification.",
    body: `# Authentication

Two distinct trust paths: end users present ZID JWTs; services present a shared API key.

## Overview

- End users: ZID JWT validated via JWKS, audience \`z-billing\`; \`UserId\` from the \`sub\` claim.
- Services: \`X-API-Key\` shared secret for usage reporting and balance checks.
- Webhooks: Stripe and Lago payloads are verified by signature before they can grant credits.
- A route protection matrix maps each endpoint to the auth it requires.

## Architecture

${F}text
 end user  --> Authorization: Bearer <ZID JWT> --> JWKS verify (aud=z-billing) --> UserId
 service   --> X-API-Key: <secret>             --> usage / balance routes
 webhook   --> signature header                --> verify before applying grant
${F}

## Internals

Separating user auth from service auth means a leaked end-user token can never report usage or move another user's balance; only signed webhooks and keyed services can mint credits.

${F}text
 ZID JWT   -> read own account / checkout (self only)
 X-API-Key -> report usage / check balance (any user)
 webhook   -> grant credits (only if signature valid)
${F}`,
  },
  {
    title: "API",
    slug: "z-billing-api",
    section: "z-billing",
    sortOrder: 508,
    excerpt:
      "The HTTP surface for accounts, credits, payments, usage, and webhooks.",
    body: `# API

The Axum HTTP surface, grouped by concern.

## Overview

- Accounts - read balance, subscription, and account state.
- Credits - transaction history from the ledger.
- Payments - Stripe checkout sessions for buying credits.
- Usage - \`POST /v1/usage\` (+ batch, balance check) for services.
- Webhooks - Stripe and Lago callbacks that grant credits.

## Architecture

${F}text
 /v1/accounts/*   (ZID JWT)      account + balance + subscription
 /v1/credits/*    (ZID JWT)      transaction history
 /v1/payments/*   (ZID JWT)      Stripe checkout
 /v1/usage        (X-API-Key)    report usage / check balance
 /v1/webhooks/*   (signature)    Stripe / Lago events
${F}

## Internals

Every response is JSON with a consistent error shape; the usage routes return the new balance and \`transaction_id\` so callers can reconcile immediately.

${F}text
 POST /v1/usage -> 200 { new_balance_cents, transaction_id } | 402 insufficient
${F}`,
  },
  {
    title: "Integrations",
    slug: "z-billing-integrations",
    section: "z-billing",
    sortOrder: 509,
    excerpt:
      "Stripe (customers, checkout, webhooks -> credit grants) and Lago (subscriptions, usage analytics, webhooks -> subscription grants).",
    body: `# Integrations

Two external systems extend billing: Stripe for money in, Lago for analytics and subscriptions.

## Overview

- Stripe: customer management, checkout sessions, and webhooks that grant \`Purchase\` credits on completed payment.
- Lago: customers, subscriptions, usage-event analytics, and webhooks that grant \`SubscriptionGrant\` credits.
- Both degrade gracefully - core billing keeps working if an integration is unavailable.
- Customer IDs are created lazily and cached on the account.

## Architecture

${F}text
 Stripe checkout.completed (webhook) --> verify --> add_credits(Purchase)
 Lago subscription.started (webhook) --> verify --> add_credits(SubscriptionGrant)
 usage_event --> (async) Lago analytics
${F}

## Internals

Credit grants only ever come from verified webhooks (not client calls), so the ledger's credit-in side is authoritative and tamper-resistant.

${F}text
 client cannot mint credits directly
   -> only signed Stripe/Lago webhooks call add_credits()
${F}`,
  },
  {
    title: "Lago Deployment",
    slug: "z-billing-lago-deployment",
    section: "z-billing",
    sortOrder: 510,
    excerpt:
      "The z-billing-lago crate: Docker Compose lifecycle and configuration for running Lago locally.",
    body: `# Lago Deployment

\`z-billing-lago\` is standalone tooling for running a local Lago stack via Docker Compose.

## Overview

- \`LagoDeployment\` wraps lifecycle commands: start, stop, restart, status, logs.
- \`LagoConfig\` holds configuration and environment variables.
- Brings up Lago's api / db / redis / worker services for local and dev use.
- Standalone - it does not depend on the other z-billing crates.

## Architecture

${F}text
 z-billing-lago
   LagoConfig (env) --> LagoDeployment
        |  docker compose up/down/restart/status/logs
        v
 Lago stack: api · db · redis · worker
${F}

## Internals

Keeping deployment tooling in its own crate means the billing service depends only on Lago's HTTP API at runtime, while local operators get a one-command Lago environment.

${F}text
 LagoDeployment.start() -> docker compose up (api, db, redis, worker)
 z-billing-service -----> talks to Lago HTTP API only
${F}`,
  },
];
