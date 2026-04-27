# External Benchmarks — Secrets and Environment

The `External Benchmarks` workflow at
[`.github/workflows/external-benchmarks.yml`](../../../.github/workflows/external-benchmarks.yml)
expects a small set of GitHub Actions secrets and self-hosted runner
environment variables. This file lists them in one place so the runner
operator can provision the environment once.

## GitHub Actions secrets

These are the secrets the workflow reads via `${{ secrets.* }}`. Add them
under `Settings → Secrets and variables → Actions` (organization or repo
scope, your call).

| Secret                    | Required? | Purpose                                                                                                                                                                                                                                                       |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AURA_EVAL_ACCESS_TOKEN`  | yes       | AURA bearer token issued by `aura-os-server`. Generate it from the desktop app or via the `auth/import-access-token` API. The drivers send it as `Authorization: Bearer …` against the local-stack API.                                                       |
| `AURA_EVAL_STORAGE_URL`   | optional  | Optional storage-service URL for AURA. The drivers tolerate an empty value; only set this if the runner's local stack uses a non-default storage backend.                                                                                                     |
| `ANTHROPIC_API_KEY`       | yes       | Claude API key for the agent template. Drives all of the LLM cost — the SWE-bench driver also enforces the `AURA_BENCH_MAX_USD` cap on top of this.                                                                                                           |
| `GITHUB_TOKEN` (built-in) | provided  | Automatically injected by Actions. The PR-comment script only uses it when `--pr <number>` is passed, which the current workflow does not do — the workflow writes to `$GITHUB_STEP_SUMMARY` instead.                                                         |

## Self-hosted runner environment

The workflow runs on a self-hosted runner labeled `aura-bench`. Make sure
the runner host has these set up before the first dispatch:

1. **`AURA_EVAL_ACCESS_TOKEN` available to the local-stack helper.** The
   helper at `infra/evals/local-stack/bin/run-one-shot.sh` (operator
   responsibility — out of scope for this workflow) needs the token in
   its own environment, since it's the process that bootstraps the AURA
   API. Either bake it into the runner's user environment, or have the
   helper read it from the same secret as the workflow.
2. **Docker daemon running** with at least 20 GB of free disk on the
   partition that holds the repository checkout. Both `bin/run.sh`
   wrappers preflight this and fail fast otherwise.
3. **Python 3.11+** with `pip` on `PATH`. The workflow installs the
   `swebench` and `terminal-bench` packages in CI, so the runner only
   needs the base interpreter.
4. **Node 22+** on `PATH`. The workflow installs the right version with
   `actions/setup-node@v4`, but the local-stack helper may still rely on
   the system Node, so keep one in `PATH` too.
5. **`tb` CLI on `PATH`** if you want to dispatch the `tbench` job. The
   workflow installs `terminal-bench` via pip, which provides the `tb`
   entrypoint, but the runner user's `PATH` must include the pip user
   bin directory.

## Why the workflow is `workflow_dispatch`-only

A SWE-bench Verified smoke pass (20 instances) costs roughly $20–$100 in
Anthropic spend and 1–2 hours of wallclock on a 4-way-parallel local
stack. A full Verified pass is 24–48 hours and several hundred dollars.
Terminal-Bench Core is similar in scale. We do not want either to fire
on every push or pull request, so the workflow only runs when a human
explicitly dispatches it from the Actions tab.

## Cost guard recap

- **SWE-bench**: `AURA_BENCH_MAX_USD` is enforced inside
  [`run-swebench.mjs`](swebench/run-swebench.mjs). Once cumulative
  spend exceeds the cap, subsequent instances are marked
  `skipped_cost_cap` and the harness still scores everything that did
  run.
- **Terminal-Bench**: the wrapper does not yet enforce a cumulative cap
  inside the script. The env var still flows through to the AURA agent
  for per-session limits, but **set `max_usd` conservatively** when
  dispatching the TB lane. This is tracked as a Phase-4 follow-up.
