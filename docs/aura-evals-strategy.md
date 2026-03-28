# Aura Evals Strategy

Date: 2026-03-28

## Goal

Build an evaluation system for Aura that gives us two things at the same time:

1. Fast regression safety for the product's core flows.
2. Longitudinal performance data so we can tell whether changes improve or degrade outcome quality, time, token usage, cost, and reliability.

The target is not just "do tests pass?" The target is:

- can Aura still complete the end-to-end flow?
- did it build the right thing?
- did it take less time?
- did it use fewer tokens or less money?
- did it fail less often?
- can we compare today's behavior against a previous baseline?

## Paperclip Research Summary

This plan is informed by a direct review of `paperclipai/paperclip`.

### What Paperclip actually does

Paperclip uses distinct test layers rather than one giant catch-all framework:

1. **Standard repo verification**
   - PR CI runs policy checks, typecheck, unit tests, build, and a dry-run release path.
   - Source: `.github/workflows/pr.yml`

2. **Browser end-to-end tests with Playwright**
   - They run a small Playwright suite for the product onboarding flow.
   - It launches a real Paperclip instance via `webServer` and checks UI plus API-created entities.
   - Sources:
     - `tests/e2e/playwright.config.ts`
     - `tests/e2e/onboarding.spec.ts`
     - `.github/workflows/e2e.yml`

3. **Release smoke tests against a packaged/runtime-like environment**
   - They build a Docker smoke harness and run a separate Playwright suite against that environment.
   - This is intentionally closer to production than normal dev E2E.
   - Sources:
     - `tests/release-smoke/playwright.config.ts`
     - `tests/release-smoke/docker-auth-onboarding.spec.ts`
     - `scripts/docker-onboard-smoke.sh`
     - `Dockerfile.onboard-smoke`
     - `.github/workflows/release-smoke.yml`

4. **Behavior evals separate from browser E2E**
   - They use Promptfoo for narrow agent-behavior evals across model/provider choices.
   - The evals focus on deterministic behavioral invariants like assignment pickup, approval compliance, blocked reporting, and boundary enforcement.
   - Sources:
     - `evals/README.md`
     - `evals/promptfoo/promptfooconfig.yaml`
     - `evals/promptfoo/tests/core.yaml`
     - `evals/promptfoo/tests/governance.yaml`
     - `doc/plans/2026-03-13-agent-evals-framework.md`

### Important design choices from Paperclip

These are the parts worth copying:

1. **Separate browser tests from model/behavior evals**
   - Playwright proves the product flow and UI wiring.
   - Promptfoo proves targeted agent behavior and prompt regressions.

2. **Keep a deterministic CI lane**
   - Their basic onboarding E2E uses the `process` adapter to avoid needing a real coding runtime.
   - They intentionally remove external fragility from the default CI path.

3. **Keep a production-like smoke lane**
   - Their release smoke uses a Docker-based packaged environment, real auth, and real runtime behavior.
   - This is a higher-confidence but heavier lane.

4. **Track costs and runtime telemetry as first-class product concerns**
   - Their architecture and docs consistently treat token usage, cost, run status, run logs, and duration as core product data.
   - Sources:
     - `docs/start/architecture.md`
     - `docs/agents-runtime.md`
     - `docs/guides/board-operator/costs-and-budgets.md`
     - `packages/adapter-utils/src/types.ts`

5. **Plan for bundle comparison, not just model comparison**
   - Their eval plan explicitly says the real unit is a bundle:
     - adapter
     - model
     - prompt
     - skills
     - runtime flags
   - That is correct for Aura too.

## What this means for Aura

Aura's core product risk is different from a normal CRUD app.

The risky part is not only "does the UI render?" It is:

- can the user create the entities required to start work?
- can Aura generate specs and tasks from project context?
- can the automated build loop actually do useful work?
- does the build produce working artifacts?
- does the system stay efficient as we improve prompts, models, or orchestration?

So Aura should explicitly adopt the same high-level split Paperclip uses:

1. **Browser flow tests**
2. **Behavior evals**
3. **Packaged/runtime smoke tests**
4. **Historical benchmark tracking**

The big difference is that Aura also needs **artifact-verification benchmarks** because its product promise is building software, not only coordinating agents.

## Recommended Aura Eval Layers

Aura should use five layers.

