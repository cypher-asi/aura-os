# React Component Rules (Cursor)

These rules define how we build UI, components, and front-end architecture.

## GENERAL

- Use **React + TypeScript only**
- **Function components only**
- One component = one responsibility
- If not describable in one sentence, split it
- Prefer composition over configuration
- Avoid unnecessary abstraction

## PROPS

- Props must be strongly typed
- Avoid boolean soup
  - Prefer discriminated unions or “variant” props over multiple booleans
- Controlled components use `value` + `onChange`
- Uncontrolled components use `defaultValue`
- Prefer `children`, slots, and subcomponents over flags

## STATE & EFFECTS

- Keep state closest to where it is used
- Do not lift state prematurely
- Render must be pure
- Side effects only in hooks (`useEffect`, `useLayoutEffect`, custom hooks)
- Derive state instead of duplicating it:
  - Prefer `useMemo`/computed values over extra `useState`

## ARCHITECTURE

- Separate **data orchestration** from **presentation**
  - Container/orchestrator components fetch data + handle domain orchestration
  - Presentational components render UI and accept data via props
- Shared UI must not know about:
  - routing
  - global stores
  - backend/API concerns
- Apps own their:
  - pages
  - data fetching
  - domain logic
- Features provide reusable functionality across apps
- Feature components may depend on app store but **not** app components

## FOLDER STRUCTURE RULES

- Organize by **app first**, then by feature
- Apps are top-level sections visible in the sidebar:
  - Machines, Providers, Keys, Deployments, Bootstrap
- Features are cross-cutting functionality used by multiple apps:
  - Terminal, Sidekick
- Dependency rules:
  - apps may depend on features and shared
  - features may depend on shared
  - shared must not depend on apps or features
- If a component is used only once, keep it in the app

## EXPECTED FRONT-END STRUCTURE

- All components have their own folder with tsx and css modules, etc.

## COMPONENT STRUCTURE

- Components must have their own folder
- One component per file
- Modular CSS per component
- `index.ts` re-exports only (no logic)

### EXPECTED COMPONENT FOLDER

Component
  Component.tsx
  Component.module.css
  Component.test.tsx
  index.ts

## STYLING

- Styles are local by default (CSS Modules or Tailwind)
- No inline styles except for **dynamic values computed at runtime**
  - e.g. width/height for resizable panels, progress bars, animation transforms
- Global CSS only for:
  - reset
  - typography
  - tokens
  - theme
- Use design tokens instead of hardcoded values

## NAMING

- App components use domain-specific names:
  - `MachineCard`, `ProviderList`
- Feature components use functionality-specific names:
  - `TerminalPanel`, `SSHTerminal`
- Shared UI uses generic names:
  - `Button`, `Modal`, `Card`
- Do not genericize until reused

## TESTABILITY

- Move complex logic to hooks or utilities
- Components should primarily render UI
- Prefer deterministic rendering:
  - Avoid time/random unless injected or mocked
- Keep side effects isolated and mockable (hooks/adapters)

## ACCESSIBILITY & UX BASELINES

- Use semantic HTML where possible
- Buttons must be `<button>` (not clickable `<div>`)
- Inputs must have accessible labels (or `aria-label` when appropriate)
- Don’t block keyboard navigation; ensure focus states remain visible

## PERFORMANCE

- Avoid premature memoization
- Use memoization when it’s proven to help:
  - expensive derived computations
  - stable callbacks passed deep to child trees
- Keep re-renders localized by keeping state local and components small
