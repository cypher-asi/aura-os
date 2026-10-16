# Working in Aura OS

## Keep changes reviewable

- Prefer several small, single-purpose pull requests over one large PR that combines unrelated changes.
- Make focused commits, each covering one coherent change. Keep the tests for a behavior with its implementation; do not separate them just to increase the commit count.
- Start independent PRs from the current `origin/main`. When a change depends on another PR, state that dependency explicitly instead of silently bundling the work.
- Test each change in proportion to its scope and record what passed, what was not tested, and any blockers in the PR.
- Preserve unrelated local changes and other threads' work. Use an isolated worktree when the shared checkout is dirty.
- If CI or publishing is blocked, prepare and push reviewable PRs without claiming they are verified, merged, or released. Do not bypass required checks or branch protections.
