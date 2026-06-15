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
- Release builds for every surface (desktop, web, mobile) fail if the analytics
  token didn't reach the bundle, so a build never silently ships with analytics
  disabled.
