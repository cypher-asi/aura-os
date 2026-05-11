# Searchable agent picker, sturdier provisioning, and a calmer media pipeline

- Date: `2026-05-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.495.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.495.1

Today's nightly reshapes how you add agents to a project — the old card grid is gone, replaced by a Telegram-style searchable list with keyboard navigation and a one-keystroke Standard Agent shortcut. Around that headline change, remote agent startup now self-heals once before bothering you, the Windows installer's theme handling got two real fixes, and the release-media workflow stops taking the whole job down when a third-party API runs out of credits.

## 11:23 PM — Add Agent picker rebuilt as a searchable list

The project Add Agent flow is now a single Telegram-style picker with search, keyboard nav, and a one-press Standard Agent shortcut — plus fixes to session selection and the Windows installer's themed assets.

- Replaced the grid-of-cards AgentSelectorModal with a new searchable AgentSelectorList: autofocused search, a Standard Agent row pinned to the top, arrow-key + Enter navigation, hover sync, and per-row spinners during create. The old '+ Create New Agent' footer and separate AgentEditorModal are gone — pressing Enter on the Standard row hits the same default-create endpoint the project '+' used to fire silently. (`7ce6561`, `33f0a1f`, `49890ce`, `462dbbc`, `4c2eaff`, `637d190`)
- Fixed a sessions bug where a brand-new chat would briefly read as unselected after the optimistic→real id swap; SessionsList now falls back to the newest row in the surface during that window so the just-created session stays highlighted. (`c128b77`)
- Remote agents that fail their initial provisioning readiness check now auto-recover once in the background and, if that still fails, surface the real swarm reason (e.g. Unschedulable PodScheduled) in both the StatusCard banner and manual Recovery errors instead of hanging on 'Starting up…'. (`f365e3a`)
- Windows installer now stages dark and light themed bitmaps directly into $PLUGINSDIR (no more root-relative writes from .onInit), swaps the header bitmap at GUI init in light mode, applies the dark title-bar hook to the uninstaller, and fails the build with a clear error if the bitmap naming convention is broken. Chat attachments also now accept .json and .sql files. (`649fa9f`, `4aaeec5`)

## 3:34 AM — Picker polish, project navigation, and a CEO-only capability fix

Follow-up fixes harden the new Add Agent modal, improve project sidebar navigation, add a GLB download to the 3D viewer, and roll back an accidental 'all agents get full access' regression.

- Reverted a regression where every newly created agent inherited full_access capabilities; the blanket empty→full_access promotion is now restricted to the CEO bootstrap, and non-CEO agents once again start with an empty bundle and opt in via the Permissions tab. (`8dcebab`)
- Add Agent modal no longer gets stuck: stale busy state could trap users by blocking Close/Escape and disabling Create indefinitely — close always works now and Create is only disabled during an active API call. (`638aedb`)
- Project sidebar auto-expands to reveal the active agent when you navigate into a project (e.g. switching from the Agents app), and session rows now show the project name when sessions span multiple projects. (`838e63e`, `1c473d6`)
- Chat now shows a helpful error when an agent has no project assigned instead of failing silently, and the aura3d WebGL viewer gained a Download button to save the generated GLB. (`182213c`, `25bb812`)

## 9:33 AM — Windows uninstaller GUI-init callback fix

Unblocked makensis builds that were aborting on the uninstaller's GUI-init hook.

- Renamed the uninstaller's GUI-init callback to use the required `un.` prefix (AuraUnOnGUIInit → un.AuraOnGUIInit) so MUI_LANGUAGE no longer aborts expansion of MUI_UNFUNCTION_GUIINIT, with an inline note documenting the NSIS constraint to prevent regressions. (`b0c6b23`)

## 9:58 AM — Project agent picker stabilization and Terminal-by-default sidekick

A second pass on the new picker stops it from resizing or flashing empty mid-selection and shows the full org fleet; Projects also reliably lands on the Terminal tab again.

- Agent picker now passes the active org id to api.agents.list() so teammates' shared agents appear (matching the Agents app sidebar), locks the modal's vertical footprint with a 360px floor across loading/empty/list states, and keeps the just-selected row visible through the create+handoff transition to prevent the 'No agents match your search.' flash. (`250ebd0`)
- Projects' sidekick panel now forces the Terminal tab on app entry, so a previous click on Sessions — or writes from the Tasks app or spec-generation stream — no longer sticks across reloads. Switching tabs inside a session still persists as before. (`36d4606`)
- Renamed the project sidebar's agent context-menu action to 'Remove from Project' to match the existing modal copy and make the project-scoped nature of the action obvious. (`86811df`)

## 10:26 AM — Changelog-media pipeline tolerates Browser Use credit outages

Release-media CI no longer goes red when a paid API runs out of credits — failures are clearly tagged by provider and Browser Use credit exhaustion now degrades gracefully.

- Every Anthropic, OpenAI, and Browser Use call in the publish-release-changelog-media pipeline now routes through a shared helper that prefixes the failing provider and names the env var to top up (e.g. `[Browser Use] credit balance is too low (top up the account tied to BROWSER_USE_API_KEY …)`), so CI logs always identify which account needs attention. (`6529e86`)
- A low Browser Use balance used to crash the entire workflow on the first capture; it now flips remaining candidates to a `blocked` result with the credit message, emits a `browser-use-credit-exhausted` progress event, exits 0, and lets the downstream gh-pages publish step no-op cleanly. Non-credit failures still throw. (`4392204`)

## Highlights

- Searchable, keyboard-driven Add Agent picker
- Remote agents auto-recover once on provisioning failure
- Windows installer themed-bitmap and uninstaller fixes
- Changelog media pipeline survives Browser Use credit outages

