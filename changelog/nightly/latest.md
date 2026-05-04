# First-run onboarding lands across Aura

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.440.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.440.1

Today's nightly is built around a brand-new first-run experience: a welcome modal, a persistent five-step checklist, smarter empty states, and prompt suggestions to get new users from blank canvas to first message. A short server fix and CI plumbing for analytics tokens round out the day.

## 4:33 AM — Guided first-run experience with welcome modal and checklist

A full onboarding flow now greets new users on first login, with a persistent checklist that auto-completes as they explore Aura.

- New users are now greeted by a two-step welcome modal showing the AURA logo, a welcome message, and a preview of the onboarding checklist, backed by a Zustand store with per-user localStorage persistence and analytics tracking. (`bd80420`, `988eee6`, `ec62961`)
- A floating, collapsible checklist anchored bottom-right walks users through five concrete first actions — send a message, create a project, create an agent, generate an image, and explore plans & credits — with a progress bar and one-click navigation into each feature. (`708e75e`, `e5d310e`)
- A new Help button in the bottom taskbar toggles the checklist on demand and a centralized task watcher subscribes to the message, project, agent, 3D, and billing stores to auto-detect completion without scattering tracking calls across the app. (`6f91ff3`, `e5d310e`)
- Empty chats now surface four clickable prompt suggestion chips with a subtle pulsing glow on the input bar, and the Agents and Tasks empty states were rewritten with clearer guidance on what to do first. (`11fc116`, `779d737`)

## 5:41 AM — Checklist correctly ignores pre-existing agents and projects

Follow-up fixes make the new onboarding checklist trigger only on genuinely new user actions and let it open the agent editor directly.

- The checklist's "Create an agent" row now opens the agent editor modal directly via a new createAgentModalOpen flag on the agent store, instead of just routing to the agents page. (`0d96fae`)
- The task watcher now snapshots a baseline count of existing agents and projects so onboarding only completes when the user actually creates something new, rather than auto-ticking for accounts that already had data. (`2f9dbb1`, `8d0ab5a`)

## 6:14 AM — Server defaults REQUIRE_ZERO_PRO to off when unset

A small but important server config fix prevents the Zero Pro requirement from accidentally engaging when its environment variable isn't set.

- aura-os-server now defaults require_zero_pro to false when the environment variable is unset, matching expected behavior for standard deployments. (`ae418f3`)

## 12:19 PM — Mixpanel token wired into desktop and mobile nightly builds

Release pipeline updates ensure analytics and Zero Pro defaults are correct for the new onboarding instrumentation shipping in nightly builds.

- Desktop builds now default REQUIRE_ZERO_PRO to false at build time, aligning the desktop client with the server-side default. (`d987125`)
- The desktop and mobile nightly GitHub Actions workflows now forward VITE_MIXPANEL_TOKEN into the build environment so today's onboarding analytics events actually report from packaged nightly builds. (`814d663`, `a60654c`)

## Highlights

- New welcome modal and 5-task onboarding checklist
- Prompt suggestions and pulsing input on empty chat
- Mixpanel analytics token now wired into desktop and mobile nightly builds