### Layer 0: Unit and contract verification

Purpose:

- catch local logic regressions cheaply
- verify API/client/store invariants

Examples:

- task/status state transitions
- build/test output parsing
- stream event handling
- workspace/import helpers
- metrics aggregation functions

Gate:

- every PR

### Layer 1: Browser smoke tests

Purpose:

- verify core app flows across desktop and mobile form factors
- catch routing, rendering, form, and navigation regressions

Use:

- Playwright
- mostly mocked or deterministic backend responses
- cross-device projects

Canonical Aura coverage:

1. Login / host connectivity
2. Create org
3. Create agent template
4. Create/import project
5. Open project work area
6. Navigate agent / work / stats views
7. Open task/spec/build outputs

Gate:

- every PR

Notes:

- This is the lane already started in `frontend/tests/e2e/evals`.

### Layer 2: Deterministic workflow E2E

Purpose:

- prove the actual Aura lifecycle works end-to-end without relying on live model output quality
- verify that entity creation, loop triggering, status transitions, and report generation all work
- stabilize the local-agent execution path before expanding to remote-agent coverage

Use:

- seeded local environment
- imported fixture projects
- deterministic adapter/runtime mode where possible
- real Aura API surface, real browser where useful

Canonical flow:

1. Create org
2. Create agent
3. Create/import project
4. Generate spec
5. Extract tasks
6. Start build loop
7. Wait for terminal states
8. Verify task outputs, stats, and artifacts exist

Gate:

- PRs touching backend loop/orchestration
- nightly if runtime makes PR gating too expensive

Important:

- This lane should prefer deterministic fixtures and bounded adapters before using a real coding LLM.

Implementation note:

- Aura now has a first local integration-stack scaffold in `evals/local-stack/`.
- It is intentionally hybrid: Docker for shared infra plus harness, repo-native service processes for sibling Rust services, and per-service local/remote URL overrides.
- This is the bridge between the mocked workflow lane and the fully live benchmark lane.
- The first stabilization target is `machineType=local`, because that exercises imported workspaces, filesystem tools, build/test commands, and the local harness execution loop directly.
- That local-agent stabilization now works for the smallest real benchmark fixture: the browser can log in, create the real org/agent/project/spec/tasks, run the real local build loop, and verify artifact files plus build/test command evidence.
- Session-backed telemetry is now wired for the local-agent lane: project stats and session history show real token totals, real runtime duration, and model-priced estimated cost from the live automaton run.
- The next local-stack telemetry work is to make task-level token reporting consistent across every summary surface and then carry the same measurement model into remote and mixed-agent benchmarks.

### Layer 3: Live benchmark / production-like smoke

Purpose:

- measure the real system under realistic model/runtime conditions
- verify that the autonomous build loop can actually produce a valid result

Use:

- real auth
- real storage
- real model-backed loop
- controlled benchmark fixtures
- production-like or staging environment

Canonical benchmark families:

1. **Hello world static page**
2. **Hello world web server**
3. **Simple CRUD app**
4. **Auth + database app**
5. **Existing repo modification**
6. **Bug-fix-on-existing-project**

For each benchmark, verify:

- build command passes
- test command passes
- artifact exists
- artifact behaves correctly in browser
- failure count is zero or within threshold

Execution modes:

1. **Local agent mode**
   - `machineType=local`
   - validates local harness execution, local workspaces, and local build/test loops
   - should be the first mode made stable end to end

2. **Remote agent mode**
   - `machineType=remote` or swarm-backed
   - validates remote agent provisioning, remote filesystem access, remote terminal access, remote execution, and remote result collection
   - should run as its own benchmark lane rather than being mixed into the local stabilization lane

3. **Mixed deployment mode**
   - local Aura app/eval controller with one or more remote backing services
   - examples:
     - local Aura app + remote swarm
     - local Aura app + remote network/storage/orbit
     - local Aura app + hosted staging services
   - should remain a first-class configuration because Aura's real deployment spans sibling repos and hosted services

Sequencing:

1. Stabilize local-agent benchmarks first.
2. Add dedicated remote-agent benchmark coverage after local execution is reliable.
3. Keep mixed-mode overrides configurable so real deployment shapes can be validated without rewriting the eval harness.

Gate:

- manual and nightly first
- promote selected benchmarks to pre-release once stable

