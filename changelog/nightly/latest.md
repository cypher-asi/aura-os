# Skills recovery, manual tasks, and cleaner analytics

- Date: `2026-06-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.701.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.701.1

Today's nightly is anchored by a thorough rescue of user-created skills — a missing frontmatter field had been quietly orphaning them across reloads — alongside a real fix for adding tasks without a spec, sharper acquisition analytics, and a swarm cleanup that stops abandoned probe agents from piling up.

## 1:02 AM — Swarm status probes get a real teardown path

Deleting a swarm-backed agent now drives the remote gateway through stop-then-delete, so observability probes stop accumulating as ghost agents.

- Agent deletion now detects swarm-mode agents and calls the swarm gateway's delete endpoint, retrying through a stop step when the gateway returns 409, so remote probe agents are reliably removed instead of being left running. (`90752cd`)
- The status-probe runner and its new tests round out the cleanup, giving the eval pipeline a way to verify probes are torn down end to end. (`90752cd`)

## 2:08 AM — First-touch acquisition source in analytics

The web analytics pipeline now tells us where users actually came from, and stops inventing a brand new app version on every deploy.

- Each visitor's first-touch referrer and utm_source are classified into a tidy acquisition_source label (x, google, direct, the site's own domain, etc.), stamped once via register_once, and mirrored onto the user profile at identify time so server-side events like session_active can be broken down by source. (`617b308`)
- Web now reports a single stable app_version (0.0.0) to Mixpanel instead of a fresh commit SHA per Render deploy, while desktop and mobile keep their real baked release versions; the exact web build is still recoverable from getBuildInfo().commit. (`f50b081`)

## 6:02 AM — Rescuing user-created skills from the missing-name bug

A four-part fix restores skills that had been silently dropped from the harness registry and stops the skill editor from quietly resetting fields on save.

- Created and edited skills now write the required name: field into SKILL.md frontmatter, so the harness can load them on every reload instead of dropping them with "skill not found" after a restart. (`652d5cd`)
- A startup repair pass backfills name: into any user-created skill missing it, marker-gated to user-authored files and written atomically so a concurrent harness reload can't read a half-written file — orphaned skills now load on the next reload. (`e170ba4`)
- The skill editor now pre-fills from a new GET /api/harness/skills/mine/{name} endpoint that reads the marker file directly, so user_invocable, model_invocable, and allowed_tools round-trip faithfully instead of being silently reset on save. (`d71b125`)
- The edit modal also clears its form at the start of every load, so a slow or failed fetch can no longer leave the previously-edited skill's description and instructions sitting in the form. (`fe27f1e`)

## 7:13 AM — Skill recovery extended to the desktop startup path

Desktop users — the ones most affected by orphaned skills — now actually run the new recovery pass.

- Because desktop embeds aura-os-server as a library and never executes its main(), repair_user_skills_on_startup is now invoked explicitly from the desktop's own startup before the server and harness boot, so orphaned skills are repaired before the harness tries to load them. (`bb61d79`)

## 7:21 AM — End-to-end guard for the skill edit round-trip

A new integration test locks in the editor fix so flags and tool lists can't silently regress again.

- An end-to-end test creates a skill with non-default user_invocable, model_invocable, allowed_tools, model, and context, edits only its description, and re-opens it to confirm every other setting survives — closing the regression where editing silently reset those fields. (`cca0fdf`)

## 11:04 AM — Manual tasks, literal chat prompts, and steadier browser defaults

A QA-blocker sweep across chat, browser, and the Tasks board unblocks adding ad-hoc tasks and stops a few small but visible misbehaviors.

- Tasks can now be created without a spec: the server auto-resolves (or creates) a "Manual Tasks" spec when none is supplied, broadcasts the new spec, and a follow-up fix gives manual tasks a sensible default order_index so they slot into the board correctly. (`c3cb315`, `fb6b20d`)
- Chat now preserves literal prompt text in the input bar instead of transforming it, fixing cases where typed prompts were subtly altered before send. (`c3cb315`)
- The browser session resolver no longer falls back to stale probe URLs as defaults, so new sessions start from a clean state. (`c3cb315`)

## Highlights

- User-created skills no longer vanish after a reload
- Manual tasks can be added without picking a spec
- First-touch acquisition source captured in analytics
- Swarm status probes now actually get torn down

