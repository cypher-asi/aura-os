# Credits & Growth — Test Plan

## Prerequisites

- z-billing deployed with migration 0003 + new code
- aura-code deployed with new code
- Render env vars set (see deploy checklist in plan)
- Stripe test mode with products/prices configured
- Stripe CLI installed for webhook forwarding (optional for local testing)

## Phase 1: Unit Tests (automated)

- [x] z-billing: `cargo test --lib` — 22 service tests pass
- [x] z-billing: `cargo test -p z-billing-core --lib` — 33 core tests pass
- [x] aura-code: `cargo build` — Rust compiles
- [x] aura-code: `npx tsc --noEmit` — TypeScript compiles
- [x] aura-code: `npx vitest run` — 47 relevant tests pass

## Phase 2: Registration & Auth Flow

### 2.1 Pro Gate Removed
- [ ] Log in as a non-Pro user → app loads (no "Access Required" screen)
- [ ] Verify `REQUIRE_ZERO_PRO=false` is set on Render

### 2.2 Registration with No Invite Code
- [ ] Navigate to login → "Create Account" tab visible
- [ ] Fill in email, password, name — leave invite code blank
- [ ] Submit → account created successfully
- [ ] Check z-billing: user has signup grant (5000 credits)
- [ ] Check z-billing: no referral grant transaction

