# Rescuing user-created skills end to end

- Date: `2026-06-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.699.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.699.1

Today's nightly is dominated by a deep fix for user-created skills that were silently disappearing after a harness restart — from writing the right frontmatter on create, to repairing already-broken skills on startup, to making sure the editor never resets or mis-loads fields. Alongside that, the web analytics pipeline got cleaner attribution and a stable app_version, and the swarm agent delete path learned to stop-then-delete remote agents.

## 1:02 AM — Swarm agent deletes now wait through the stop handshake

The delete path for remote agents was hardened so swarm-hosted agents are reliably torn down, with a follow-up cleanup for status probe agents.

- Deleting a swarm-hosted agent now detects a 409 'needs stop' response, issues a stop, and retries the delete for up to a minute instead of failing the request — and surfaces a clear bad-gateway error if the swarm never finishes stopping. (`90752cd`)
- Status probe agents created by the observability evals are properly cleaned up after each run, with new integration coverage for the remote-delete path. (`90752cd`)

## 2:08 AM — Cleaner web analytics: first-touch source and stable app_version

Two analytics fixes make web telemetry actually usable for tracking acquisition and release health.

- Each visitor's first-touch referrer and utm_source are now classified into a tidy acquisition_source label (x, google, youtube, reddit, github, linkedin, facebook, hackernews, direct, or the raw domain), stamped once via register_once and mirrored onto the user profile so server-side events like session_active can be broken down by source too. (`617b308`)
- The web surface now reports a single stable app_version of 0.0.0 in Mixpanel instead of a fresh commit SHA per Render deploy, while Desktop and mobile keep their real baked release versions; the exact web build is still recoverable via getBuildInfo().commit. (`f50b081`)

## 6:02 AM — User-created skills survive harness restarts again

A missing frontmatter field was causing user skills to vanish after every harness reload; this fix repairs both new and existing skills.

- Skill creation and edit now write the required `name:` field into SKILL.md frontmatter, so user-authored skills stay loadable in the harness registry instead of disappearing with 'skill not found' after the next restart. (`652d5cd`)
- A startup repair pass backfills `name:` (derived from the skill's directory) into any user-created skill missing it, gated by the `source: "user-created"` marker so shop skills are never touched, and writing atomically via temp+rename so a concurrent harness reload can't read a half-written file. (`e170ba4`)

## 6:17 AM — Skill editor no longer leaks or resets fields

Two fixes make the skill edit modal show exactly the skill being edited and round-trip every setting on save.

- The edit modal now resets its description, instructions, and invocability fields at the start of every load, so a slow or failed getSkill no longer leaves the previously-edited skill's content visible — the form either shows the new skill or an error. (`fe27f1e`)
- Editing now pre-fills from a new GET /api/harness/skills/mine/{name} endpoint that reads the on-disk marker file (the source of truth), fixing a regression where saving an edit silently reset user_invocable, model_invocable, and allowed_tools because the harness proxy response dropped them. (`d71b125`)

## 7:13 AM — Desktop now runs the skill recovery pass on startup

The orphaned-skill repair was wired into the Desktop app's own startup path, where it was previously dead code.

- Because the Desktop app embeds aura-os-server as a library and never runs its main(), the skill recovery pass was never executing for the users most likely to hit orphaned skills; it's now invoked explicitly from the Desktop main before the server and harness start. (`bb61d79`)

## 7:21 AM — End-to-end guard against silent skill-edit resets

A new full-cycle test locks in the round-trip fix for editing skills.

- An end-to-end test creates a skill with non-default user_invocable / model_invocable / allowed_tools / model / context, edits only its description, and confirms every other setting survives — guarding against any future regression that silently resets fields on save. (`cca0fdf`)

## Highlights

- Skills survive harness restarts again
- Orphaned skills auto-repaired on Desktop startup
- Edit modal preserves every skill setting
- Cleaner first-touch attribution in analytics

