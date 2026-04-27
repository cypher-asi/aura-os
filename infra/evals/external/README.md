# External coding benchmarks for AURA

This directory contains the lane that scores **AURA's full pipeline**
(`org -> project import -> spec -> tasks -> autonomous loop`) against two
public coding benchmarks:

| Subdirectory | Benchmark | Score metric | Subsets |
| --- | --- | --- | --- |
| [`swebench/`](./swebench/) | [SWE-bench Verified](https://www.swebench.com/) | `resolved_pct` (pass@1) | `smoke` (≤20), `verified` (500) |
| [`tbench/`](./tbench/) | [Terminal-Bench 2 — core](https://www.tbench.ai/) | `pass_rate` | `smoke` (10), `full` |

Both lanes plug into AURA via the same Node library
(`interface/scripts/lib/benchmark-api-runner.mjs`) that powers our internal
live-benchmark suite. Nothing about AURA is short-circuited or stubbed: the
benchmark drivers point AURA at a per-instance workspace, hand it a
`requirements.md`, and let the autonomous loop run end-to-end. Patches and
verifier outcomes feed the official scorers (SWE-bench's Docker harness and
Terminal-Bench's hidden pytests).

## At a glance

```
infra/evals/external/
├── README.md                 ← you are here
├── SECRETS.md                ← required env vars / GitHub secrets
├── bin/
│   ├── post-pr-comment.mjs   ← markdown delta + (optional) GitHub PR post
│   └── post-pr-comment.test.mjs
├── swebench/                 ← SWE-bench Verified driver, harness wrapper, score.json
└── tbench/                   ← Terminal-Bench 2 agent shim, harness wrapper, score.json

infra/evals/reports/external/
├── swebench_verified/
│   ├── baseline.json         ← committed; replaced after first green full run
│   └── <run-id>/             ← per-run artifacts (gitignored)
└── tbench_2_core/
    ├── baseline.json
    └── <run-id>/

.github/workflows/external-benchmarks.yml   ← workflow_dispatch only, self-hosted
```

Per-lane details (env vars, sub-process flow, known limitations) live in each
sub-README:

- [`swebench/`](./swebench/) — see also
  [`swebench/datasets/README.md`](./swebench/datasets/README.md) for the
  dataset manifest format.
- [`tbench/`](./tbench/README.md)

## Compute model

By default the benchmarks run **local-only**: AURA, the SWE-bench Docker
scoring harness, and the per-task Terminal-Bench containers all execute on the
developer's machine. Only LLM API calls (Claude) leave the box. The CI
workflow is identical, just retargeted at a self-hosted runner with the same
prerequisites.

Practical implications:

- A full SWE-bench Verified run (500 instances) requires the harness to
  download ~50 GB of per-repo Docker images and keep ~100 GB free for
  parallel scoring.
- A Terminal-Bench full run boots one Docker container per task; expect ~20 GB
  of churn.
- The runners include disk preflights (>= 20 GB free) and SWE-bench enforces
  `AURA_BENCH_MAX_USD` as a hard cap on cumulative Claude spend.

## Prerequisites

Common to both lanes:

| Tool | Minimum version | Used by |
| --- | --- | --- |
| Node.js | 22 (matches `.nvmrc`) | drivers, bridges, library |
| Python | 3.11 | swebench harness, tbench `tb` CLI |
| Docker | running daemon | swebench harness, tbench containers |
| AURA backend | reachable via `AURA_EVAL_API_BASE_URL` (default `http://127.0.0.1:3190`) | both |
| `AURA_EVAL_ACCESS_TOKEN` | exported in shell or loaded from `.env` / local-stack `.runtime/auth.env` | both |

SWE-bench-only:

```sh
pip install swebench
```

On Windows, run the SWE-bench lane from WSL2 or another Linux environment.
The upstream harness imports the Unix-only Python `resource` module, so native
Windows Python cannot execute the official scorer.

Terminal-Bench-only:

```sh
pip install terminal-bench
```

See [`SECRETS.md`](./SECRETS.md) for the matching GitHub Actions secrets.

## Quick start

Bring up the AURA local stack first (in a separate shell) — the benchmark
drivers expect `aura-os-server` reachable at `AURA_EVAL_API_BASE_URL`.
The runners automatically load repo `.env`, `.env.local`, local-stack
`stack.env`, and local-stack `.runtime/auth.env`, so the common path does
not require manually exporting the eval token.

```bash
# Optional: cap Claude spend at $5 across the run.
export AURA_BENCH_MAX_USD=5

# Optional: keep AURA org/project/agent rows after the run for inspection.
export AURA_EVAL_KEEP_ENTITIES=1

# --- SWE-bench smoke (≤20 instances) -----------------------------------
node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset smoke
./infra/evals/external/swebench/bin/run.sh smoke

# --- SWE-bench Verified, full 500 instances ---------------------------
node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset verified
./infra/evals/external/swebench/bin/run.sh verified

# --- SWE-bench, narrow to specific instance ids ------------------------
./infra/evals/external/swebench/bin/run.sh smoke --instance-ids django__django-12345

# --- Terminal-Bench smoke (10 tasks) ---------------------------------
./infra/evals/external/tbench/bin/run-tbench.sh smoke

# --- Terminal-Bench full ------------------------------------------------
./infra/evals/external/tbench/bin/run-tbench.sh full
```

Each runner prints a one-line summary on completion and writes `score.json`
under `infra/evals/reports/external/<benchmark>/<run-id>/`.

## Output shape

Every lane produces the same `score.json` shape so the PR-comment script and
external dashboards can consume them uniformly:

```json
{
  "benchmark": "swebench_verified",
  "subset": "smoke",
  "instance_count": 20,
  "aura_version": "<git short sha>",
  "claude_model": "claude-sonnet-4-20250514",
  "cost_usd": 12.35,
  "total_tokens": 543210,
  "wallclock_seconds": 1872,
  "score": 50.00,
  "confidence_note": "Smoke run with 20 instances has only ~5% granularity. ...",
  "instances": [
    {
      "instance_id": "...",
      "status": "resolved | not_resolved | agent_error | harness_error | clone_error",
      "model_patch_lines": 42,
      "files_changed": 3,
      "tests_directory_hits_stripped": 0,
      "harness_run_id": "...",
      "aura_run_id": "...",
      "cost_usd": 0.61,
      "total_tokens": 27144,
      "wallclock_seconds": 84
    }
  ]
}
```

The Terminal-Bench shape is identical except `instance_id` becomes `task_id`
and the score is `pass_rate`.

## CI

The repo ships a single workflow at
[`.github/workflows/external-benchmarks.yml`](../../../.github/workflows/external-benchmarks.yml).
It is **`workflow_dispatch` only** — these runs are too expensive and slow to
attach to every push or PR. Inputs:

| Input | Choices | Default | Notes |
| --- | --- | --- | --- |
| `benchmark` | `swebench`, `tbench`, `both` | `swebench` | gates which job runs |
| `subset` | `smoke`, `verified`, `full`, `custom` | `smoke` | `verified`+`full` are the long lanes |
| `instance_ids` | comma-separated ids | _(empty)_ | forwarded as `--instance-ids` |
| `max_usd` | string | `5` | sets `AURA_BENCH_MAX_USD` |
| `keep_entities` | bool | `false` | sets `AURA_EVAL_KEEP_ENTITIES=1` |

The workflow targets `runs-on: [self-hosted, aura-bench]`. Public
GitHub-hosted runners do not have enough disk or runtime to execute even the
SWE-bench smoke lane. After each run the `post-pr-comment.mjs` script emits a
markdown summary into `$GITHUB_STEP_SUMMARY` (and uploads the entire run dir
as an artifact with 30-day retention).

## Baselines

Initial baselines are placeholder `score: null` files at
`infra/evals/reports/external/<benchmark>/baseline.json`. The first green
full-subset run should replace them via a manual commit. The PR-comment
script handles missing baselines gracefully (renders the table with `—` in
the baseline/delta columns).

## Confidence and reporting hygiene

- **Smoke runs are not leaderboard-defensible.** Both aggregators emit a
  `confidence_note` field for any run where the sample is too small to be
  statistically meaningful (`<= 50` for SWE-bench, `<= 30` for TB). The
  PR-comment script renders this as a `> Note:` blockquote so it can't be
  visually missed.
- **Test edits are stripped from SWE-bench patches** before submission
  (anything under `tests/`, `test/`, or matching `test_*.py` / `*_test.py`).
  The number of stripped hunks is reported per instance as
  `tests_directory_hits_stripped`. The reviewer harness applies the hidden
  test patch and would fail the run if existing tests were altered.
- **Cost guard is enforced inside the SWE-bench driver** via
  `AURA_BENCH_MAX_USD`. If the cumulative cost crosses the cap mid-run the
  driver writes what it has and exits 0, so the harness wrapper still scores
  whatever instances completed. The TB lane does not yet enforce a cumulative
  cap inside its script (best-effort tracked under "open follow-ups" in
  [`SECRETS.md`](./SECRETS.md)).

## Sanity checks

```bash
# Library + driver unit tests (no AURA backend needed)
node --test interface/scripts/lib/benchmark-api-runner.test.mjs
node --test infra/evals/external/swebench/run-swebench.test.mjs
node --test infra/evals/external/bin/post-pr-comment.test.mjs
python3 -m unittest infra/evals/external/tbench/aura_agent/test_aura_agent.py

# Static syntax checks
node --check infra/evals/external/swebench/run-swebench.mjs
node --check infra/evals/external/swebench/bin/fetch-dataset.mjs
node --check infra/evals/external/swebench/bin/aggregate-score.mjs
node --check infra/evals/external/tbench/bin/run-aura-pipeline.mjs
node --check infra/evals/external/tbench/bin/aggregate-score.mjs
node --check infra/evals/external/bin/post-pr-comment.mjs
sh -n        infra/evals/external/swebench/bin/run.sh
sh -n        infra/evals/external/tbench/bin/run-tbench.sh
```

All of the above must pass before opening a PR that touches anything in this
directory.

## Open follow-ups

- Per-instance Python environment bootstrap for SWE-bench (so the agent can
  run `pytest` during the loop instead of reasoning blind from source).
  Without it, AURA's smoke score is honest but lower than systems that wrap
  the agent inside the SWE-bench Docker image.
- Cumulative cost guard for the Terminal-Bench lane.
- A `local-stack/bin/run-one-shot.sh` helper invoked by the CI workflow's
  "Start AURA local stack" step (currently the workflow assumes the
  self-hosted runner is pre-provisioned).
- Backfill `baseline.json` after the first green `verified` and `full` runs.
