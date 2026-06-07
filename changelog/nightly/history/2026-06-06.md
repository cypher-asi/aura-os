# Google Gmail and Calendar land in Aura integrations

- Date: `2026-06-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.630.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.630.1

Today's nightly brings first-class Google connectivity to Aura. An afternoon change introduced Gmail and Calendar as connectable org integrations end-to-end, and a late-night follow-up hardened the tool surface and the integration save flow so connections behave predictably across edits and renames.

## 2:54 PM — Gmail and Calendar arrive as a connectable Google integration

Aura gains a full Google integration covering Gmail and Calendar, with OAuth proxied through aura-integrations and a refreshed connect-and-manage UI in org settings.

- Added Google as a first-class org integration with Gmail and Calendar trusted methods, a new provider catalog entry, and ~340 lines of dedicated Google tool plumbing in aura-os-integrations. (`0f3fce7`)
- Wired Google OAuth through the aura-integrations service: `/oauth/google/start` is now proxied, with `AURA_INTEGRATIONS_URL` and `AURA_INTEGRATIONS_INTERNAL_TOKEN` documented in the env example and README as the requirement for users to connect Google. (`0f3fce7`)
- Rebuilt the org settings integrations UI and editor (~470 lines of TSX changes plus a new 290-line Playwright suite) so admins can connect, view, and manage the Google integration alongside existing providers. (`0f3fce7`)
- Tightened integration ownership by threading the authenticated user's identity into org tool dispatch, so Google (and other app-provider) tool calls now run with proper user context. (`0f3fce7`)

## 8:59 PM — Hardening pass on the Google tools and integration save flow

A late-night follow-up sharpened the freshly shipped Google integration: richer Calendar event handling, more forgiving HTTP plumbing, and a save flow that no longer loses Google metadata when an integration is renamed.

- Expanded the trusted runtime for Google: added PATCH and DELETE method support, tolerated empty-body provider responses, and introduced a full Google Calendar event resource builder covering attendees, time zones, visibility, transparency, and on-the-fly Google Meet conference creation. (`3d606cd`)
- Preserved Google integration metadata across renames in the save flow, so editing an integration's name in org settings no longer drops its connection state. (`3d606cd`)
- Hardened the Integration Editor and OrgSettingsIntegrations components with additional UI handling and ~90 lines of new test coverage, plus extended API tests for integration actions and provider mocks to lock in the new Google behaviors. (`3d606cd`)

## Highlights

- Gmail and Calendar are now connectable Google integrations
- OAuth proxied via aura-integrations with new env wiring
- Hardened tool dispatch, save flow, and rename metadata preservation

