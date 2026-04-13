# TypeScript Rules (Cursor)

These rules apply to all TypeScript code in this repo (including React code), unless a more specific rule overrides them.

## GENERAL

- Use **TypeScript** everywhere (no `any` unless explicitly justified).
- Prefer **simple, readable code** over cleverness.
- Keep responsibilities small:
  - If a function can’t be described in one sentence, split it.
  - Prefer composition over configuration.
- Avoid unnecessary abstraction:
  - Don’t introduce generic frameworks/util layers until there are at least 2 real call sites.

## TYPES

- Prefer `type` aliases for unions/intersections; use `interface` for public object shapes meant to be extended.
- Avoid `enum` unless interoperating with external requirements; prefer string literal unions:
  - ✅ `type Status = "idle" | "loading" | "success" | "error"`
- Prefer explicit return types for exported functions, hooks, and public APIs.
- Use `unknown` instead of `any` when the input is not trusted; narrow via type guards.
- Don’t use non-null assertions (`!`) as a shortcut. Fix the type or handle the case.

## NAMING

- Use meaningful names:
  - Domain types: `Machine`, `Provider`, `Deployment`
  - DTOs/API: `MachineDto`, `ProviderResponse`
  - UI-friendly: `MachineViewModel` (only if truly needed)
- Avoid generic names like `Data`, `Info`, `Item` unless scoped tightly.

## FUNCTIONS & MODULES

- Prefer pure functions where possible.
- Keep modules cohesive:
  - A file should have one primary purpose.
  - Avoid “kitchen sink” utility files.
- Prefer `readonly` data where feasible (especially for constants/config).
- Prefer `const` over `let`. Only use `let` when reassignment is necessary.

## ERROR HANDLING

- Use typed error shapes where possible.
- Prefer returning a structured result over throwing for expected failures:
  - Example: `Result<T, E>` style, or `{ ok: true, value } | { ok: false, error }`
- Throw only for truly exceptional cases (programmer errors, invariants, unreachable states).

## ASYNC

- Prefer `async/await` over nested `.then()`.
- Don’t fire-and-forget Promises unless explicitly intended; handle errors.
- When doing parallel work, use `Promise.all` with careful error strategy.

## DATA VALIDATION

- Validate external inputs at boundaries:
  - API responses
  - user inputs
  - URL params
- Narrow types after validation and keep internals strongly typed.

## IMPORTS

- Prefer absolute imports (per your TS config) for cross-folder imports.
- Avoid circular dependencies:
  - `shared` must not import from `apps` or `features`.
  - `features` must not import from `apps`.

## TESTABILITY

- Move complex logic into pure functions or small utilities.
- Keep side effects at the edges (API modules, adapters).
- Prefer deterministic code paths; avoid time/random in logic unless injected.

## LINT / FORMAT

- No TypeScript errors.
- No unused exports.
- No dead code.
- Keep the codebase consistent with repo formatting/linting.
