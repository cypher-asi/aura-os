# First-run onboarding lands across the desktop app

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.437.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.437.1

Today's nightly is almost entirely a new-user onboarding push: a guided welcome flow, a persistent progress checklist, friendlier empty states, and a chat that actively invites the first message. A small server-side default for self-hosted deployments rounds out the day.

## 4:33 AM — Guided onboarding: welcome flow, checklist, and emptier-feeling screens get a fix

A full first-run experience lands, from the initial welcome modal through a persistent task checklist to friendlier empty states across chat, agents, and tasks.

- Introduced a per-user onboarding store (Zustand + localStorage) that tracks the welcome flow and a 5-task checklist — send a message, create a project, create an agent, generate an image with AURA 3D, and explore plans & credits. (`bd80420`)
- Added a two-step welcome modal shown on first login, featuring the AURA logo, an intro message, and a preview of the onboarding checklist, with a skip option and analytics tracking. (`988eee6`, `ec62961`)
- Shipped a floating, collapsible checklist widget pinned to the bottom-right with a progress bar; each row deep-links into the matching feature, and a new Help button in the bottom taskbar toggles or reopens it. (`708e75e`, `6f91ff3`, `e5d310e`)
- Empty chat threads now display four clickable prompt suggestion chips and a subtle pulsing glow on the input bar to invite a first message, both disappearing as soon as the user sends one. (`11fc116`)
- Rewrote the agent and task empty states with more descriptive guidance — e.g. "Create your first AI agent to start chatting, automating tasks, and more" instead of the old "Add an agent to get started." (`779d737`)

## 5:41 AM — Onboarding progress detection stops counting pre-existing agents and projects

Follow-up fixes to the new onboarding watcher so the checklist only credits genuinely new user actions, not the default agent or project that ships with a fresh account.

- Wired the checklist's "Create an agent" row to open the agent editor modal directly via a new createAgentModalOpen flag on the agent store. (`0d96fae`)
- Reworked the task watcher to only complete create_agent and create_project when counts increase after mount, capturing a baseline so users with a default agent or project no longer see those steps auto-checked on first launch. (`2f9dbb1`, `8d0ab5a`)

## 6:14 AM — Self-hosted server defaults require_zero_pro to off

A small but meaningful server-side default change for operators running Aura without the corresponding env var configured.

- The Aura OS server now defaults require_zero_pro to false when the environment variable is unset, avoiding accidental gating on self-hosted deployments. (`ae418f3`)

## Highlights

- New welcome modal and 5-step onboarding checklist
- Empty chat now shows prompt suggestions and a pulsing input
- Auto-detection of onboarding progress, refined to ignore pre-existing data
- Friendlier empty states for agents and tasks
- Self-hosted server defaults require_zero_pro to false