### Layer 4: Behavior evals

Purpose:

- catch prompt/skill/model regressions in narrower agent decisions
- compare bundles without needing a full build run every time

Use:

- Promptfoo first
- repo-owned cases
- deterministic assertions
- later add first-party TS harness if needed

Canonical Aura behavior cases:

1. picks the correct task from backlog
2. does not start blocked task
3. reports blocked state with a useful reason
4. creates status update before exiting
5. uses the right project context
6. does not mutate the wrong project/org
7. respects budget/approval boundaries when applicable
8. recognizes build failure and retries/adjusts rather than claiming success

Gate:

- prompt/skill/model changes
- nightly model matrix

### Layer 5: Trend and regression analytics

Purpose:

- turn evals into a product benchmark system over time
- detect whether changes improve or degrade the system

Outputs per scenario:

- pass/fail
- wall-clock duration
- time per phase
- number of retries
- number of failed tasks
- token usage
- cost
- model/provider
- build/test step count
- artifact verification result

Outputs per run family:

- pass rate
- median duration
- p95 duration
- median tokens
- median cost
- pairwise baseline vs candidate deltas
- regression summary

Gate:

- nightly dashboards
- pre-release decisions
- optimization acceptance criteria

## Canonical Aura Objects

Aura should keep the eval definitions repo-owned and scenario-based.

### 1. `EvalScenario`

```ts
type EvalScenario = {
  id: string;
  title: string;
  lane: "browser_smoke" | "workflow_e2e" | "live_benchmark" | "behavior_eval";
  tags: string[];
  setup: {
    fixtureId?: string;
    authMode: "mock" | "local_seeded" | "live";
    environment: "dev" | "staging" | "release-smoke";
  };
  steps: EvalStep[];
  checks: {
    hard: HardCheck[];
    optional?: RubricCheck[];
  };
  metrics: MetricSpec[];
};
```

### 2. `EvalBundle`

This is what we compare over time.

```ts
type EvalBundle = {
  id: string;
  model?: string;
  adapter?: string;
  promptVersion?: string;
  skillSetVersion?: string;
  runtimeFlags?: Record<string, string | number | boolean>;
};
```

### 3. `EvalResult`

```ts
type EvalResult = {
  scenarioId: string;
  bundleId: string;
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  metrics: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    failedTasks?: number;
    buildSteps?: number;
    testSteps?: number;
  };
  checks: Array<{
    id: string;
    status: "passed" | "failed";
    message?: string;
  }>;
  artifacts: {
    screenshot?: string;
    trace?: string;
    reportJson?: string;
    log?: string;
  };
};
```

## Coverage Matrix Aura should own

Aura should explicitly cover these categories.

### A. Entity lifecycle

- create org
- create agent
- create project
- import project fixture
- update project settings
- archive/delete cleanup behavior

### B. Planning lifecycle

- generate specs
- regenerate summary
- extract tasks
- task dependency ordering
- retry/requeue failed task

### C. Execution lifecycle

- start loop
- pause loop
- stop loop
- single-task run
- task output retrieval
- build/test step persistence

### D. Artifact correctness

- expected files created
- build passes
- tests pass
- browser verification passes
- route/content checks for generated app

### E. Runtime safety

- handles no-work state cleanly
- reports blocked state
- does not claim success without output
- does not mutate wrong workspace/project
- survives auth or storage unavailability with understandable failure

### F. Efficiency

- duration per scenario
- duration per step
- total tokens
- total input/output tokens
- estimated cost
- retries and failures
- successful tasks per token

### G. Form-factor sanity

- desktop
- mobile Chromium
- mobile WebKit

### H. Release confidence

- packaged/staging Aura host
- real login
- real loop
- real benchmark fixture

### I. Agent execution modes

- local agents
- remote agents
- mixed local/remote service topologies

## Recommended Repo Layout for Aura

```text
docs/
  aura-evals.md
  aura-evals-strategy.md

frontend/tests/e2e/evals/
  scenarios/
    core-browser-smoke.json
    workflow-e2e.json
    live-benchmark.json
  fixtures/
    hello-world-static-site/
    hello-world-server/
    crud-todo-app/
  helpers.ts
  core-feature-smoke.spec.ts
  workflow-e2e.spec.ts
  live-benchmark.spec.ts

evals/
  promptfoo/
    promptfooconfig.yaml
    prompts/
    tests/
  reports/
```

