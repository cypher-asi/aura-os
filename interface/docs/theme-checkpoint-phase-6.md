# Theme + Cleanup — Phase 6 Checkpoint

This document captures the post-Phase-6 validation snapshot for the
`theming/phases-1-14` branch. After this checkpoint the user will manually
smoke-test the app using `interface/docs/theme-smoke-checklist.md`.

## Phase 1-5 commit history

| Phase | Commit      | Summary                                                                                              |
| ----- | ----------- | ---------------------------------------------------------------------------------------------------- |
| 1     | `e4a35e7d2` | Extract app tokens, de-darkify shell, dynamic highlight.js theme                                     |
| 2     | `43d01ee52` | Settings > Appearance section + titlebar Sun/Moon quick toggle                                       |
| 3     | `7f6bb743f` | Token-debt remediation in process canvas + xterm (`getXtermTheme`)                                   |
| 4     | `e57e0be5b` | Code-rule cleanups: named exports, mobile chat per-component folders, drop deprecated Context shim   |
| 5     | `78c08f294` | Split three largest files: `PermissionsTab/`, `aura-events/`, `stores/notes/` barrels                |
| 6     | _(pending)_ | Validation tests, smoke checklist, and this checkpoint summary                                       |

## Automated gate results

All commands run from `interface/`.

### `npx tsc -b`

**Clean.** No TypeScript errors. Verified at HEAD with the Phase 6 test
additions and the `usePermissionsAutosave.ts` lint fix.

### `npm run lint`

| Metric   | Phase 1 baseline | Phase 4 (`e57e0be5b`) | Phase 5 (`78c08f294`) | Phase 6 HEAD |
| -------- | ---------------- | --------------------- | --------------------- | ------------ |
| Errors   | 219              | 219                   | 219                   | **219**      |
| Warnings | 34               | 34                    | 35                    | **34**       |

**Delta vs Phase 1 baseline: 0 errors / 0 warnings introduced.**

A `react-hooks/exhaustive-deps` warning was introduced by Phase 5 when
`draftRef` / `lastSavedRef` became hook arguments instead of locally
declared `useRef`s in `usePermissionsAutosave.ts` — this caused the
lint rule to flag the cleanup function's intentional latest-value
read. Fixed in Phase 6 by:

- Adding a targeted `eslint-disable-next-line react-hooks/exhaustive-deps`
  with a justification comment on the unmount-flush call (the latest-value
  read at unmount is intentional behaviour, not a bug).
- Removing a now-unused `eslint-disable-next-line react-hooks/set-state-in-effect`
  directive whose underlying call no longer triggered the rule after the
  Phase 5 split.

All remaining 219 errors and 34 warnings are pre-existing and unchanged
across phases 1-5.

### `npm run test`

| Metric         | Phase 4 (`e57e0be5b`) | Phase 6 HEAD |
| -------------- | --------------------- | ------------ |
| Test files     | 15 fail / 255 pass    | 15 fail / 255 pass |
| Tests          | 32 fail / 2,567 pass / 1 skip | 32 fail / 2,567 pass / 1 skip |

**Delta vs Phase 4: 0 new test regressions.**

All 32 test failures are pre-existing — verified by checking out
`e57e0be5b` (Phase 4 tip, before any Phase 5/6 changes) and re-running
the same failing files in isolation; the same 32 tests fail there.

The vitest worker also hits a JS heap OOM partway through the full
sweep (`FATAL ERROR: Ineffective mark-compacts near heap limit`).
Retrying with `--pool=forks` reproduces both the OOM and the same 32
deterministic failures, so the pool choice is not the cause. The OOM
appears unrelated to phases 1-5 (Phase 4 reproduces it identically).

Failing test files (all pre-existing, none caused by phases 1-5):

- `src/hooks/use-active-app.test.tsx` (mock setup issue with
  `getTaskbarHiddenAppIds`)
- `src/hooks/use-log-stream.test.ts` (4 tests — `task_title` undefined
  on event content fixture; aura-events split confirmed not the cause)
- `src/hooks/use-new-project-draft.test.ts` (2)
- `src/hooks/use-new-project-form.test.tsx` (7)
- `src/utils/derive-activity.test.ts` (1)
- `src/utils/markdown.test.ts` (1)
- `src/components/BottomTaskbar/BottomTaskbar.render-churn.test.tsx` (1)
- `src/components/BuyCreditsModal/BuyCreditsModal.test.tsx` (1)
- `src/components/DesktopShell/DesktopShell.test.tsx` (2)
- `src/components/OrgSettingsBilling/OrgSettingsBilling.test.tsx` (4)
- `src/components/Sidekick/Sidekick.test.tsx` (3)
- `src/components/ToolRow/ToolRow.test.tsx` (1)
- `src/shared/api/orgs.test.ts` (1)
- `src/shared/api/terminal.test.ts` (3)
- `src/views/HomeView/HomeView.test.tsx` (1)

The Phase 6 scoped re-runs all pass:

- `src/views/SettingsView/...` — 5 files, 12 tests pass (includes the
  new SettingsView smoke test asserting the appearance panel renders
  alongside the about panel, plus the new AppearanceSection assertion
  that toggling theme persists to `localStorage`).
- `src/apps/agents/AgentInfoPanel/PermissionsTab/...` — 1 file, 7 tests
  pass (post-Phase-5 split, behaviour preserved).
