# Remote push recovery

How to diagnose and unblock a stuck git remote when the aura-os
autonomous dev-loop is running. Pairs with `fix(dev-loop): decouple
task terminal status from git push outcome` (commit 73ab86fb): tasks
keep completing locally even while this runbook is in play, so there
is no urgency measured in "tasks failing" -- only in "push backlog
grows unbounded".

## When you''ll see this

- The task card UI shows a `PushStuckBanner` with "Push blocked by
  remote..."
- `GitStepItem` rows show `push_deferred` entries beneath successful
  commits
- Local branch diverges from `origin/main` (ahead count climbs, behind
  stays at zero or climbs slowly because nobody else can push either)
- A `project_push_stuck` domain event fires after
  `CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD` consecutive push
  failures (currently 3). The event is one-shot per streak; a
  successful push re-arms it.

## Invariant: task completion never waits on push

Since `fix(dev-loop): decouple task terminal status from git push
outcome` (commit 73ab86fb), task terminal status is determined only
by `completion_validation_failure_reason`. Push failures emit
`push_deferred` and bump a per-project counter, but never demote a
task from `done` to `failed`. Tasks keep completing locally.

This matters for triage: a red `PushStuckBanner` is never a reason
to stop the dev-loop. It is a signal that the backlog of local
commits is growing and needs a human to free the remote.

## Diagnose

1. Check remote health from a machine that can reach the remote:

   ```sh
   git remote -v
   git ls-remote origin
   ```

   If `ls-remote` hangs, returns `remote: fatal: ... storage full`,
   `ssh: Could not resolve hostname`, or similar, the remote (not
   the local dev-loop) is the problem.

2. Check local branch state:

   ```sh
   git status
   git rev-list --count origin/main..HEAD   # ahead count
   git rev-list --count HEAD..origin/main   # behind count
   ```

   An ahead count that matches the number of `push_deferred` rows
   on recent task cards confirms the dev-loop is the only thing
   producing new commits.

3. Inspect dev-loop push history. Search the `aura-os-server` log
   (or the event stream in the UI) for `push_deferred` and
   `project_push_stuck` entries to find the last successful push
   and the cumulative failure count
   (`consecutive_push_failures`).

## Recover

### Option A: Free space / unblock a self-hosted remote

Preferred when the original remote is the long-term system of
record.

1. SSH into the remote host and reclaim resources:
   - Clear old logs and temp files.
   - Run `git gc --auto` (or `git gc --prune=now` if you know what
     you are doing) on the bare repo.
   - Remove orphan packs left behind by an interrupted push.
2. Verify from the client: `git ls-remote origin` must return
   quickly with a ref list.
3. Drain the local backlog manually once healthy:

   ```sh
   git fetch origin
   git merge --ff-only origin/main   # or rebase, if that matches policy
   git push origin main
   ```

   The next successful push resets
   `consecutive_push_failures` to 0 and clears the stuck banner on
   the next UI render.

### Option B: Switch remotes

Use when the original remote cannot be restored in a reasonable
window.

1. Add a backup remote on every dev-loop host:

   ```sh
   git remote add backup <backup-url>
   git push backup main
   ```

2. Update downstream consumers (CI, the sync service, mirrors)
   to read from `backup` so no one starves on the stuck remote.
3. Leave the original `origin` configured. The dev-loop will keep
   retrying silently; once the original remote is healthy, push
   succeeds and the counters reset on their own. No config flip
   is required at the aura-os-server layer.

### Option C: Explicit force-push (only when approved)

Force-push is **never** automatic. The dev-loop will never
`--force`. Only execute after a human has:

1. Explicitly requested the force-push.
2. Confirmed the divergence is intentional (e.g. the remote
   history is known-bad, or a rewrite has been coordinated).

Then use:

```sh
git push --force-with-lease origin main
```

Never `--force` without `--with-lease`: it is easy to clobber
someone else''s push during a stuck-remote window, and the lease
check is the last safety net.

## After recovery

- `consecutive_push_failures` resets to 0 on the first successful
  push. The one-shot `project_push_stuck` guard re-arms for the
  next streak (see `reset_rearms_project_push_stuck_for_next_streak`
  in `apps/aura-os-server/tests/dev_loop_dod_regression.rs`).
- The `PushStuckBanner` clears on the next UI render cycle.
- In-flight `push_deferred` steps remain on historical task cards
  for audit; new tasks show `push_succeeded` steps.

## See also

- `apps/aura-os-server/src/handlers/dev_loop.rs` --
  `push_deferred` / `project_push_stuck` /
  `consecutive_push_failures` logic.
- `interface/src/components/PushStuckBanner/` -- banner UI.
- `interface/src/stores/event-store/engine-event-handlers.ts` --
  event handlers for `push_deferred` / `project_push_stuck`.
- Commit 73ab86fb -- the decoupling fix this runbook presumes.