## Phased Rollout

### Phase 1: Finish the deterministic smoke foundation

Status:

- started

Scope:

- browser smoke scenarios for desktop/mobile
- CI artifact uploads
- JSON reports per scenario

Exit criteria:

- PR-safe smoke lane is stable and trusted

### Phase 2: Add deterministic workflow E2E

Scope:

- scenario file for org -> agent -> project -> spec -> task -> loop
- imported benchmark fixture
- seeded or deterministic runtime path
- hard checks for stats and output collection

Exit criteria:

- Aura can prove the whole lifecycle works in CI without depending on a live model run

### Phase 3: Add Promptfoo behavior evals

Scope:

- narrow evals for planning/execution decisions
- bundle comparison across model/prompt variants

### Phase 4: Stabilize local-agent live execution

Scope:

- fix sibling `aura-harness` issues that prevent imported local workspaces from completing end-to-end loops
- make the hello-world local benchmark reliable
- ensure live benchmark failures surface precise causes instead of timing out generically

Exit criteria:

- local hello-world benchmark completes org -> agent -> project -> spec -> task -> build loop reliably

### Phase 5: Add remote-agent benchmark lane

Scope:

- add remote/swarm-backed agent scenarios
- validate provisioning, remote filesystem access, remote terminal access, and remote loop completion
- compare local vs remote duration, tokens, cost, and failure rate

Exit criteria:

- Aura can run the same canonical fixtures through both local and remote agent modes
- deterministic assertions first

Recommended first Aura cases:

- task selection
- blocked reporting
- build-failure recognition
- no-false-success
- correct project targeting

Exit criteria:

- prompt/model changes can be compared without running the full benchmark suite

### Phase 4: Add live benchmark staging lane

Scope:

- real Aura host
- real credentials
- real model-backed build loop
- hello-world benchmark
- browser verification of output

Exit criteria:

- manual or nightly benchmark produces reliable timing/token/cost trend data

### Phase 5: Expand benchmark suite and trend analysis

Scope:

- multiple fixtures from easy to hard
- baseline/candidate comparisons
- historical report retention
- non-inferiority rules for optimizations

Exit criteria:

- Aura can answer "did this change improve the product?" with evidence

## Decision Rules

### PR gate

A PR should not merge if:

- browser smoke regresses
- deterministic workflow E2E regresses
- hard behavior evals regress for touched prompt/runtime areas

### Optimization acceptance rule

A token/cost optimization should only be accepted if:

- scenario pass rate is non-inferior
- required hard checks still pass
- median token or cost usage improves on target scenarios

### Release rule

Before release:

- release-smoke lane passes
- at least one live benchmark fixture passes end-to-end
- no regression against previous baseline on key duration/cost metrics beyond threshold

## Recommended Metrics Dashboard

Aura should eventually store and trend:

- scenario pass rate
- median scenario duration
- p95 scenario duration
- total tasks completed
- failed task rate
- total input tokens
- total output tokens
- total cost
- cost per successful scenario
- duration per successful scenario
- build success rate
- test success rate
- artifact verification rate

These should be visible:

- per benchmark fixture
- per branch/build
- per bundle
- over time

## Immediate Next Steps

1. Keep the current browser smoke lane as the permanent PR sanity layer.
2. Add a second Playwright suite for deterministic workflow E2E using imported fixtures and API-driven lifecycle checks.
3. Add a top-level `evals/promptfoo/` directory to Aura for narrow planning/execution behavior cases.
4. Add a staging-backed live benchmark lane for the hello-world fixture.
5. Start storing run-to-run metric deltas so we can compare candidate vs baseline rather than only reading one-off test output.

## Bottom Line

Paperclip is doing the right thing by not collapsing everything into one test type.

Aura should follow the same shape:

- **Playwright** for browser and workflow sanity
- **Promptfoo** for narrow agent behavior evals
- **production-like smoke** for release confidence
- **benchmark trend tracking** for the thing Aura uniquely sells: autonomous software building effectiveness

That gives us the sanity you asked for:

- we can see end-to-end flow still works
- we can see whether improvements actually help
- we can track time, tokens, cost, and failure rate over time
- and we can keep adding harder projects without redesigning the framework every time
