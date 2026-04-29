# Open signup, tier subscriptions, and Z credits land

- Date: `2026-04-29`
- Channel: `nightly`
- Version: `0.1.0-nightly.416.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.416.1

Today's nightly opens AURA up beyond Zero Pro and rolls out the foundations of the new tier-based billing system. Account creation is back with optional invite codes, a tier subscription modal and Z credits dashboard ship in settings, and a long tail of polish tightens the billing, rewards, and login experience.

## 2:23 AM — Open signup with invite codes and credit grants

AURA drops its Zero Pro paywall, brings back account creation, and wires up signup and referral credit grants through z-billing.

- Removed the Zero Pro gate from RequireAuth and restored the Create Account tab with an optional invite code; entered codes are validated against zos-api and sanitized server-side against path traversal, while blank codes silently fall back to a default. (`b9155d5`, `54d32a3`)
- Added fire-and-forget signup and referral credit grants via z-billing, then refactored so signup credits fire on first AURA login (idempotent via signup_grant_at) and the inviter is resolved from the zos-api finalize response instead of trusted from the frontend. (`b1d693b`, `5301064`, `bd26448`, `2dac03c`)
- Introduced a Rewards section in org settings showing the user's invite code and referral incentives, and corrected the zos-api invite proxy paths so validation and code fetch hit the right routes. (`5ceeb3c`, `d225766`)

## 2:37 AM — Tier subscriptions and the Mortal plan baseline

Billing pivots from Zero Pro to a tier system, with a new subscription modal, Stripe checkout/portal endpoints, and referral rewards deferred until a paid subscription.

- Reframed Rewards and Billing around the new tier system: Mortal becomes the default plan with 50 daily credits and a flat 5,000-credit referral bonus, replacing Zero Pro upsell copy and the old 'free' plan badge fallback. (`a87a82d`)
- Shipped a TierSubscriptionModal plus backend routes for /api/subscriptions/checkout, /portal, and /me, giving users an in-app upgrade flow that hands off to Stripe Checkout and the Customer Portal. (`499d791`)
- Deferred referral credits to subscription time: signup now passes referred_by to z-billing and rewards only fire when an invited user upgrades to a paid plan, with UI copy updated to match. (`6ab2683`)
- Made the zos-api URL configurable via ZOS_API_URL env var with a sane default, matching the env-driven pattern used elsewhere in the server. (`37dd060`)

## 1:53 AM — Z credits dashboard and login screen cleanup

Settings gain a full Z credit history view and next-billing-date row, while the login screen drops Zero Pro branding and host-switching controls.

- Stripped the Change Host card, host status badge, and HostSettingsModal from the login view and rebranded it from 'Login with ZERO Pro' to 'Login to AURA' with refreshed mobile copy. (`8ede1ca`)
- Added a Z Credit History settings section showing balance, plan, monthly allowance, member-since, and a full transaction list with type labels and running balance. (`8f7739d`)
- Renamed credits to 'Z credits' across billing, rewards, and the buy-credits modal, removed the redundant billing email row (managed via Stripe portal), and surfaced a Next Billing Date row for paid subscribers. (`dda0c13`, `4871baf`)
- Redesigned the invite code as an inline click-to-copy element with 'Copied!' feedback and fixed-width to prevent layout shift, and dropped Pro tier price to a temporary $10 launch price pending the Zero Pro migration. (`248a2aa`, `0002a8e`, `507679b`, `3c4e8aa`)

## 2:39 AM — Subscription state, cancellations, and tab-return refresh

Billing UI gains proper loading states, cancellation messaging, proration hints, and auto-refresh after Stripe round-trips.

- Billing settings now render plan, badge, and next-billing-date rows with explicit loading states for paid users and hide the date for Mortal, eliminating layout flashes during fetch. (`5c1d7f6`, `70de31b`, `fb4f098`)
- Surfaced subscription cancellation state in the UI with a 'Cancels at end of period' description and a 'Plan Ends' row explaining the revert to Mortal, plus added proration info to the tier modal. (`98df74d`, `cc6d7d0`)
- Auto-refresh credit balance and subscription status when the AURA tab regains focus, so users returning from Stripe checkout or the customer portal see the new state without reloading. (`075f5b7`)
- Fixed the build by registering the new rewards and credit-history sections in the settings panel's Section type and updated e2e smoke tests to match the host-control-free login screen. (`9fdb232`, `72eac5f`)

## 4:37 AM — Plan badge refresh attempt reverted

A small label change ships, but a plan-badge refresh fix is rolled back the same hour it landed.

- Renamed 'Monthly Allowance' to 'Monthly Plan Top-Up' in the credit history view to better describe the recurring grant. (`4c8f0f6`)
- Attempted to fix the plan badge not updating on tab return by sourcing it from subscription status instead of balance, then reverted the change in the same window pending a better fix. (`78ebe5f`, `4336baa`)

## Highlights

- Zero Pro gate removed — any authenticated user can use AURA
- Tier subscriptions, Stripe portal, and Z credit history shipped
- Invite-code signup with deferred referral rewards on paid plans
- Login screen simplified — host controls retired

