# Preflight task

Smallest possible task used to verify the AURA dev loop is wired end-to-end
before launching a long benchmark.

## Requirements

- Create a file named `hello.txt` in the project root.
- Its contents must be exactly the single line `hello` (no trailing newline
  is required, but one is allowed).
- Treat this as a single implementation task. Do not create a separate
  verification task.
- The provided `npm run build` and `npm run test` scripts already pass; do
  not change them.

## Completion contract

This fixture intentionally has **one** spec and one patch-producing task:
create `hello.txt`. Any verification should be recorded inside that same
task, after the file is written.