### 2.3 Registration with Valid Invite Code
- [ ] Register new account with invite code (e.g. domw-jh4cz8 or another user's code)
- [ ] Submit → account created successfully
- [ ] Check z-billing: user (invitee) has signup grant (5000) + referral bonus (5000) = 10000
- [ ] Check z-billing: inviter also received referral bonus (5000 for Mortal)

### 2.4 Registration with Invalid Invite Code
- [ ] Enter "totally-invalid-code" → "Invalid invite code" error shown
- [ ] Form does NOT submit

### 2.5 Registration with Malicious Input
- [ ] Enter `../etc/passwd` → rejected (sanitisation)
- [ ] Enter code > 50 chars → rejected
- [ ] Enter code with special characters → rejected

### 2.6 Existing User Login — Signup Grant
- [ ] Log in as existing user who has never received signup grant
- [ ] Check z-billing: signup grant (5000) added to balance
- [ ] Log in again → no second signup grant (idempotent)

## Phase 3: Daily Credit Grants

### 3.1 First Use of Day
- [ ] After signup grant received, check balance → daily grant (50 for Mortal) added
- [ ] Total on first login: 5000 (signup) + 2500 (monthly) + 50 (daily) = 7550

### 3.2 Same Day — No Double Grant
- [ ] Check balance again on same day → no additional daily credits
- [ ] Use LLM (triggers usage check) → no additional daily credits

### 3.3 Next Day
- [ ] Wait until next UTC day (or test with modified system time)
- [ ] Check balance → daily grant fires again (50 more)

### 3.4 Grant Gating
- [ ] User without signup_grant_at → daily grant does NOT fire
- [ ] User with signup_grant_at → daily grant fires normally

## Phase 4: Monthly Credit Allowance

### 4.1 First Month
- [ ] New user's first balance check → monthly allowance (2500 for Mortal) granted
- [ ] Check `last_monthly_grant_at` is set

### 4.2 Same Month — No Double Grant
- [ ] Check balance again within 30 days → no additional monthly credits

### 4.3 Grant Gating
- [ ] User without signup_grant_at → monthly grant does NOT fire

## Phase 5: Referral Credits

### 5.1 Invitee Receives Bonus
- [ ] Register with valid invite code → invitee gets 5000 referral credits

### 5.2 Inviter Receives Bonus
- [ ] After invitee registers → inviter gets bonus (5000 for Mortal tier)

### 5.3 No Duplicate Referral
- [ ] Same invitee registers again (impossible, but test endpoint directly)
- [ ] Referral grant endpoint returns `granted: false`

### 5.4 Default Code — No Referral
- [ ] Register with no invite code (default used) → no referral credits for either party

### 5.5 Self-Referral Blocked
- [ ] Call referral-grant with same user ID for both → error returned

## Phase 6: Tier Subscription (Stripe Integration)

### 6.1 Subscription Checkout
- [ ] Click "Change Plan" → tier modal opens
- [ ] Click "Upgrade" on Pro → redirects to Stripe Checkout
- [ ] Use test card 4242424242424242 → payment succeeds
- [ ] Stripe sends `checkout.session.completed` webhook
- [ ] Stripe sends `customer.subscription.created` webhook
- [ ] z-billing account updated: plan = Pro, stripe_customer_id saved
- [ ] Daily credits now 100/day (Pro tier)
- [ ] Monthly credits now 5000 (Pro tier)

### 6.2 Existing Customer — Saved Card
- [ ] User who previously purchased credits has stripe_customer_id
- [ ] Subscribe → Stripe shows saved card on checkout

### 6.3 Subscription Portal
- [ ] Subscribed user clicks "Manage" → Stripe Customer Portal opens
- [ ] Can update card, view invoices, cancel subscription

### 6.4 Plan Upgrade
- [ ] Pro subscriber upgrades to Crusader via portal
- [ ] `customer.subscription.updated` webhook fires
- [ ] z-billing account updated: plan = Crusader
- [ ] Daily credits now 200/day

### 6.5 Cancellation
- [ ] Cancel subscription via portal
- [ ] `customer.subscription.updated` with cancel_at_period_end = true
- [ ] z-billing marks status as Cancelled but subscription still present
- [ ] User keeps tier benefits until period end
- [ ] After period end: `customer.subscription.deleted` fires
- [ ] z-billing reverts to Mortal
- [ ] Daily credits back to 50/day

### 6.6 Payment Failure
- [ ] Use Stripe test card 4000000000000341 (decline on charge)
- [ ] `invoice.payment_failed` webhook fires
- [ ] z-billing marks subscription as past_due

### 6.7 Monthly Renewal
- [ ] Use Stripe test clock to advance time 1 month
- [ ] `invoice.paid` webhook fires
- [ ] Monthly credits deposited (5000 for Pro)
- [ ] `last_monthly_grant_at` updated

### 6.8 Single Subscription Enforcement
- [ ] Already subscribed user clicks "Upgrade" → redirected to portal, not new checkout

### 6.9 Webhook Idempotency
- [ ] Replay a webhook event → rejected by processed_webhooks table
- [ ] No duplicate credits

### 6.10 Webhook Signature
- [ ] Send unsigned webhook → rejected

## Phase 7: UI Verification

### 7.1 Rewards Section
- [ ] Team Settings → Rewards tab visible
- [ ] Invite code displayed with copy button
- [ ] Copy button works, shows "Copied" feedback
- [ ] Welcome Bonus: 5,000 credits
- [ ] Daily Active Reward: 50 credits/day
- [ ] Referral Bonus: 5,000 credits
- [ ] "Earn More" section shown

### 7.2 Billing Section
- [ ] Intro text shown
- [ ] Current Balance shows credits (not dollars)
- [ ] Current Plan shows "mortal"
- [ ] "Change Plan" button opens tier modal
- [ ] Buy Credits presets: $25 (2,500), $50 (5,000), $100 (10,000), $250 (25,000)
- [ ] Custom amount works
- [ ] Purchase button triggers Stripe checkout

### 7.3 Buy Credits Modal (widget)
- [ ] Balance shown in credits
- [ ] Presets match billing settings
- [ ] Footer shows credits (not dollars)

### 7.4 Tier Subscription Modal
- [ ] 2x2 grid, no horizontal scroll
- [ ] All 4 tiers shown with correct amounts
- [ ] "Monthly top-up" / "Daily active reward" / "Referral reward" labels
- [ ] Mortal shows "Current Plan" badge
- [ ] Pro/Crusader/Sage show "Upgrade" button
- [ ] Current tier shows "Manage" (if subscribed)

### 7.5 Credits Badge (topbar)
- [ ] Shows credit balance in Z format
- [ ] Updates in real-time via WebSocket on balance changes

## Phase 8: Security

- [ ] Invite code with path traversal → rejected
- [ ] Unauthenticated subscription checkout → rejected
- [ ] Unauthenticated portal → rejected
- [ ] Signup grant endpoint without service API key → rejected
- [ ] Daily grant endpoint without service API key → rejected
- [ ] Referral grant endpoint without service API key → rejected
- [ ] Duplicate Stripe webhook → rejected
- [ ] Invalid Stripe webhook signature → rejected

## Phase 9: Edge Cases

- [ ] User with 0 credits → daily/monthly still fire (balance goes positive)
- [ ] Very long invite code (50 chars) → accepted if valid
- [ ] Invite code with only hyphens → accepted by sanitiser, rejected by zos-api
- [ ] Balance check with no account → account auto-created, grants fire
- [ ] Multiple concurrent balance checks → only one daily grant (idempotent)