- `src/apps/notes/...` + `src/stores/notes/...` — 8 files, 42 tests
  pass (post-Phase-5 store split).

### `npm run build`

**Clean.** Vite 8 build completes in ~2.3s with 5,248 modules transformed.
No errors, no warnings.

Notable bundle artefacts confirming phases 1-5 land cleanly:

- `dist/assets/AppearanceSection-*.css` — Phase 2 component styles
  bundled (1.07 kB / 0.48 kB gzip).
- `dist/assets/github.min-*.css` (1.06 kB) **and**
  `dist/assets/github-dark.min-*.css` (1.06 kB) — Phase 1's dynamic
  `?url` highlight.js imports both resolve to separate CSS chunks
  exactly as intended.
- `dist/assets/notes-store-*.js` (6.55 kB) — Phase 5 split barrel
  composes correctly.
- `dist/assets/BrowserPanel-*.js` (18.95 kB) — Phase 4 named-export
  conversion still chunked separately via the lazy import in
  `SidekickContent`.
- `dist/assets/AgentInfoPanel-*.js` (103.14 kB) — Phase 5
  `PermissionsTab/` folder split links into the expected chunk.

Largest chunks (gzip): `vendor-*.js` 385.90 kB, `framework-*.js`
202.55 kB, `terminal-vendor-*.js` 143.91 kB, `highlight-vendor-*.js`
94.46 kB. These are unchanged vs Phase 4 within rounding.

## Regressions found and fixed in Phase 6

1. **`react-hooks/exhaustive-deps` false-positive** in
   `usePermissionsAutosave.ts` (Phase 5 fallout). Fixed by adding a
   targeted `eslint-disable-next-line` with a justification comment on
   the cleanup ref read; removing the now-stale `set-state-in-effect`
   disable on the agent-id reset effect.

No build, typecheck, or runtime regressions were found.

## Pre-existing issues the user should know about

These are **NOT** caused by phases 1-5 and were already present at
the Phase 4 (or earlier) tip:

- 32 deterministic test failures across 15 files (listed above) —
  most look like fixture / mock drift unrelated to theming.
- Vitest worker heap OOM during the full sweep. The OOM does not
  affect headless gates we care about (lint / tsc / build) and only
  surfaces as part of the wide-suite execution. It is reproducible
  across `--pool=threads` and `--pool=forks`.
- 219 pre-existing lint errors and 34 warnings (a mix of
  `@typescript-eslint/no-unused-vars` on intentionally-prefixed
  `_args`, `react-hooks/exhaustive-deps`, and a few
  `react-hooks/set-state-in-effect` advisories). These are tracked
  for future cleanup but are out of scope for this PR.

## Working tree

After Phase 6 commit, the working tree is clean. Phase 6 modifies
only:

- `interface/src/views/SettingsView/SettingsView.test.tsx` (smoke test)
- `interface/src/views/SettingsView/AppearanceSection/AppearanceSection.test.tsx` (localStorage assertion)
- `interface/src/apps/agents/AgentInfoPanel/PermissionsTab/usePermissionsAutosave.ts` (lint suppression cleanup)
- `interface/docs/theme-smoke-checklist.md` (new — this checkpoint's manual checklist)
- `interface/docs/theme-checkpoint-phase-6.md` (new — this file)

## Next steps

Phases 7-14 are scoped in
`c:\Users\n3o\.cursor\plans\theming_+_frontend_cleanup_pass_211f942d.plan.md`
but **awaiting user guidance** before implementation. They are:

- **Phase 7** — Richer theming editor (custom border/panel/sidebar tokens
  editable from Settings, persisted in `localStorage["aura-theme-overrides"]`).
- **Phase 8** — Named theme presets + JSON import/export.
- **Phase 9** — CSS token migration sweep for high-debt modules
  (`SidekickLog`, `ChatInputBar`, `IdeView`, `Preview`, `LeftMenuTree`,
  `BrowserAddressBar`, `AgentEnvironment`, `TaskOutputPanel`, billing
  modal). Adds a CI guard that grep-rejects raw `#hex` / `rgb()` /
  `rgba()` literals in `*.module.css`.
- **Phase 10** — File splits, tier 2 (>500 lines remaining):
  `use-chat-history-sync.ts`, `AgentEnvironment.tsx`, `ChatPanel.test.tsx`,
  `entities.ts`, `lifecycle.ts` (+ adjacent `handlers.test.ts`).
- **Phase 11** — Promote `SettingsView` to a `Navigator`-driven sectioned
  layout once we have ≥3 sections; add deep-linkable
  `/settings/:section` routes.
- **Phase 12** — Mobile quick-toggle for theme.
- **Phase 13** — Consolidate the chat-streaming hook cluster
  (`use-chat-stream`, `use-agent-chat-stream`, `use-standalone-agent-chat`,
  `hooks/stream/*`). Needs a design pass and architecture mini-doc
  before any code moves.
- **Phase 14** — A11y cleanup of the global `* { outline: none }` rule
  in `index.css`; restore visible keyboard focus per-component using
  `--color-focus-ring`.

The user has indicated they want to manually smoke-test phases 1-5 via
`interface/docs/theme-smoke-checklist.md` before approving phases 7-14.
