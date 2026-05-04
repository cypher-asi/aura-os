# First-run onboarding lands across the app

- Date: `2026-05-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.436.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.436.1

Today's nightly is focused entirely on first-run experience: a new onboarding system guides fresh accounts from welcome modal to first message, project, agent, image, and billing visit, while empty states and the chat input get nudges to make the blank canvas feel less empty. A follow-up fix tightens detection so the checklist only credits genuinely new work.

## 4:33 AM — Guided onboarding: welcome modal, checklist, and empty-state nudges

A complete first-run experience now ships in the desktop interface, from a 2-step welcome modal to a persistent checklist, auto-detected progress, and friendlier empty states across chat, agents, and tasks.

- Introduced a per-user onboarding store with localStorage persistence and a 5-task checklist (send a message, create a project, create an agent, generate an image, explore billing), paired with a 2-step welcome modal that shows the AURA logo, intro copy, and a checklist preview on first login. (`bd80420`, `988eee6`, `ec62961`)
- Added a floating, collapsible checklist widget anchored above the bottom taskbar with a progress bar and per-task navigation, plus a Help button in the taskbar that toggles, reopens, or resets the checklist depending on its state. (`708e75e`, `6f91ff3`)
- A central task watcher subscribes to the message, projects, agents, 3D, and billing stores to auto-complete checklist items and emit onboarding analytics, and the welcome modal, checklist, and watcher are now wired into AppShell with the Help button mounted in the BottomTaskbar. (`6f91ff3`, `e5d310e`)
- Empty chats now show four clickable prompt suggestion chips with a subtle pulsing glow on the input bar, and the agents and tasks empty states were rewritten with descriptive guidance that explains each feature and encourages a first action. (`11fc116`, `779d737`)

## 5:41 AM — Checklist credits only genuinely new agents and projects

Quick follow-ups make the onboarding checklist trigger the agent editor directly and stop falsely completing tasks just because a default agent or project already exists.

- The onboarding checklist can now open the create-agent editor directly via a new createAgentModalOpen flag on the agent store, so clicking 'Create an agent' jumps straight into the editor instead of a generic redirect. (`0d96fae`)
- Fixed a first-run bug where the checklist marked 'create a project' and 'create an agent' as done on launch because of pre-seeded defaults; detection now requires the project or agent count to actually increase during the session. (`2f9dbb1`)

## Highlights

- New welcome flow and 5-step onboarding checklist
- Prompt suggestions and pulsing input on empty chat
- Smarter task detection that ignores default agents and projects

