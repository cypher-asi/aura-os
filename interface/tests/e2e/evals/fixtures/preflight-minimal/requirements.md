# Preflight task

Smallest possible task used to verify the AURA dev loop is wired end-to-end
before launching a long benchmark.

## Requirements

- Create a file named `hello.txt` in the project root.
- Its contents must be exactly the single line `hello` (no trailing newline
  is required, but one is allowed).
- Do not modify any other files.
- The provided `npm run build` and `npm run test` scripts already pass; do
  not change them.

## Completion contract

This fixture intentionally has **one** spec with at most two tasks: the
`hello.txt` creation, and (optionally) a verification step. For any
verification-only task that produces no file edits, the agent must call
`task_done` with `no_changes_needed: true`; the dev-loop completion gate
rejects `task_done` otherwise. Equivalently, running `npm run test`
successfully also satisfies the gate via the test-runner escape hatch.
