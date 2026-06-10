# Aura Evals

Aura has a scenario-driven evaluation system for the main release-risk surfaces:

1. A deterministic smoke lane for core browser health across desktop and mobile.
2. A deterministic chat-core lane for project-agent setup and chat loops using mocked persisted history and SSE fixtures.
3. A deterministic workflow lane for the Aura lifecycle using stateful mocked APIs and imported fixture projects.
4. A live benchmark lane for the autonomous build loop that measures whether Aura can turn a fixture project into a working result.
5. A Promptfoo behavior lane for narrow planning/execution regressions.

## Why this shape

The product has two different kinds of risk:

- UI and flow regressions in the browser shell.
- End-to-end regressions in the org -> agent -> project -> spec -> task -> build loop.
- Regressions in prompt/model-driven agent behavior that need a narrower, cheaper test surface.

Those need different test strategies. The smoke and workflow lanes are lightweight and safe for CI. The benchmark lane is heavier and requires a fully working Aura environment with authentication, storage, and model access.

## Lane Registry

Eval lanes are registered in `infra/evals/lanes.json`. CI and local
verification use `scripts/ci/verify-evals.mjs <lane>` so lane behavior is
centralized instead of copied across workflows. Each lane records its working
directory, install/runtime setup, Playwright browser dependencies, test command,
report and baseline paths, artifact paths, and any manual-only environment
requirements.

The current lanes are:

- `smoke`
- `chat-core`
- `workflow`
- `behavior`
- `bench-smoke`
- `live-benchmark`

When adding a lane, add it to `infra/evals/lanes.json`, then run it through the
shared entrypoint:

```bash
node scripts/ci/verify-evals.mjs <lane>
```

## Scenario files

Scenario definitions live in:

- `interface/tests/e2e/evals/scenarios/core-browser-smoke.json`
- `interface/tests/e2e/evals/scenarios/chat-core.json`
- `interface/tests/e2e/evals/scenarios/workflow-e2e.json`
- `interface/tests/e2e/evals/scenarios/live-benchmark.json`
- `infra/evals/promptfoo/tests/`

Fixture projects live under:

- `interface/tests/e2e/evals/fixtures/`

The current benchmark fixtures are:

- `hello-world-static-site`
- `hello-world-node-server`
- `existing-node-server-patch`

The deterministic chat-core lane covers the highest-risk project-agent chat surfaces without live model variance:

- project-agent chat send request shape
- SSE event ordering through progress, text, tool, token usage, assistant-end, message-end, and done
- Aura-managed model request forwarding, including non-default chat models
- richer tool event variants: thinking deltas, tool snapshots, retry notifications, and terminal retry failures
- rendered user/assistant transcript output
- persisted history refresh after a turn
- mobile project-agent Add Agent -> Attach Existing Agent -> chat flow
- mobile project-agent Add Agent -> Create Remote Agent -> remote readiness -> attach -> chat flow
- zero unhandled mocked API calls in the deterministic chat-core harness

## Risk coverage map

Aura's agent loop has several independent breakage points, so no single test
style is enough:

- Prompt/model behavior: Promptfoo behavior evals assert narrow planning and
  governance outcomes without launching the UI.
- Request contracts: chat-core scenarios assert the browser sends the expected
  content, action, model, attachments, commands, and new-session shape.
- Stream normalization: unit tests cover individual stream reducers; chat-core
  verifies those reducers still work when fed by the real SSE/UI path.
- Persistence and recovery: backend chat-event integration tests cover session
  storage, while chat-core verifies the UI refetches and renders persisted
  history after the turn.
- Agent setup: workflow evals cover broader lifecycle setup; chat-core covers
  both attach-existing and create-remote project agent flows through immediate
  chat.
- Tool execution surfaces: workflow/live benchmark lanes cover real task/tool
  side effects; chat-core covers deterministic tool stream rendering, including
  retry and terminal-failure states.
- Release packaging: desktop/mobile workflows should continue to run native
  smoke checks because browser-only evals do not prove signing, updater, or
  packaged runtime health.

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

- `interface/test-results/aura-evals-summary.json`
- `interface/test-results/aura-evals-summary.md`

That summary is the first building block for historical baselines and trend comparisons across time, tokens, cost, and failure counts.

You can compare a fresh summary against the checked-in baselines with:

```bash
npm run test:evals:compare -- test-results/aura-evals-summary.json ../infra/evals/reports/baselines/workflow-summary.json workflow-compare
```

