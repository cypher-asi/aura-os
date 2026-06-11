# Aura Observability

Aura Observability turns live eval probes into a dashboard available from the
Aura OS public-mode website and the authenticated desktop/web app at
`/observability`.

## What It Measures

The feature registry lives in `infra/evals/status/features.json`. Each feature
declares the checks that must stay fresh and the latency/failure thresholds that
translate raw eval results into a public state.

Every check also has an expected-output contract in
`infra/evals/status/check-expectations.json`. The probe runner validates that
contract before allowing a check to pass, and
`infra/evals/status/lib/status-registry.test.mjs` fails locally if a check is
registered without both an expected-output contract and a runner branch.

Current feature groups:

- Core API: `/health`, authenticated session reads, and system metadata.
- Identity and Organizations: auth validation, current user sync, and org membership.
- Public Chat and APIs: guest setup, public chat streaming, feedback, models, and blog APIs.
- Local Agents: local agent creation and runtime response.
- Remote Agents: swarm-backed agent creation, state polling, and runtime response.
- Projects, Specs, and Tasks: project CRUD, spec CRUD, task CRUD, project stats, and loop status.
- Processes: workflow lists, process creation, default node creation, and cleanup.
- Model Responses: curated model matrix through the Aura runtime path.
- Media Generation: image generation by default, with optional 3D and video stream probes.
- Autonomous Build Loop: benchmark and harness fixture outputs.
- Marketplace and Bootstrap: marketplace catalog and harness bootstrap health.
- Integrations and Billing: integrations, tool actions, subscription status, and credits.
- Community and Feedback: feedback, bug reports, feed, leaderboard, and platform stats.
- Desktop Runtime: workspace defaults and terminal session API.
- Streams and Debug: active stream registry and debug project index.
- Eval Artifacts: existing Playwright/benchmark eval summary artifacts.
- Public Website: observability snapshot JSON plus public marketing routes.

## Running Probes

From the repo root:

```sh
npm run status:probes -- --base-url http://127.0.0.1:3190 --token "$AURA_STATUS_ACCESS_TOKEN"
npm run status:snapshot
```

For end-to-end local verification, use the existing eval local stack in
`infra/evals/local-stack/`. The observability page is not served from a sibling
website repo; it is the Aura OS interface route in `interface/`. The
recommended default for feature health is the hybrid stack: Aura OS, the public
frontend, and the harness run locally, while zOS auth, the router, billing, and
swarm-backed dependencies stay pointed at deployed services.

```sh
cp infra/evals/local-stack/stack.env.example infra/evals/local-stack/stack.env
./infra/evals/local-stack/bin/doctor.sh
./infra/evals/local-stack/bin/up-hybrid.sh
source infra/evals/local-stack/.runtime/evals.env
source infra/evals/local-stack/.runtime/auth.env
npm run status:probes -- \
  --base-url http://127.0.0.1:3190 \
  --public-base-url http://127.0.0.1:4173 \
  --token "$AURA_EVAL_ACCESS_TOKEN" \
  --environment local-hybrid
npm run status:snapshot -- --environment local-hybrid --source local-stack
```

Use `./infra/evals/local-stack/bin/up-all.sh` instead of `up-hybrid.sh` when
the goal is to validate local `aura-network`, `aura-storage`, `orbit`, or local
database behavior. Remote-agent checks should run through the hybrid or
production path so local harness execution cannot mask deployed swarm failures.

Default probe runs skip only high-cost optional media checks
(`video-generation-stream`, `model3d-generation-stream`, and public equivalents
if added). Run a deeper media sweep with:

```sh
npm run status:probes -- --base-url http://127.0.0.1:3190 --token "$AURA_STATUS_ACCESS_TOKEN" --include-expensive
```

For Aura OS public-mode page checks against the frontend dev server:

```sh
node infra/evals/status/run-status-probes.mjs \
  --public-base-url http://127.0.0.1:4173 \
  --checks public-observability-page,public-models-page,public-marketing-pages \
  --out-dir /tmp/aura-status-checks \
  --environment local-dev
```

`status:probes` writes check runs under
`infra/evals/reports/status/checks/`. `status:snapshot` reads those runs,
applies `infra/evals/status/lib/status-policy.mjs`, and writes:

- `interface/public/observability/status.json`
- `infra/evals/reports/status/status.json`

The Aura OS React route at `/observability`
(`interface/src/views/marketing/StatusView`) fetches `/observability/status.json` and
renders the snapshot. If the JSON is missing, the page falls back to an explicit
unknown state.

## Publishing

`.github/workflows/aura-observability.yml` runs every 30 minutes and can also
be triggered manually. It runs probes with production secrets, builds the
snapshot even when probes fail, and uploads the generated JSON/check artifacts.

The core production commands are:

```sh
npm run status:probes -- --base-url "$AURA_STATUS_API_BASE_URL" --token "$AURA_STATUS_ACCESS_TOKEN" --environment production
npm run status:snapshot -- --environment production --source github-actions
```

`AURA_STATUS_ACCESS_TOKEN` is optional when
`AURA_STATUS_USER_EMAIL` and `AURA_STATUS_USER_PASSWORD` are present. In that
case the probe runner logs into `AURA_STATUS_API_BASE_URL` with
`POST /api/auth/login` and uses the returned `access_token` in-memory for the
run.

The generated `interface/public/observability/status.json` ships with the Aura OS
interface build, and the `/observability` route reads it directly. No
external status-page service is required for the first version because the
valuable part is the Aura-specific probe catalog and status policy. An external
service only adds value if we later need subscriber notifications, incident
timelines, or multi-region uptime checks independent of Aura's deploy pipeline.
