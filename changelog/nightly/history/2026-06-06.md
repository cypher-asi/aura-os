# Google Workspace integration lands for Aura organizations

- Date: `2026-06-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.631.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.631.1

Today's nightly brings first-class Google Workspace support to Aura. Organizations can now connect Gmail and Google Calendar through an OAuth-backed flow, and follow-up work hardened the trusted runtime, the integration editor UI, and the save path so existing connections survive edits cleanly.

## 2:54 PM — Gmail and Google Calendar connect to Aura organizations

A new Google Workspace integration lets orgs connect Gmail and Calendar via OAuth, proxied through aura-integrations, with a dedicated trusted-runtime path and updated settings UI.

- Organizations can now connect Google to send Gmail and manage Calendar events, with OAuth handled by aura-integrations and `/oauth/google/start` proxied from Aura OS; setup is documented via new `AURA_INTEGRATIONS_URL` and `AURA_INTEGRATIONS_INTERNAL_TOKEN` env vars in the README and `.env.example`. (`0f3fce7`)
- Added a Google-specific trusted-methods module (~340 lines) and trusted_runtime helpers that dispatch Gmail and Calendar tool calls, alongside an expanded org-integration tool catalog covering the new provider. (`0f3fce7`)
- Reworked the Integration Editor and Org Settings Integrations panels with Google-aware ownership, connection state, and styling, backed by a new Playwright suite (`google-integration-ui.spec.ts`) covering the connect flow end-to-end. (`0f3fce7`)
- Tool dispatch now threads the calling user's session into provider calls, so Google actions are attributed to the acting user rather than just the org. (`0f3fce7`)

## 8:59 PM — Google integration save flow preserves OAuth credentials on edit

Follow-up hardening expands the trusted runtime's HTTP surface, fleshes out Calendar event building, and ensures editing or renaming a Google integration no longer drops its stored OAuth metadata.

- Trusted runtime now supports PATCH and DELETE methods and tolerates empty provider responses, unlocking Gmail/Calendar update and delete operations without spurious JSON errors. (`3d606cd`)
- Calendar event creation and updates accept a richer field set — summary, start/end with time zones, description, location, attendees, visibility, transparency, color, and optional Google Meet conferencing — through a shared `build_google_calendar_event_resource` helper. (`3d606cd`)
- Renaming a Google integration in Org Settings now preserves its provider config and connection metadata instead of resetting it, with new UI tests in `OrgSettingsIntegrations.test.tsx` guarding the behavior. (`3d606cd`)
- The update-integration DTO now omits absent patch fields entirely (rather than sending nulls), so editing a Google integration no longer wipes its stored OAuth credentials; explicit nulls are still respected for true clears, and the Integration Editor has new unit and e2e coverage for this path. (`4af3946`)

## Highlights

- Gmail and Google Calendar integration for orgs
- Trusted runtime gains PATCH/DELETE and richer Calendar event building
- Integration editor preserves OAuth credentials across renames and updates

