# First-run onboarding lands across the Aura desktop shell

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.435.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.435.1

Today's nightly is a focused onboarding release: new users now get a guided welcome flow, a persistent progress checklist, and an always-available help entry point in the taskbar — all wired into the desktop shell across Mac, Windows, and Linux builds.

## 4:33 AM — Guided first-run onboarding for new Aura users

A complete onboarding experience now greets new users with a welcome modal, a progress checklist, and automatic task tracking wired into the desktop shell.

- New users are now welcomed by a 2-step intro modal showing the AURA logo and a preview of getting-started tasks on first login, with a skip option and analytics tracking. Onboarding state persists per user via a Zustand store backed by localStorage, so progress survives reloads and is scoped to each account. (`bd80420`, `988eee6`)
- A floating, collapsible checklist widget anchored to the bottom-right of the desktop guides users through five concrete first tasks — sending a message, creating a project, creating an agent, generating an image with AURA 3D, and exploring plans & credits — with a progress bar and click-through navigation to each feature. (`708e75e`, `bd80420`)
- Checklist items now tick off automatically: a centralized task watcher subscribes to the message, projects, agents, 3D, and billing stores and emits per-task and completion analytics events, so users never have to manually mark progress. (`6f91ff3`)
- A new Help button sits in the BottomTaskbar between Settings and Profile, letting users reopen the checklist after dismissing it or restart onboarding once it's complete. The welcome modal, checklist, and watcher are mounted in AppShell behind lazy boundaries, and a small CSS fix re-centers task icons with their labels in the welcome preview. (`e5d310e`, `ec62961`)

## Highlights

- New 2-step welcome modal on first login
- Floating 5-task onboarding checklist with auto-completion
- Help button added to the bottom taskbar
- Per-user onboarding progress persisted in localStorage

