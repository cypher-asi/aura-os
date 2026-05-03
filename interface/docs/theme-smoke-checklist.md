# Theme + Cleanup Smoke Checklist (Phases 1-14)

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

## Keyboard / a11y (new in Phase 14)

The Phase 14 a11y pass replaced the old global
`*, *:focus, *:focus-visible { outline: none !important; }` rule in
`interface/src/index.css` with a single `:focus-visible` base rule. Mouse
clicks no longer trigger focus rings (per modern `:focus-visible`
semantics); keyboard-driven focus does.

- [ ] Tab through the app — every interactive element shows a visible focus ring (white in dark mode, near-black in light mode).
- [ ] Click anywhere with the mouse — no focus ring appears (focus-visible only triggers on keyboard).
- [ ] Open a modal (Org Settings / Buy Credits / Skill Shop / New Project), Tab through its controls — focus ring visible on each, including the close button.
- [ ] Open Settings → Appearance, Tab through theme buttons / accent swatches / custom-token rows / preset controls — focus ring visible everywhere.
- [ ] DesktopTitlebar + MobileTopbar buttons — focus visible.
- [ ] AgentWindow titlebar buttons (focus / close / minimize) — focus visible.
- [ ] ChatInputBar send + attachment buttons — focus visible. The textarea itself intentionally suppresses the outline; the surrounding `inputContainer` brightens its border via `:focus-within` instead.
- [ ] Mobile: tap a row, then use a Bluetooth keyboard if available — focus ring visible.
- [ ] Confirm `interface/src/index.css` no longer contains `outline: none !important` (the line that was suppressing every focus ring globally pre-Phase-14).
