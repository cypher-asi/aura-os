# Skill recovery, manual task fixes, and cleaner analytics

- Date: `2026-06-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.702.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.702.1

A heavy day of skill-system repair work: user-created skills that had gone missing are now backfilled and recoverable on both server and desktop startup, and the editor finally round-trips every field. Alongside that, manual task creation and chat/browser inputs got QA fixes, web analytics stopped fragmenting by deploy, and release CI gained timeouts to stop runaway probes.

## 1:02 AM — Swarm agent deletes wait for remote stop

Agent deletion now coordinates with the swarm gateway so probe and remote agents are actually torn down instead of being left hanging.

- Delete now detects swarm-mode agents, calls the swarm gateway to stop them, and retries the delete until the remote agent is gone — replacing the previous fire-and-forget path that left observability probe agents lingering. (`90752cd`)
- The status-probe runner and its tests were updated alongside the server-side cleanup so release observability stops accumulating zombie agents. (`90752cd`)

## 2:08 AM — First-touch acquisition source and a single web app_version

Web analytics gained a durable acquisition_source dimension and stopped reporting a new app_version on every Render deploy.

- Each visitor's first-touch referrer and utm_source are now classified into a tidy acquisition_source label (x, google, direct, or the originating domain), stamped once via register_once and mirrored onto the user profile so server-emitted events like session_active can be sliced by source. (`617b308`)
- The web surface now reports a stable 0.0.0 app_version instead of baking the Render commit SHA into every deploy, ending the per-deploy version explosion in Mixpanel while desktop and mobile keep their real release versions; the exact web build is still recoverable via getBuildInfo().commit. (`f50b081`)

## 6:02 AM — User-created skills can be edited again without losing fields

A chain of fixes makes the skill editor reliable end-to-end: frontmatter is written correctly, orphaned skills are repaired on startup, the modal no longer leaks state, and edits preserve every setting.

- Skill creation and edits now write the required name: field into SKILL.md frontmatter, so user-authored skills survive harness reloads instead of vanishing with "skill not found" after a restart. (`652d5cd`)
- A startup repair pass backfills the missing name: field into pre-existing user-created skills — marker-gated to never touch shop skills, idempotent, and using atomic temp+rename writes so a concurrent harness reload can't read a half-written file. (`e170ba4`)
- The edit modal now clears its form at the start of each load, so a slow or failed getSkill no longer leaves the previously-edited skill's description and instructions visible. (`fe27f1e`)
- A new GET /api/harness/skills/mine/{name} endpoint reads the user-created marker file directly so the editor pre-fills from the source of truth — fixing silent resets of user_invocable, model_invocable, and allowed_tools that the harness proxy was dropping. (`d71b125`)

## 7:13 AM — Desktop startup also repairs orphaned skills

The skill recovery pass now runs on the Desktop launch path, where most affected users actually hit the bug.

- Because Desktop embeds aura-os-server as a library and bypasses its main(), repair_user_skills_on_startup was wired into the Desktop entry point — before the server and harness start — so orphaned skills are fixed for Desktop users on the next launch. (`bb61d79`)

## 7:21 AM — Manual tasks, chat prompts, and browser defaults unblocked

A round of QA fixes lets tasks be created without a spec, keeps chat prompts literal, and stops the browser from defaulting to stale probe URLs.

- Manual task creation no longer requires a spec_id — the server resolves or lazily creates a "Manual Tasks" spec, and a follow-up ensures these tasks get a sensible default order_index so they sort predictably on the board. (`c3cb315`, `fb6b20d`)
- Chat now preserves literal prompt text, and the browser session resolver no longer falls back to stale probe URLs as defaults — both surfaced as QA blockers in the same fix bundle. (`c3cb315`)
- An end-to-end regression test now exercises the full skill edit cycle, asserting that user_invocable, model_invocable, allowed_tools, model, and context all survive a save round-trip. (`cca0fdf`)

## 12:57 PM — Release workflows gain timeouts on desktop observability steps

Nightly and stable release pipelines now bound their macOS desktop probe and validation steps so a hung check can't stall the whole release.

- Added 10–12 minute timeouts to the desktop observability probe, status reporting, investigation, and learning steps in both release-nightly.yml and release-stable.yml, and bounded the desktop smoke validation workflow the same way. (`ed9716b`, `505c430`)

## Highlights

- Orphaned user skills auto-recover on startup
- Skill editor round-trips every field again
- Manual tasks no longer require a spec
- Web analytics reports a stable app_version
- Release workflows bounded with timeouts

