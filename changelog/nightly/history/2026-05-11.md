# Searchable agent picker, sturdier Windows installer, and clearer recovery paths

- Date: `2026-05-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.493.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.493.1

Today's nightly centers on a redesigned Add Agent picker for projects — a Telegram-style searchable list with a one-key Standard Agent shortcut — alongside meaningful reliability work: the Windows installer's themed bitmaps and uninstaller callback are fixed, stuck remote agents now auto-recover and surface real swarm errors, and a regression that handed every new agent full capabilities is rolled back.

## 11:23 PM — Redesigned Add Agent picker with search and keyboard nav

The project Add Agent flow becomes a searchable Telegram-style list with a one-press Standard Agent shortcut, plus fixes for installer theming and stuck remote agents.

- The Add Agent modal swaps its grid of cards for an autofocused search input and a vertical list — a top 'Standard Agent' row plus the user's fleet — navigable with arrow keys and Enter, with case-insensitive filtering over name and role. The old '+ Create New Agent' footer and editor detour are gone; pressing Enter on the Standard row spawns a generic agent through the same endpoint the project-row '+' used to call directly. (`4c2eaff`, `462dbbc`, `7ce6561`, `33f0a1f`, `49890ce`, `637d190`)
- Fixed a long-standing glitch where a newly created session briefly appeared unselected after sending its first message: SessionsList now falls back to the newest row in the surface during the optimistic-to-real id swap window, so the freshly created chat stays highlighted across the transition. (`c128b77`)
- Windows installer now stages dark and light themed bitmaps directly into $PLUGINSDIR instead of root-relative paths, hardens light-bitmap derivation with explicit preprocessor errors, swaps the header bitmap at GUI init for light mode, and extends the dark title-bar hook to the uninstaller. (`649fa9f`)
- Remote agents that fail their initial provision no longer sit forever on 'Starting up…': the server now auto-recovers once on initial-provision failure, and if that also fails it broadcasts a terminal startup_failed state carrying the swarm's actual reason (e.g. an Unschedulable PodScheduled message) instead of a generic error, so the StatusCard exits limbo and shows manual Recovery with the real cause. (`f365e3a`)

## 3:34 AM — Chat, sidebar, and permissions polish

A cluster of fixes around chat errors, the projects sidebar, session rows, and a rolled-back permissions default.

- Chat now surfaces a helpful error when a message is sent to an agent that isn't assigned to a project, instead of failing silently. (`182213c`)
- The Add Agent modal can no longer get wedged: Close and Escape are no longer blocked by stale busy state, and the Create button is only disabled during an actual in-flight API call. (`638aedb`)
- Navigating into a project now auto-expands its tree in the sidebar to reveal the active agent, and session rows show their project name when the visible sessions span more than one project. (`838e63e`, `1c473d6`)
- Reverted a regression that quietly handed every new agent full capabilities: non-CEO agents once again start with an empty permission bundle and must opt in through the Permissions tab, while the CEO bootstrap and project-scoped self-caps splice are preserved. (`8dcebab`)

## 9:33 AM — Uninstaller GUI-init callback no longer aborts makensis

A second installer fix unblocks Windows builds by satisfying NSIS's naming rule for uninstaller callbacks.

- makensis was aborting while expanding MUI_LANGUAGE because the uninstaller's GUI-init callback was emitted as a Call inside the uninstaller section without the required 'un.' prefix. Renaming AuraUnOnGUIInit to un.AuraOnGUIInit at both the !define and the Function declaration restores the Windows installer build. (`b0c6b23`)

## 9:58 AM — Project agent picker stability and copy cleanup

Follow-up polish on the new Add Agent picker plus small but visible project-sidebar tweaks.

- The project Add Agent picker now shows the full org fleet (matching the Agents app sidebar) instead of only agents the current user authored, keeps a stable 360px-tall body across loading, empty, and loaded states, and no longer flashes 'No agents match your search' or hides the just-selected row during the create+handoff transition. (`250ebd0`)
- The Projects sidebar reliably opens on the Terminal tab again: ProjectMainPanel now pins the shared sidekick store to 'terminal' once per mount, so writes from the Tasks app or spec-generation stream no longer leak across reloads. (`36d4606`)
- The agent context-menu action in the Projects sidebar is now labeled 'Remove from Project', matching the existing modal copy and clarifying that the removal is project-scoped. (`86811df`)

## 10:26 AM — Changelog-media CI names the provider when credits run out

Release tooling now identifies which paid API account needs a top-up when the changelog-media workflow fails.

- Every HTTP/SDK failure in the publish-release-changelog-media pipeline now flows through a shared helper that prefixes the failing provider (Anthropic, OpenAI, or Browser Use) and names the env var to top up, so a low-credit error in CI logs reads like '[Browser Use] credit balance is too low (top up the account tied to BROWSER_USE_API_KEY …)' instead of an unattributed balance message. Non-credit failures also pick up the provider tag. (`6529e86`)

## Highlights

- New searchable, keyboard-driven Add Agent picker
- Windows installer no longer aborts on uninstaller GUI init
- Stuck remote agents auto-recover with a real error message
- Non-CEO agents go back to empty-by-default permissions