### Refreshing baselines after a scenario rename

The CI compare step diffs the freshly-generated `aura-evals-summary.json`
against the checked-in baseline files in
`infra/evals/reports/baselines/`. If you rename a scenario `id` in
`core-browser-smoke.json`, `chat-core.json`, or `workflow-e2e.json`,
those baseline files become stale and CI will fail with a
`[stale-baseline]` notice. Refresh
them from `interface/`:

```bash
npm run test:evals:smoke && npm run evals:refresh-baseline smoke
npm run test:evals:chat-core && npm run evals:refresh-baseline chat-core
npm run test:evals:workflow && npm run evals:refresh-baseline workflow
```

`evals:refresh-baseline` reads `test-results/aura-evals-summary.json`,
keeps the entries whose `suite` matches the lane you passed, and
overwrites `infra/evals/reports/baselines/{lane}-summary.json`.

## Running locally

From `interface/`:

```bash
npm run test:evals:smoke
npm run test:evals:chat-core
npm run test:evals:workflow
npm run test:evals:report
npm run test:evals:compare -- test-results/aura-evals-summary.json ../infra/evals/reports/baselines/smoke-summary.json smoke-compare
```

From the repo root, use the standardized CI entrypoint:

```bash
node scripts/ci/verify-evals.mjs smoke
node scripts/ci/verify-evals.mjs chat-core
node scripts/ci/verify-evals.mjs workflow
node scripts/ci/verify-evals.mjs behavior
node scripts/ci/verify-evals.mjs bench-smoke
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

- `infra/evals/local-stack/`

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
cp infra/evals/local-stack/stack.env.example infra/evals/local-stack/stack.env
./infra/evals/local-stack/bin/doctor.sh
./infra/evals/local-stack/bin/up.sh
./infra/evals/local-stack/bin/run-service.sh network
./infra/evals/local-stack/bin/run-service.sh storage
./infra/evals/local-stack/bin/run-service.sh orbit
./infra/evals/local-stack/bin/run-service.sh aura-os
./infra/evals/local-stack/bin/run-service.sh frontend
```

Full instructions live in `infra/evals/local-stack/README.md`.

To run the behavior evals directly:

```bash
cd infra/evals/promptfoo
npm ci
npm run eval:ci
```

## CI shape

The GitHub Actions workflow runs:

- eval lane registry validation
- smoke evals plus baseline comparison
- chat-core evals plus baseline comparison
- deterministic workflow evals plus baseline comparison
- Promptfoo behavior evals
- benchmark runner smoke tests
- an optional manual live benchmark lane for real model-backed runs

The workflow lane also runs in CI and covers the deterministic org -> agent -> project -> spec -> task -> build lifecycle.

The workflow also has one branch-protection-friendly aggregate job:
`Eval results (required)`. Require that job in branch protection. It fails when
any required eval job fails and treats the manual live benchmark as optional
unless it is explicitly requested and then fails.

## Research notes

The implementation follows patterns used by Codex and strong browser-eval
systems:

- Prefer integration-style tests around agent changes, then add focused unit
  tests for reducers and request builders.
- Use structured request/response assertions instead of only checking visible
  text.
- Keep a single CI runner for each lane and fail on aggregate regression
  results.
- Run lanes with no fail-fast behavior where possible so one failure does not
  hide the rest of the release-risk picture.
- Playwright projects let us run the same scenarios against desktop and mobile browser/device profiles from one config.
- Playwright traces, screenshots, JSON attachments, and markdown summaries give us debuggable artifacts in CI.
- Paperclip publicly frames the orchestration problem around persistent tasks, auditability, budgets, and test-before-deploy approval flows, which lines up with Aura's need for benchmark runs that measure both outcome quality and operating cost.

Sources:

- [Codex repository](https://github.com/openai/codex)
- [Codex AGENTS.md](https://github.com/openai/codex/blob/main/AGENTS.md)
- [Codex justfile](https://github.com/openai/codex/blob/main/justfile)
- [Codex Rust CI workflow](https://github.com/openai/codex/blob/main/.github/workflows/rust-ci.yml)
- [Playwright projects](https://playwright.dev/docs/test-projects)
- [Playwright reporters](https://playwright.dev/docs/test-reporters)
- [Paperclip overview](https://paperclip.ing/)
- [Paperclip docs](https://docs.paperclip.ing/start/what-is-paperclip)
