# First-run onboarding lands across the app

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.438.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.438.1

Today's nightly is dominated by a brand-new first-run experience: a welcome flow, a persistent checklist, smarter empty states, and a friendlier empty chat. A pair of small server and desktop fixes also relax the REQUIRE_ZERO_PRO gate so default builds boot cleanly.

## 4:33 AM — Guided first-run: welcome modal, checklist, and empty-state nudges

A full onboarding system shipped end-to-end, from a two-step welcome modal to a floating checklist, auto-detected task completion, a taskbar Help button, and softer empty states across chat, agents, and tasks.

- Introduced a per-user onboarding store (Zustand + localStorage) with five guided tasks — send a message, create a project, create an agent, generate a 3D image, and explore billing — driving visibility logic for the welcome flow and checklist. (`bd80420`)
- Added a two-step welcome modal on first login (AURA logo and intro, then a checklist preview) that is skippable, analytics-tracked, and locked from accidental overlay dismissal, with a small alignment fix for task-row icons. (`988eee6`, `ec62961`)
- Shipped a portal-rendered checklist widget anchored above the bottom taskbar with a progress bar, collapsible/dismissable header, and rows that route directly into the relevant feature; a Help button in the taskbar toggles or reopens it, and a watcher hook auto-completes tasks by subscribing to message, project, agent, 3D, and billing stores. (`708e75e`, `6f91ff3`, `e5d310e`)
- Reduced blank-canvas friction in chat with four clickable prompt suggestion chips and a subtle pulsing glow on the input bar when a thread is empty, plus more descriptive empty-state copy on the agents index, agent list, and task list. (`11fc116`, `779d737`)

## 5:41 AM — Onboarding checklist stops firing on pre-existing agents and projects

Follow-up work wired the checklist's Create Agent action to the agent editor modal and corrected task auto-detection so default or pre-existing items no longer count as completion.

- The checklist's "Create an agent" row now opens the agent editor modal directly via a new createAgentModalOpen flag on the agent store, instead of just navigating to the list. (`0d96fae`)
- Fixed false-positive completions where users with a default project or agent were marked done on load: detection now requires the count to grow beyond a baseline captured on first subscription, rather than simply being non-zero. (`2f9dbb1`, `8d0ab5a`)

## 6:14 AM — Server defaults REQUIRE_ZERO_PRO to off when unset

A small but meaningful server-side default change so the Zero Pro requirement no longer trips when the env var is absent.

- In the aura-os-server app builder, require_zero_pro now falls back to false when the environment variable is unset, avoiding accidental gating in default deployments. (`ae418f3`)

## 12:19 PM — Desktop build mirrors the new REQUIRE_ZERO_PRO default

The desktop build was brought in line with the server change so Mac, Windows, and Linux nightlies behave consistently out of the box.

- Desktop's build.rs and runtime env init now default REQUIRE_ZERO_PRO to false, matching the server-side fix so the flag is opt-in across all desktop targets in this nightly. (`d987125`)

## Highlights

- New welcome modal and 5-step onboarding checklist
- Empty chat now shows prompt suggestions and a pulsing input
- Friendlier empty states for agents and tasks
- REQUIRE_ZERO_PRO now defaults to off on server and desktop

