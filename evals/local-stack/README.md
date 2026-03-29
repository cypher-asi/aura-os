# Aura Local Integration Stack

This module turns the eval system into a real local integration lane.

It is designed for Aura's actual repo shape today:

- `aura-os` lives in this repo
- core dependencies live in sibling repos
- some sibling repos already ship Docker assets
- others are still most reliable when run directly with `cargo run`

So the stack is intentionally hybrid.

## What runs where

Docker-managed:

- PostgreSQL for `aura-network`
- PostgreSQL for `aura-storage`
- PostgreSQL for `orbit`
- `aura-harness` when `AURA_STACK_HARNESS_RUNTIME=docker`

Host-managed via helper scripts:

- `aura-network`
- `aura-storage`
- `orbit`
- `aura-harness` by default for local evals (`AURA_STACK_HARNESS_RUNTIME=host`)
- `aura-os-server`
- Aura frontend (`vite`)

Remote by default:

- zOS auth
- `aura-router`
- `z-billing`

That gets us a strong local lane without forcing brittle ad hoc Dockerfiles onto every sibling repo on day one.

## Why this exists

The current mocked workflow lane proves the Aura lifecycle at the browser and API-contract level, but not the real multi-repo environment.

This stack adds the missing middle layer:

- real local `aura-network`
- real local `aura-storage`
- real local `orbit`
- real local harness
- configurable remote overrides per service

That makes it possible to:

- test Aura against a mostly real local platform
- swap one service at a time to Render-hosted URLs during bring-up
- run the live benchmark lane against localhost instead of waiting for full staging

## Files

- `docker-compose.yml`
- `stack.env.example`
- `bin/doctor.sh`
- `bin/up.sh`
- `bin/down.sh`
- `bin/up-all.sh`
- `bin/down-all.sh`
- `bin/status.sh`
- `bin/up-hybrid.sh`
- `bin/status-hybrid.sh`
- `bin/render-envs.sh`
- `bin/run-service.sh`
- `bin/bootstrap-auth.sh`
- `bin/run-benchmark.sh`
- `bin/run-hybrid-benchmark.sh`
- `bin/run-one-shot.sh`
- `bin/run-hybrid-one-shot.sh`

## Prerequisites

- Docker with Compose
- Rust toolchain
- Node.js and npm
- sibling repos checked out under the same parent directory as this repo:
  - `../aura-network`
  - `../aura-storage`
  - `../orbit`
  - `../aura-harness`

## Configure

Copy the template:

```bash
cp evals/local-stack/stack.env.example evals/local-stack/stack.env
```

Then update the values that matter for your machine.

The most important one is:

```bash
AURA_STACK_AUTH_COOKIE_SECRET=...
```

Local `aura-network`, `aura-storage`, and `orbit` accept the same zOS JWT family Aura already uses. In practice that means the local services need the shared cookie secret so they can validate the HS256 tokens the Aura app stores after login.

You can also flip individual services to remote mode:

```bash
AURA_STACK_NETWORK_MODE=remote
AURA_STACK_REMOTE_NETWORK_URL=https://aura-network.onrender.com
```

Or use the built-in hybrid preset that keeps `aura-os` and the frontend local
while targeting deployed services for the rest of the stack:

```bash
AURA_STACK_PRESET=hybrid-swarm
```

That preset currently maps to:

- `https://aura-network.onrender.com`
- `https://aura-storage.onrender.com`
- `https://orbit-sfvu.onrender.com`
- `http://ab6d2375031e74ce1976fdf62ea951a4-e757483aaffba396.elb.us-east-2.amazonaws.com`

Supported modes are:

- `local`
- `remote`
- `disabled`

Available mode switches:

- `AURA_STACK_NETWORK_MODE`
- `AURA_STACK_STORAGE_MODE`
- `AURA_STACK_ORBIT_MODE`
- `AURA_STACK_HARNESS_MODE`

The harness also has a local runtime switch:

- `AURA_STACK_HARNESS_RUNTIME=host`
- `AURA_STACK_HARNESS_RUNTIME=docker`

`host` is the default because the local benchmark imports workspaces into the
Aura OS data directory, and the host-run harness can read those paths directly.
Use `docker` only when the harness has access to the same workspace tree via a
compatible mount strategy.

For benchmark runs, the harness also needs command tools enabled so generated
projects can execute their real `build` and `test` commands. The stack now
defaults to enabling them with a configurable allowlist:

```bash
AURA_STACK_HARNESS_ENABLE_CMD_TOOLS=true
AURA_STACK_HARNESS_ALLOWED_COMMANDS=npm,node,npx,pnpm,bun,cargo,python,python3,pytest,go,git
```

## Bring the stack up

The simplest end-to-end test command is:

```bash
./evals/local-stack/bin/run-one-shot.sh "Hello world static site benchmark"
```

That command will:

- tear down any previous local stack
- bring the local stack up
- run the live benchmark
- clean up the benchmark agent/project artifacts
- tear the stack back down when it finishes

Set `AURA_STACK_KEEP_UP=1` if you want the services to remain up afterward for
manual inspection.

If you want the stack to stay up for normal local work, the shortest setup is:

```bash
./evals/local-stack/bin/up-all.sh
```

