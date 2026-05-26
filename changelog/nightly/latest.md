# Hardening True DAU measurement across clients and server

- Date: `2026-05-26`
- Channel: `nightly`
- Version: `0.1.0-nightly.560.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.560.1

Today's nightly is a focused analytics-accuracy release: Aura now guarantees that True DAU reflects every authenticated user, whether they actively interact with the app, leave a session open across days, or simply hit an authenticated endpoint from any client.

## 9:42 AM — Closing the True DAU gap with client co-firing and a server-side heartbeat

Aura now emits session_active reliably from both the client and the auth middleware, so daily active counts no longer depend on client version or active user interaction.

- Any tracked event from an identified user now co-fires session_active once per calendar day inside the client's analytics track() helper, structurally guaranteeing True DAU ≥ Engaged DAU without inflating uniques. (`11319e6`)
- Added an hourly session_active interval in AppShell alongside the existing visibilitychange and focus triggers, so desktop and web apps left open overnight still count their users the next day. (`11319e6`)
- Introduced a server-side Mixpanel tracker in aura-os-server that fires session_active from the auth middleware once per user per day, using a DashMap for in-memory dedup and a non-blocking tokio spawn so request latency is unaffected. (`bcbcd4e`)
- Because tracking now runs from require_verified_session, a single backend deploy covers desktop, web, and mobile clients regardless of installed version; the tracker also inspects Mixpanel response bodies to surface silent rejections and requires MIXPANEL_TOKEN on the aura-api Render service. (`bcbcd4e`)

## Highlights

- True DAU now structurally ≥ Engaged DAU
- Server-side session tracking covers desktop, web, and mobile in one deploy
- Long-lived sessions counted via hourly heartbeat

