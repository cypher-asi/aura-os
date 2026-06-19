# User-created skills come back to life, plus chat, browser, and tasks QA fixes

- Date: `2026-06-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.700.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.700.1

Today's nightly focused on rescuing user-authored skills broken by a missing frontmatter field, with a startup repair pass that also runs on desktop and a faithful round-trip for the skill editor. Alongside that, the team shipped QA fixes across chat, the browser session resolver, and the tasks board, plus sharper analytics on where new users actually come from.

## 1:02 AM — Reliable teardown for remote swarm agents

Deleting agents now cleans up their remote swarm counterparts instead of leaving status probes behind.

- Agent deletion now detects swarm-mode agents and tears down the remote agent through the swarm gateway, retrying with a stop-then-delete handshake for up to a minute when the gateway reports the agent is still running. (`90752cd`)
- Surfaces a clear error when SWARM_BASE_URL isn't configured rather than silently orphaning remote agents, and adds end-to-end coverage for remote-delete and the status-probe runner. (`90752cd`)

## 2:08 AM — First-touch acquisition source and a stable web app_version

Analytics now answers where users actually came from, and stops treating every web deploy as a new app version.

- Each visitor's first-touch referrer and utm_source are classified into a tidy acquisition_source label (x, google, youtube, reddit, github, hackernews, direct, or the originating domain), stamped once via register_once and mirrored onto the user profile so server-side events like session_active can also be broken down by source. (`617b308`)
- The web surface now reports a single 0.0.0 app_version in Mixpanel and the X-App-Version header instead of a new commit SHA per Render deploy; desktop and mobile keep their real baked versions, and the exact web build is still recoverable via getBuildInfo().commit. (`f50b081`)

## 6:02 AM — User-created skills load, recover, and round-trip through editing

A cascade of skill bugs — missing name field, orphaned skills, stale editor state, and silent setting resets — all get fixed together.

- Skill frontmatter now includes the required name field on both create and edit, so user-authored SKILL.md files actually load into the harness registry instead of vanishing as "skill not found" after the next reload. (`652d5cd`)
- A startup repair pass backfills the missing name field into any pre-fix user-created skill (gated by the user-created marker, idempotent, atomic temp+rename write), bringing previously orphaned skills back into the registry on the next harness reload. (`e170ba4`)
- The skill editor modal now clears its fields at the start of each load, so a slow or failed getSkill no longer leaves the previously-edited skill's description and instructions showing in the form. (`fe27f1e`)
- A new GET /api/harness/skills/mine/{name} endpoint reads the on-disk marker file as the source of truth, so the edit form pre-fills user_invocable, model_invocable, and allowed_tools faithfully instead of silently resetting them on save. (`d71b125`)

## 7:13 AM — Desktop startup now runs the skill recovery pass

The skill repair routine is wired into the desktop entry point so orphaned skills are fixed before the embedded harness loads them.

- Because the desktop embeds aura-os-server as a library and never runs its main(), the startup skill-recovery pass was dead on desktop — exactly where users were hitting orphaned skills. It's now called from the desktop's own main() before the server and harness start. (`bb61d79`)

## 7:21 AM — End-to-end guard against skill-edit setting resets

A full create-edit-reopen test locks in the fix that stopped editing from silently wiping skill settings.

- Adds an end-to-end test that creates a skill with non-default user_invocable, model_invocable, allowed_tools, model, and context, edits only the description, and verifies every other setting survives — guarding against regressions of the silent-reset bug. (`cca0fdf`)

## 11:04 AM — QA fixes across chat input, browser sessions, and manual tasks

A trio of app-level fixes addressing literal prompt handling, stale browser probe URLs, and spec-less manual task creation.

- Tasks can now be created manually without specifying a spec — the server resolves or auto-creates a "Manual Tasks" spec for the project, broadcasts the spec_saved event, and the AddTaskForm flow is covered end to end. (`c3cb315`)
- Chat input now preserves literal prompt text in the InputBarShell instead of transforming what the user typed. (`c3cb315`)
- The browser session resolver no longer falls back to stale probe URLs as defaults when selecting a session target. (`c3cb315`)

## Highlights

- Skill loading bug fixed with on-disk recovery for orphaned skills
- Desktop startup now repairs broken skills before the harness loads
- Manual tasks no longer require a spec; chat preserves literal prompt text
- First-touch acquisition source now captured for signups and DAU