For the swarm-backed hybrid setup, use:

```bash
./evals/local-stack/bin/up-hybrid.sh
```

That command will:

- validate repo paths and tool availability
- render `.runtime/*.env` files for each service
- start Docker-managed infra
- start host-managed services in the background
- wait for health on every local service
- attempt auth bootstrap from an existing Aura session if one is available

If you want the lower-level steps, you can still do them manually.

Start only the Docker-managed dependencies:

```bash
./evals/local-stack/bin/doctor.sh
./evals/local-stack/bin/up.sh
```

That will:

- validate repo paths and tool availability
- render `.runtime/*.env` files for each service
- start the Postgres containers
- optionally start the harness container when `AURA_STACK_HARNESS_RUNTIME=docker`

Then run the host services in separate terminals:

```bash
./evals/local-stack/bin/run-service.sh network
./evals/local-stack/bin/run-service.sh storage
./evals/local-stack/bin/run-service.sh orbit
./evals/local-stack/bin/run-service.sh harness
./evals/local-stack/bin/run-service.sh aura-os
./evals/local-stack/bin/run-service.sh frontend
```

Seed the isolated Aura server with an existing local Aura login:

```bash
./evals/local-stack/bin/bootstrap-auth.sh
```

By default that copies the access token from `http://127.0.0.1:3100` into the isolated Aura server on `http://127.0.0.1:3190`. Override `AURA_STACK_AUTH_SOURCE_URL` in `stack.env` if your already-authenticated Aura instance lives somewhere else.

At that point the typical local URLs are:

- Aura frontend: `http://127.0.0.1:4317`
- Aura server: `http://127.0.0.1:3190`
- aura-network: `http://127.0.0.1:3401`
- aura-storage: `http://127.0.0.1:3402`
- orbit: `http://127.0.0.1:3403`
- aura-harness: `http://127.0.0.1:3404`

## Run evals against the local stack

The rendered eval env file lives at:

- `evals/local-stack/.runtime/evals.env`

Run the live benchmark lane like this:

```bash
set -a
source evals/local-stack/.runtime/evals.env
set +a

export AURA_EVAL_ACCESS_TOKEN="$(
  curl -fsSL http://127.0.0.1:3190/api/auth/access-token \
    | sed -n 's/.*"access_token":"\\([^"]*\\)".*/\\1/p'
)"

cd frontend
npm run test:evals:benchmark
```

Or use the helper:

```bash
./evals/local-stack/bin/run-benchmark.sh
./evals/local-stack/bin/run-benchmark.sh "Hello world static site benchmark"
```

For the swarm-backed hybrid lane:

```bash
./evals/local-stack/bin/run-hybrid-benchmark.sh
./evals/local-stack/bin/run-hybrid-benchmark.sh "Hello world static site benchmark"
```

Or use the full one-shot runner that handles stack bring-up and teardown too:

```bash
./evals/local-stack/bin/run-one-shot.sh "Hello world static site benchmark"
```

And for the hybrid one-shot path:

```bash
./evals/local-stack/bin/run-hybrid-one-shot.sh "Hello world static site benchmark"
```

By default the live benchmark now cleans up the project agent, project, and
agent that it created after the run. Set `AURA_EVAL_KEEP_ENTITIES=1` if you
want to preserve benchmark artifacts for debugging. Org reuse is preferred over
org churn because there is no org delete route yet.

## Hybrid Notes

The hybrid preset is meant for the common developer setup where:

- Aura OS and the frontend run locally
- `aura-network`, `aura-storage`, and `orbit` point at deployed services
- remote agent execution points at the swarm gateway

That gives you a realistic remote-backed workflow without needing every sibling
repo running locally. In this mode the local harness autospawn is disabled so
Aura OS does not silently fall back to localhost execution. If your deployed Aura app already has a valid session, set
`AURA_STACK_AUTH_SOURCE_URL` to that host before running `up-hybrid.sh` or
`run-hybrid-one-shot.sh` so the local Aura OS instance can import the same auth
session automatically.

The local stack does not create a fake auth provider. It uses a real zOS-backed Aura session, then routes that session into the local sibling services.

## Rendered env files

The helper writes these files:

- `.runtime/aura-network.env`
- `.runtime/aura-storage.env`
- `.runtime/orbit.env`
- `.runtime/aura-os.env`
- `.runtime/evals.env`

Source them before running the corresponding process.

Example:

```bash
set -a
source evals/local-stack/.runtime/aura-os.env
set +a

cargo run -p aura-os-server
```

The `run-service.sh` wrapper already does this for you.

## Shut it down

```bash
./evals/local-stack/bin/down-all.sh
```

For a full clean reset, including persisted Postgres and harness data:

```bash
./evals/local-stack/bin/down-all.sh --volumes
```

For the lower-level Docker-only stop:

```bash
./evals/local-stack/bin/down.sh
```

## Current limits

- `aura-network`, `aura-storage`, and `orbit` are still run directly from source rather than from first-party Docker images.
- Billing remains remote by default.
- Auth remains remote by default.
- This is a local integration lane, not a packaged release-smoke lane yet.

That is still the right next step for Aura. It gives us real end-to-end service wiring now, while leaving room for a heavier full-container release-smoke environment later.
