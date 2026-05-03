# Theme + Cleanup Smoke Checklist (Phases 1-5)

Run `npm run dev` from `interface/` and step through:

## Theme switching

- [ ] Fresh install (clear `localStorage`) → app boots in dark with purple accent (unchanged default).
- [ ] Open Settings → switch to Light → entire shell, sidebar, sidekick, modals, terminal, process canvas, chat panel all readable. No white-on-white or black-on-black.
- [ ] Switch to System → app tracks OS preference. Toggle OS preference → app updates without reload.
- [ ] Reload page after each switch → choice persists.
- [ ] Titlebar Sun/Moon button cycles dark → light → system → dark with correct icon and aria-label.

## Accent

- [ ] Each accent (cyan / blue / purple / green / orange / rose) propagates to focus rings, accent buttons, agent badges.

## Surface coverage

- [ ] All `[role="dialog"]` modals (Org Settings, New Project, Skill Shop, Buy Credits) render with the resolved theme — no forced black backgrounds in light mode.
- [ ] Process canvas: nodes, edges, minimap, floating toolbar all readable in both modes.
- [ ] Terminal: live theme swap when toggling dark/light without remount; ANSI colors still legible.
- [ ] Chat panel + ChatInputBar: readable in both modes (note: ChatInputBar token migration is deferred to Phase 9; some hardcoded colors may still bleed).
- [ ] Highlight.js code blocks in chat use the matching highlight theme after toggle.

## Mobile

- [ ] Mobile settings view renders the same Appearance section.
- [ ] Mobile chat panel renders correctly after the folder restructure.

## Regression checks

- [ ] Browser panel still loads (default-export → named refactor).
- [ ] Agent permissions tab loads and saves edits (PermissionsTab folder split).
- [ ] Notes app: tree loads, content edits autosave (notes-store split).
