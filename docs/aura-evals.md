# Aura Evals

Aura now has the beginnings of a scenario-driven evaluation system for two different jobs:

1. A deterministic smoke lane for core browser health across desktop and mobile.
2. A deterministic workflow lane for the Aura lifecycle using stateful mocked APIs and imported fixture projects.
3. A live benchmark lane for the autonomous build loop that measures whether Aura can turn a fixture project into a working result.
4. A Promptfoo behavior lane for narrow planning/execution regressions.

## Why this shape

The product has two different kinds of risk:

- UI and flow regressions in the browser shell.
- End-to-end regressions in the org -> agent -> project -> spec -> task -> build loop.
- Regressions in prompt/model-driven agent behavior that need a narrower, cheaper test surface.

Those need different test strategies. The smoke and workflow lanes are lightweight and safe for CI. The benchmark lane is heavier and requires a fully working Aura environment with authentication, storage, and model access.

## Scenario files

Scenario definitions live in:

- `frontend/tests/e2e/evals/scenarios/core-browser-smoke.json`
- `frontend/tests/e2e/evals/scenarios/workflow-e2e.json`
- `frontend/tests/e2e/evals/scenarios/live-benchmark.json`
- `evals/promptfoo/tests/`

Fixture projects live under:

- `frontend/tests/e2e/evals/fixtures/`

The current benchmark fixtures are:

- `hello-world-static-site`
- `hello-world-node-server`
- `existing-node-server-patch`

The deterministic workflow lane uses the same fixture format, but runs against a stateful mocked Aura backend so CI can prove the lifecycle still works without depending on live model behavior.

The live benchmark lane now also supports repo-owned artifact checks, so a run can verify that Aura produced the expected source files in addition to passing build/test commands.

## What gets measured

Each eval attaches a JSON summary and a screenshot to the Playwright test output. The live benchmark summary records:

- End-to-end duration and per-step timing
- Org, agent, project, and agent-instance IDs
- Spec count and task count
- Done and failed task totals
- Input, output, and total token counts
- Estimated cost in USD
- Build-step and test-step counts
- Task output payloads for later debugging

After any lane runs, `npm run test:evals:report` consolidates those per-scenario artifacts into:

- `frontend/test-results/aura-evals-summary.json`
- `frontend/test-results/aura-evals-summary.md`

That summary is the first building block for historical baselines and trend comparisons across time, tokens, cost, and failure counts.

You can compare a fresh summary against the checked-in baselines with:

```bash
npm run test:evals:compare -- test-results/aura-evals-summary.json ../evals/reports/baselines/workflow-summary.json workflow-compare
```

## Running locally

From `frontend/`:

```bash
npm run test:evals:smoke
npm run test:evals:workflow
npm run test:evals:report
npm run test:evals:compare -- test-results/aura-evals-summary.json ../evals/reports/baselines/smoke-summary.json smoke-compare
```

To run the live benchmark lane, point Playwright at a real Aura host and provide a real account:

```bash
AURA_EVAL_LIVE=1 \
AURA_EVAL_BASE_URL=http://127.0.0.1:5173 \
AURA_EVAL_USER_EMAIL=you@example.com \
AURA_EVAL_USER_PASSWORD=secret \
npm run test:evals:benchmark
```

The live benchmark assumes the target Aura host already has working auth, storage, and model-backed build loop dependencies.

Current local-stack status:

- The local-agent hello-world benchmark now runs end to end against the real local stack.
- That path covers login, org creation, agent creation, project import, spec generation, task extraction, autonomous build loop execution, and artifact verification.
- Build/test evidence is now captured from real `run_command` tool snapshots in task output payloads.
- Automaton runs now persist real session tokens into Aura Storage, report estimated cost into `aura-network`, and surface sane `started_at`/`ended_at` timestamps in session history and project stats.
- The remaining local telemetry work is mainly polish: task-level token totals should be exposed more consistently in every summary surface, and remote-agent lanes still need the same production-grade measurement path.

## Local integration stack

There is now a local-first integration stack in:

- `evals/local-stack/`

This stack is the bridge between the deterministic mocked workflow lane and the fully remote live benchmark lane.

It uses:

- Docker Compose for shared infrastructure and the local harness
- repo-generated env files for `aura-network`, `aura-storage`, `orbit`, and `aura-os-server`
- per-service local or remote URL resolution, so you can mix local services with Render-hosted services during bring-up

The current default shape is intentionally pragmatic:

- `aura-network`, `aura-storage`, and `orbit` run from their sibling repos with `cargo run`
- PostgreSQL for those services runs in Docker
- `aura-harness` can run either in Docker or directly from its sibling repo during local bring-up and debugging
- auth, router, and billing stay remote by default unless you replace them later

That gives us a real local integration lane without pretending every sibling repo already ships a production-ready Docker image.

Quick start:

```bash
cp evals/local-stack/stack.env.example evals/local-stack/stack.env
./evals/local-stack/bin/doctor.sh
./evals/local-stack/bin/up.sh
./evals/local-stack/bin/run-service.sh network
./evals/local-stack/bin/run-service.sh storage
./evals/local-stack/bin/run-service.sh orbit
./evals/local-stack/bin/run-service.sh aura-os
./evals/local-stack/bin/run-service.sh frontend
```

Full instructions live in `evals/local-stack/README.md`.

To run the behavior evals:

```bash
cd evals/promptfoo
npm ci
npm run eval:ci
```

## CI shape

The GitHub Actions workflow runs:

- smoke evals plus baseline comparison
- deterministic workflow evals plus baseline comparison
- Promptfoo behavior evals
- an optional manual live benchmark lane for real model-backed runs

The workflow lane also runs in CI and covers the deterministic org -> agent -> project -> spec -> task -> build lifecycle.

## Research notes

The implementation follows a few patterns that already show up in strong browser-eval systems:

- Playwright projects let us run the same scenarios against desktop and mobile browser/device profiles from one config.
- Playwright traces and HTML reports give us debuggable artifacts in CI.
- Paperclip publicly frames the orchestration problem around persistent tasks, auditability, budgets, and test-before-deploy approval flows, which lines up with Aura's need for benchmark runs that measure both outcome quality and operating cost.

Sources:

- [Playwright projects](https://playwright.dev/docs/test-projects)
- [Playwright reporters](https://playwright.dev/docs/test-reporters)
- [Paperclip overview](https://paperclip.ing/)
- [Paperclip docs](https://docs.paperclip.ing/start/what-is-paperclip)
