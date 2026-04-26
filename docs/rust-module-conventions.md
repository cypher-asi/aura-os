# Rust Module Conventions

This note captures the module-shaping rules used by the Rust refactor work.
The current tree already follows this pattern in several large areas, including
server handlers and storage API types, but older files may still need to be
split as they are touched.

## Size Budgets

| Unit | Soft Limit | Hard Limit |
| ---- | ---------- | ---------- |
| `.rs` file | 400 lines | 500 lines |
| function body | 50 lines | 80 lines |
| function parameter count | 5 | 7 |

The file-size rule is implemented by
[`scripts/lint-file-sizes.mjs`](../scripts/lint-file-sizes.mjs). Function body
and parameter limits are reviewer-enforced today.

## When To Split

- At 400+ lines, scan for a clear module boundary before adding more logic.
- At 500+ lines, split the file before merging additional feature work.
- Split by domain axis rather than by incidental helper type. For example,
  handlers usually split into route handlers, request/response types,
  conversions, persistence, streaming, and test support.

## Module Directory Pattern

When a single module grows beyond one cohesive concern, convert it to a
directory while preserving the public path:

```text
apps/aura-os-server/src/handlers/agents/chat.rs
  -> apps/aura-os-server/src/handlers/agents/chat/
       mod.rs
       agent_route.rs
       instance_route.rs
       request.rs
       streaming.rs
       loaders.rs
       tests/
```

`mod.rs` should contain declarations and explicit re-exports only:

```rust
mod agent_route;
mod instance_route;
mod request;
mod streaming;

pub(crate) use agent_route::send_agent_event_stream;
pub(crate) use instance_route::send_event_stream;
```

Keep business logic in child modules. If `mod.rs` starts accumulating helper
functions, move those helpers to a named child file and re-export only the
surface that other modules need.

## Re-export Discipline

- Default to private or `pub(crate)` visibility.
- Use explicit re-exports such as `pub(crate) use chat::send_event_stream;`.
- Avoid glob re-exports from refactored modules. They make ownership and public
  surface changes harder to review.
- Public `pub` exports should exist because another crate consumes them, not
  because a sibling module happens to need them.

## Naming

- File names should match the dominant domain or action: `sessions.rs`,
  `conversions.rs`, `streaming.rs`, `crud/update.rs`.
- Test modules should mirror the source module they cover, either inline under
  `#[cfg(test)]` or in a `tests/` child module for larger areas.
- Shared test fixtures belong in narrowly named test helper modules, not in
  production `mod.rs` files.

## Verification

Use the normal Rust checks for behavior and type safety:

```bash
cargo +stable check --workspace --all-targets
cargo +stable test --workspace
```

Use the root size-budget script as an advisory refactor signal:

```bash
npm run lint:file-sizes
```

The size check may fail while known large modules remain. Treat its output as a
prioritized list for future splits rather than as a blocking gate until the
existing offenders have been reduced.
