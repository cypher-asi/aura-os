# External Agent Benchmark Adapters

This document defines the next evaluation layer for Aura: black-box benchmark adapters that run the same coding task against different agent runtimes and normalize the results into one comparison format.

For the latest measured results and practical benchmark notes, see [External Agent Benchmark Findings](./external-agent-benchmark-findings.md).

## Why this exists

Aura already has strong internal benchmark lanes:

- direct harness cache/context benchmarks
- live Aura OS API benchmarks
- deterministic browser and workflow evals

Those tell us whether Aura itself is improving. They do not answer a different product question:

> How does Aura compare to other serious coding agents on the same task?

The external adapter benchmark layer answers that question.

## Design goals

1. Keep the comparison fair.
   - same fixture
   - same task prompt
   - same validator
   - same time budget
2. Treat each tool as a black box.
   - compare outcomes first
   - compare telemetry only when the tool exposes it
3. Reuse Aura's existing fixtures and validators.
4. Make unsupported telemetry explicit instead of inventing fake parity.

## V1 scope

V1 is intentionally small:

- adapters:
  - `aura`
  - `claude-code`
  - `codex`
- scenarios:
  - `external-static-site`
  - `external-node-server-patch`
- mode:
  - single-shot task execution
  - validator-backed grading

We are not trying to model every session feature from every vendor in V1. The goal is to get a trustworthy baseline comparison harness in place first.

## Adapter contract

Each adapter implements the same shape:

1. `checkEnvironment()`
   - verify the CLI or backend is available
   - return warnings/errors before a run starts
2. `runScenario()`
   - execute one scenario in a prepared workspace
   - capture transcript, timing, usage, and raw artifacts when available
3. `normalizeResult()`
   - map tool-specific output into the shared result schema

The shared schema is intentionally outcome-first:

- adapter id
- scenario id
- success / failure
- quality pass / fail
- wall clock runtime
- model/provider when known
- token/cache/context fields when known
- transcript artifact path
- patch artifact path
- changed files
- validator result

Unknown fields stay `null`.

## Why single-shot first

Aura's direct harness benchmarks are already good at multi-turn context analysis. External vendor comparison has a different job:

- hold the repo and task constant
- check whether the tool completes the task well
- capture runtime and cost when available

Single-shot scenarios keep the first version:

- easier to reason about
- easier to reproduce
- less coupled to vendor-specific resume/session semantics

Multi-turn resume-aware comparisons can come later.

## Scenario model

Each external scenario points at an existing fixture workspace and validator, but supplies a single benchmark prompt designed for black-box tools.

That means:

- Aura keeps using the same fixture assets
- Claude Code and Codex can be run in the same workspace
- post-run grading stays identical across all tools

## Adapter behavior

### Aura adapter

Uses the harness websocket session directly and runs the scenario prompt as a single turn.

Why:

- keeps Aura on its native runtime path
- preserves rich harness telemetry
- avoids unnecessary product-loop noise for this comparison layer

### Claude Code adapter

Runs `claude --print` in the prepared workspace.

V1 uses:

- non-interactive execution
- best-effort transcript capture
- validator-based grading as the source of truth

### Codex adapter

Runs `codex exec` in the prepared workspace.

V1 uses:

- non-interactive execution
- JSONL capture when available
- validator-based grading as the source of truth

## Evidence model

The result hierarchy is:

1. validator result
2. workspace diff and changed files
3. runtime / timing
4. tool-native usage telemetry

This avoids over-weighting token telemetry differences between tools with very different reporting surfaces.

## Current limitations

- no multi-turn resume benchmarking yet
- no OpenCode adapter yet
- Claude Code and Codex telemetry is best-effort
- Aura remains the only adapter with strong cache/context telemetry in V1

## Next steps after V1

1. Add `opencode` adapter
2. Add resume-aware multi-turn scenarios
3. Add repeated-read scenarios for cache-heavy comparisons
4. Add summary reports that rank tools by:
   - quality
   - runtime
   - cost
   - telemetry richness
