# Analytics

AURA uses [Mixpanel](https://mixpanel.com) for product analytics — to understand
how the product is used so we can improve it.

## Privacy posture

- **Anonymous by default.** Users are identified only by their ZERO `user_id`
  (an opaque UUID). No email, name, wallet address, or display name is sent.
- **No content.** Prompts, messages, file contents, file paths, project/task
  names, and model outputs are never sent.
- **Opt-out.** Tracking respects the in-app opt-out toggle and the browser
  Do-Not-Track / Global Privacy Control signals, and is a safe no-op when opted
  out or when no analytics token is configured.

## How it works (for contributors)

- Client events go through a single `track()` wrapper
  (`interface/src/lib/analytics.ts`), typed against a central registry
  (`interface/src/lib/analytics-registry.ts`). **Adding, renaming, or removing a
  client event requires updating the registry** — a contract test fails CI
  otherwise, so tracking can't silently drift.
- `session_active` (the basis for active-user metrics) is emitted **only by the
  server**, keyed to the ZERO `user_id` and de-duplicated per user per day, so a
  user is counted once regardless of how many devices or builds they use.
- Server-side usage signals such as `agent_turn_classified` are observe-only:
  they send privacy-safe classification metadata to Mixpanel and storage, never
  prompts, model outputs, file paths, project names, or raw IP addresses.
  These events classify traffic shape (`agentic_work`, `generic_agent_chat`,
  `mixed`, `low_signal`) and whether a turn should be included in quota-review
  analysis. They are not a standalone abuse verdict.
  The same event is best-effort enriched from z-billing with account age,
  plan, balance, lifetime purchased/granted/used cents, auto-refill state,
  `billing_funding_bucket` (`none`, `grant_only`, `purchase_only`, `mixed`),
  and `billing_grant_usage_bucket` (`no_grants`, `0`, `lt_25pct`,
  `25_75pct`, `75_100pct`, `100pct_plus`). Mixpanel charts should combine
  these billing fields with usage shape, project counts, token volume, and
  session recency rather than treating one field as proof of misuse.
- Release builds for every surface (desktop, web, mobile) fail if the analytics
  token didn't reach the bundle, so a build never silently ships with analytics
  disabled.
