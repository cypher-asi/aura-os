# A searchable agent picker, a stable channel rescue, and sharper release diagnostics

- Date: `2026-05-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.497.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.497.1

Today's nightly centers on a redesigned project agent picker — now a searchable, keyboard-driven list backed by the full org fleet — plus a critical fix that stops stable installers from silently running as Dev. Smaller polish lands across chat, sessions, the 3D viewer, the marketplace, and the release-media pipeline.

## 11:23 PM — Searchable agent picker replaces the project sidebar's card grid

The project '+' flow now opens a single keyboard-driven picker with a Standard Agent shortcut, plus fixes for new-chat selection, installer theming, and remote-agent provisioning.

- Replaced the Add-Agent card grid with a Telegram-style searchable list: an autofocused search input, a Standard Agent row at the top, live name/role filtering, arrow-key + Enter navigation, and per-row spinners during create. The redundant '+ Create New Agent' footer and its editor modal are gone — a generic agent now spawns with one Enter inside the picker. (`4c2eaff`, `462dbbc`, `7ce6561`, `33f0a1f`, `49890ce`, `637d190`)
- Newly created chat sessions now stay highlighted in the sidebar across the optimistic-to-real ID swap, closing a window where the just-sent session briefly read as unselected after SessionReady. (`c128b77`)
- Remote agents that fail their initial provisioning readiness check now auto-recover once and, if recovery fails, surface the actual swarm error (e.g. an Unschedulable pod reason) in the StatusCard instead of sitting forever on "Starting up...". (`f365e3a`)
- Chat attachments now accept .json and .sql files, and the Windows installer correctly stages its themed dark/light bitmaps from $PLUGINSDIR with the dark title-bar hook applied to the uninstaller as well. (`4aaeec5`, `649fa9f`)

## 3:34 AM — Sidebar navigation, 3D export, and a CEO-only permissions correction

Mid-day polish across the Projects sidebar and chat, a GLB download in the 3D viewer, a tightened default-permissions rule, and a Windows installer build fix.

- Projects sidebar now auto-expands to reveal the active agent when navigating in from elsewhere, session rows display their project name when results span multiple projects, and the Add Agent modal no longer gets trapped in a stale busy state that blocked Close, Escape, and Create. (`838e63e`, `1c473d6`, `638aedb`)
- Chat now shows a helpful error when a message is sent to an agent not assigned to a project, instead of failing silently in the stream lifecycle. (`182213c`)
- Aura 3D's WebGL viewer gained a Download button on its toolbar so users can save the generated GLB directly, using the same desktop-webview-friendly anchor pattern as Gallery and Model3DBlock. (`25bb812`)
- Reverted an over-broad rule that had been promoting every empty capability bundle to full_access — non-CEO agents now keep their empty bundle and opt in through the Permissions tab, while the CEO bootstrap and project-scoped self-caps are preserved. (`8dcebab`)
- Windows installer build no longer aborts in makensis: the uninstaller's GUI-init callback is now correctly prefixed with `un.` so MUI_LANGUAGE expansion succeeds. (`b0c6b23`)

## 9:58 AM — Agent picker stability and Projects entry-point polish

Follow-up fixes that lock the new picker's size, broaden it to the full org fleet, and restore predictable defaults around the Projects sidebar.

- The project Add-Agent picker now queries the full org fleet (matching the Agents app sidebar) instead of only the current user's authored agents, and a 360px-floor `.pickerBody` prevents the modal from resizing between loading, loaded, and post-selection states. Recently selected rows stay visible during the create+handoff transition to eliminate the empty-state flash. (`250ebd0`)
- The agent context-menu action in the Projects sidebar is now labeled "Remove from Project" to match the existing modal copy and make project-scoped removal unambiguous. (`86811df`)
- Projects now reliably lands on the Terminal tab on entry: the shared sidekick store was being polluted by Tasks and the spec-generation stream, so ProjectMainPanel forces `setActiveTab("terminal")` once per mount while still respecting later user navigation. (`36d4606`)

## 10:26 AM — Stable channel rescue and resilient changelog-media pipeline

A long-running release-quality thread: the stable installer was silently running as a Dev binary, and the changelog-media workflow learned to identify and tolerate credit exhaustion at third-party providers.

- Fixed a Cargo feature-unification bug that had been shipping the "AURA" stable installer as a Dev binary in disguise — same dev mutex, `aura-dev` data dir, "AURA Dev" window title, and disabled in-app updater. Every internal `aura-os-core` dep now opts out of default features, `Channel::current()` prefers `stable-channel` when both are active, and a new `--print-channel` self-check in `scripts/ci/verify-desktop.mjs` fails the release lane if the built binary doesn't self-report Stable. A one-shot, marker-guarded migration moves user state from `aura-dev` to `aura` for affected installs. (`f64e077`)
- Every paid-API failure in the publish-release-changelog-media workflow (Anthropic, OpenAI, Browser Use) now flows through a shared `wrapProviderError` helper that prefixes the failing provider and names the env var to top up, so CI logs are unambiguous about which account needs attention. (`6529e86`)
- A low Browser Use balance no longer reds the entire media workflow: the first credit-low error converts the candidate to a `blocked` result, short-circuits remaining candidates, emits a `browser-use-credit-exhausted` progress event, and exits 0 so the downstream gh-pages publish no-ops cleanly. (`4392204`)

## 11:51 AM — 3D style-lock restoration and marketplace creator avatars

Late-day product touches: re-applying the 3D style lock only where it belongs, and giving marketplace cards a recognizable author.

- Restored `STYLE_LOCK_SUFFIX` on the implicit 3D-source image paths — chat 3D mode's image step (in both `useChatStream` and `useAgentChatStream`) and the standalone Aura 3D ImageGeneration flow — while leaving chat /image and all other free-form image sends untouched. (`eff2466`)
- Marketplace agent talent cards now show the creator's avatar and name as a third column on the Tasks/Revenue stats row, plumbed through the existing MarketplaceAgent DTO instead of per-card client lookups, with the shared Avatar fallback for creators without a photo. (`820a430`)

## Highlights

- Project agent picker reborn as a searchable Telegram-style list
- Stable installer no longer ships as a Dev binary in disguise
- Remote agents auto-recover once on provisioning failure
- Release-media pipeline names the provider that ran out of credits

