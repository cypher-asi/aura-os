# Harness Fixture Evals

This document captures the testing pattern we want for Aura's harness work.

## Why this exists

The direct harness benchmark lane is useful for measuring cache usage, context
occupancy, and cost behavior, but it is easy to get false confidence from a
single live run.

The safer pattern is layered:

1. Unit and component tests for the harness logic itself
2. Fixture-backed direct harness scenarios with explicit validators
3. Smaller live suites for cost, speed, reliability, and quality

This matches what we see in stronger agent systems:

- Anthropic and OpenAI both frame evals as a core reliability loop, not an
  optional add-on.
- Aider's SWE Bench harness runs on fresh repo copies and evaluates produced
  artifacts separately from the generation loop.
- Claude Code appears to rely more on smoke tests, transport/session tests, and
  resilient compaction handling than on one giant live harness benchmark.

## What we added

Aura now has a fixture-backed direct harness suite in:

- `evals/local-stack/bin/run-harness-fixture-suite.sh`
- `interface/scripts/lib/harness-benchmark-scenarios.mjs`
- `interface/scripts/run-harness-context-benchmark.mjs`

The new suite adds:

- repo-owned fixture scenarios
- per-fixture validation commands
- prepared-workspace verification before session start
- tool-result capture in the benchmark trace
- stricter scoring: validator-backed scenarios only pass when validation passes

## Current validated finding

The runner now proves a real distinction:

- the prepared workspace on disk contains the expected files
- the live harness session can still return `path not found` for those same
  relative paths

We observed this on fixture-backed scenarios where:

- the runner verified `package.json`, `requirements.md`, and `reference.md`
  existed before the session started
- the harness later returned `tool_result` errors for `read_file` on
  `requirements.md` and `reference.md`

That means the new fixture suite is already paying off: it catches a real
workspace-visibility problem that a looser text-only benchmark could miss.

## Recommended next step

Use the fixture suite as the main harness regression lane for:

- existing-workspace visibility
- relative-path file access
- validator-backed artifact checks

Keep the older generated-workspace lane for cost and context experiments, but
do not use it as the only proof path for harness correctness.
