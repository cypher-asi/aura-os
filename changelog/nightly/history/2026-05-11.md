# Stable channel rescue, a rebuilt agent picker, and steadier sessions

- Date: `2026-05-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.496.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.496.1

Today's nightly leans heavily on reliability: a critical fix stops the Stable installer from silently behaving as a Dev build, the Add Agent flow is rebuilt around a searchable Telegram-style picker, and a string of smaller corrections tightens session selection, sidebar navigation, and Windows installer packaging. The release-media pipeline also learns to fail more gracefully when third‑party API credits run dry.

## 11:23 PM — Searchable Add Agent picker and a steadier new-session highlight

A multi-commit rebuild replaces the grid-of-cards Add Agent modal with a Telegram-style searchable list, while fixes land for new-session selection and Windows installer theming.

- Rebuilt the project Add Agent modal as a searchable list with a Standard Agent row at the top, live name/role filtering, arrow-key + Enter navigation, per-row spinners during create, and a row-based Telegram-style layout that adapts between the desktop Modal and the mobile Drawer. The project-row '+' now routes through the same picker instead of silently creating a generic agent. (`4c2eaff`, `462dbbc`, `7ce6561`, `33f0a1f`, `49890ce`, `637d190`)
- Fixed a regression where a freshly created chat session would appear at the top of the sessions list but read as unselected during the brief window between the optimistic→real ID swap and the URL update; the list now falls back to the newest row across the swap. (`c128b77`)
- Hardened remote agent provisioning so a brand-new agent that times out or errors during initial readiness auto-recovers once, surfaces the underlying swarm reason (e.g. Unschedulable PodScheduled) in the StatusCard, and exits the indeterminate 'Starting up…' state instead of hanging. (`f365e3a`)
- Windows installer now stages dark/light themed bitmaps into the plugin dir, swaps the header bitmap correctly in light mode, and applies the dark title-bar hook to the uninstaller; chat attachments also accept .json and .sql files. (`649fa9f`, `4aaeec5`)

## 3:34 AM — Permission scope correction and project sidebar polish

A capability-leak fix walks back blanket full-access defaults to CEO-only, alongside several small but visible improvements to chat errors, sidebar navigation, and the 3D viewer.

- Reverted a regression that silently granted every newly created agent full capabilities; non-CEO agents once again start with an empty bundle and must opt into permissions explicitly via the Permissions tab. CEO bootstrap and project-scoped splicing are unchanged. (`8dcebab`)
- Add Agent modal no longer becomes unresponsive: the close button and Escape work even mid-transition, and Create is only disabled during an active API call instead of being stuck by stale state. (`638aedb`)
- Sidebar now auto-expands the project containing the active agent when navigating in from elsewhere, and session rows show their project name when sessions span multiple projects. (`838e63e`, `1c473d6`)
- Chat surfaces a clear error when an agent isn't assigned to a project, and the Aura 3D viewer gains a Download button to save the generated GLB file. (`182213c`, `25bb812`)

## 9:33 AM — Windows uninstaller no longer aborts at install time

An NSIS callback-naming fix unblocks the Windows installer build.

- Renamed the uninstaller's GUI-init callback to the required `un.`-prefixed form so makensis stops aborting while expanding MUI_LANGUAGE, restoring a clean Windows installer build. (`b0c6b23`)

## 9:58 AM — Project agent picker stops resizing and shows the full org fleet

Follow-up polish for the new Add Agent picker stabilizes its layout and broadens which agents it surfaces, plus two small project-sidebar fixes.

- Project Add Agent picker now keeps a fixed 360px vertical footprint across loading, empty, and loaded states, and keeps a just-clicked row visible through the create-and-handoff transition so it no longer flashes 'No agents match your search.' (`250ebd0`)
- Picker now fetches the full org-wide agent fleet (matching the Agents app sidebar) instead of only agents authored by the current user, surfacing teammates' shared agents. (`250ebd0`)
- Project sidebar's agent context-menu delete is now labeled 'Remove from Project' to match the modal copy, and Projects reliably lands on the Terminal tab on entry instead of inheriting a stale tab from Tasks or spec generation. (`86811df`, `36d4606`)

## 10:26 AM — Stable channel no longer ships as Dev, and changelog-media survives credit outages

A critical channel-selection fix prevents the published Stable installer from running as a Dev binary, paired with CI hardening so release-media credit failures don't redden the whole workflow.

- Fixed a long-standing Cargo feature-unification bug that caused the published 'AURA' Stable installer to silently run as Dev — wrong data dir (`aura-dev`), 'AURA Dev' window title, disabled in-app updater, and a Dev-shaped single-instance mutex that made two launches collide. Every internal `aura-os-core` dependency now opts out of defaults across 17 crates, `Channel::current()` prefers Stable, and a new `--print-channel` self-check in `verify-desktop.mjs` fails the release if a Stable build doesn't self-report Stable. (`f64e077`)
- Added a one-shot migration so users coming off a Dev-in-disguise Stable build don't lose their data: on first Stable launch, an existing `aura-dev` store and skills tree is moved to the canonical `aura` location, gated by a marker file so it runs exactly once. (`f64e077`)
- Release-media CI now tags every Anthropic, OpenAI, and Browser Use failure with the failing provider and the env var to top up, and a low Browser Use balance downgrades to a warning — candidates are marked `blocked`, the SDK is skipped for the rest of the run, and the workflow exits 0 instead of taking the whole job red. (`6529e86`, `4392204`)

## Highlights

- Stable desktop builds no longer ship as Dev-in-disguise
- Add Agent gets a searchable, keyboard-driven picker
- Windows NSIS installer themed bitmaps and uninstaller fixes
- Changelog-media CI degrades gracefully on credit exhaustion

