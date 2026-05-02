# SWE-bench Verified dataset manifests

This directory holds JSONL manifests of SWE-bench Verified instances. Each
file contains one JSON record per line. Three canonical subsets are used:

- `smoke.jsonl` — first 20 instances (pipeline sanity check; ~5% leaderboard
  granularity, not a defensible number on its own)
- `smoke_stratified.jsonl` — 20 instances selected round-robin by repository
  from the full Verified split; better for quick cross-project smoke checks
- `verified.jsonl` — full 500 instances

Both files are produced by
[`bin/fetch-dataset.mjs`](../bin/fetch-dataset.mjs), which walks the
HuggingFace `datasets-server` JSONL pages mirroring
`princeton-nlp/SWE-bench_Verified`. Manifests are not committed by default:
`*.jsonl` is in this directory's `.gitignore`. Regenerate them with:

```sh
node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset smoke
node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset smoke_stratified
node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset verified
```

## Record shape

Each line must parse as JSON. The driver requires these fields:

| Field              | Required | Notes                                           |
| ------------------ | -------- | ----------------------------------------------- |
| `instance_id`      | yes      | unique id, e.g. `django__django-12345`           |
| `repo`             | yes      | `owner/name`, used as `https://github.com/<repo>.git` |
| `base_commit`      | yes      | sha to clone and diff against                    |
| `problem_statement`| yes      | issue body, embedded into `requirements.md`     |
| `hints_text`       | no       | optional discussion appended to `requirements.md` |
| `environment_setup_commit` | no | reserved for future env bootstrap support       |
| `version`          | no       | upstream version metadata (informational)       |

## Fallback / offline use

If the HuggingFace endpoint is unavailable or rate-limited you can drop a
hand-curated JSONL at this path with the schema above and the driver will
use it without re-fetching. This is also the recommended path for one-off
re-runs against a frozen subset of instances.
