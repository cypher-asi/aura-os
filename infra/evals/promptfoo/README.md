# Aura Behavior Evals

This directory is the starting point for Aura's narrow agent-behavior evals.

These evals are intentionally separate from Playwright/browser flows:

- Playwright covers product flow and lifecycle sanity.
- Promptfoo will cover narrower planning and execution decisions.

Initial target behaviors:

- choose the correct task
- report blocked state clearly
- avoid false success claims
- use the correct project context
- recognize build failure and respond appropriately

Run locally with the deterministic local bundle providers:

```bash
cd evals/promptfoo
npm install
npm run eval
```

For CI, use:

```bash
cd evals/promptfoo
npm ci
npm run eval:ci
```

`eval:ci` writes a machine-readable report to `evals/reports/promptfoo-results.json`.
