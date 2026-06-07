# Google Workspace lands in Aura: Gmail, Calendar, and a hardened connect flow

- Date: `2026-06-06`
- Channel: `nightly`
- Version: `0.1.0-nightly.632.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.632.1

Today's nightly is anchored by a single big arrival: first-class Google Workspace integration. Aura now connects to Gmail and Google Calendar through a dedicated OAuth flow, and a late-evening follow-up sweep hardened the save path, preserved OAuth state across edits, and added regression coverage for the new tool catalog.

## 2:54 PM — Gmail and Google Calendar arrive as workspace integrations

Aura gains a full Google Workspace integration, connecting Gmail and Calendar through a proxied OAuth flow and exposing them as installable org tools.

- Added Google as a first-class workspace integration with Gmail (search, get, send, drafts) and Calendar (list, create, update, delete events) tools wired through the trusted runtime and org tool dispatcher. (`0f3fce7`)
- Introduced an OAuth bridge via the aura-integrations service: the server proxies /oauth/google/start, and new env vars (AURA_INTEGRATIONS_URL, AURA_INTEGRATIONS_INTERNAL_TOKEN) document how to enable Google connect for users. (`0f3fce7`)
- Reworked the Integration Editor and Org Settings Integrations UI to support the Google connect flow, tighten integration ownership, and surface the new provider in the catalog. (`0f3fce7`)
- Threaded the calling user's identity into org tool dispatch so per-user Google credentials can be resolved when invoking workspace tools. (`0f3fce7`)

## 8:59 PM — Hardening pass on the Google connect, save, and reconnect flow

A late-night sweep tightened the Google integration end-to-end: richer Calendar event payloads, OAuth fields preserved across edits, recovery from stuck reconnect popups, and regression tests for the installed tool catalog.

- Extended the trusted runtime with PATCH and DELETE support and added a full Google Calendar event resource builder (attendees, time zone, Google Meet conferencing, visibility/status fields) so update_event and related tools accept the same rich payload shape as create_event. (`3d606cd`)
- Fixed integration updates so Google OAuth credentials and metadata are preserved on rename and edit: absent patch fields are now omitted from the PATCH request instead of being sent as nulls that would clear stored tokens. (`3d606cd`, `4af3946`)
- Added a recovery path for stuck Google OAuth reconnects in the integrations manager hook, with a popup timeout (GOOGLE_OAUTH_POPUP_TIMEOUT_MS) so users are no longer trapped in a pending state if the OAuth window is closed or stalls. (`3b3d491`)
- Locked in the new Google tool surface with a workspace catalog regression test asserting all ten Gmail and Calendar tools install correctly against a connected Google integration. (`3b3d491`)

## Highlights

- Gmail and Google Calendar are now connectable workspace tools
- OAuth credentials survive integration rename and edit
- Stuck Google reconnect state can now recover
- Trusted runtime gained PATCH/DELETE and richer event resources

