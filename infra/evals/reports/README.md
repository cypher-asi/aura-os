# Aura Eval Reports

This directory stores repo-owned baseline artifacts for Aura's evaluation system.

Current baselines:

- `baselines/smoke-summary.json` for browser smoke coverage
- `baselines/workflow-summary.json` for deterministic workflow coverage

These are compared against fresh Playwright eval summaries in CI so we can detect regressions in pass/fail state, failed-task counts, completion, token usage, cost, and major timing drift.
