/**
 * Whitepaper sections for the aura-storage repo (cypher-asi/aura-storage): the
 * execution data layer for agent workflows. Authored from the repo README and
 * docs/api.md. Grouped under the "aura-storage" nav key; sortOrder band 400+.
 */

import { F, type WhitepaperSection } from "./sections-types";

export const AURA_STORAGE_SECTIONS: WhitepaperSection[] = [
  {
    title: "Overview",
    slug: "aura-storage-overview",
    section: "aura-storage",
    sortOrder: 400,
    excerpt:
      "The execution data layer: specs, tasks, sessions, events, project agents, logs, and workflow processes - what happened, paired with aura-network's what exists.",
    body: `# Overview

AURA Storage is the execution data layer for autonomous agent workflows. It owns specs, tasks, sessions, typed events, project-agent assignments, logs, and visual workflow processes - the record of *what happened*.

## Overview

- PostgreSQL-backed Axum service; migrations run on startup. Clients and aura-swarm connect here for execution state.
- Public \`/api/*\` routes use JWT; internal \`/internal/*\` routes use \`X-Internal-Token\`.
- References \`projectId\` UUIDs from \`aura-network\` but does not own user records (\`created_by\` is not validated locally).
- Owns execution *state* ("what happened"); \`aura-network\` owns project *metadata* ("what exists").
- WebSocket broadcasts cover agent status, task transitions, and session lifecycle.

## Architecture

${F}text
 clients (desktop / web / mobile) + aura-swarm
        |  JWT (/api/*)        X-Internal-Token (/internal/*)
        v
 aura-storage (Axum)
   project-agents · specs · tasks · sessions · events · logs · processes
        |
        v
 PostgreSQL                     WS --> agent / task / session updates
${F}

## Internals

Org-scoped routes validate membership through \`aura-network\`, and stats can pull cost data back from it - storage stays focused on execution records while delegating identity/authorization.

${F}text
 process / org-scoped request
   -> aura-network: is caller an org member ? -> allow / deny
 stats request
   -> aura-network: project cost data -> merge into rollup
${F}`,
  },
  {
    title: "Authentication & Org Authorization",
    slug: "aura-storage-auth",
    section: "aura-storage",
    sortOrder: 401,
    excerpt:
      "JWT on public routes, internal token for services, and aura-network membership checks for org-scoped data.",
    body: `# Authentication & Org Authorization

JWT on public routes, an internal token for services, and cross-service org-membership checks for org-scoped data.

## Overview

- Public \`/api/*\` routes require a bearer JWT (Auth0 RS256 + HS256), the same tokens \`aura-network\` accepts.
- Internal \`/internal/*\` routes use the \`X-Internal-Token\` header (aura-swarm, aura-router).
- Unlike \`aura-network\`, storage does **not** auto-create users; \`created_by\` records the JWT subject without validating it locally.
- Process and other org-scoped routes validate membership through \`aura-network\` before reading or mutating.

## Architecture

${F}text
 Authorization: Bearer <jwt>        X-Internal-Token: <secret>
        |                                  |
        v                                  v
 validate (Auth0 JWKS | HS256)       internal extractor
        |                                  |
   org-scoped ? --yes--> aura-network membership check
        |  no                             |
        v                                 v
   record-scoped access            service-to-service routes
${F}

## Internals

Authorization is split: identity is proven by the JWT, but org membership (who may touch org-scoped processes/data) is delegated to \`aura-network\`, so storage never duplicates the org/member tables.

${F}text
 request (orgId) -> GET aura-network membership(orgId, userId) -> member ? proceed : 403
${F}`,
  },
  {
    title: "Project Agents",
    slug: "aura-storage-project-agents",
    section: "aura-storage",
    sortOrder: 402,
    excerpt:
      "Agent-to-project assignment with status tracking and token counters.",
    body: `# Project Agents

The assignment of agents to projects, with live status and token counters.

## Overview

- Tracks which agent is working on which project and its current \`status\` (\`idle\`, \`working\`, ...).
- Maintains per-agent token counters for the project.
- Status updates arrive from aura-swarm via \`POST /internal/project-agents/:id/status\` and broadcast over WebSocket.
- The count of project agents gates project deletion in \`aura-network\`.
- Managed by the \`aura-storage-project-agents\` crate.

## Architecture

${F}text
 Project (UUID from aura-network)
   '--- project agents: { agentId, status(idle|working|...), tokenCount }
              |  POST /internal/project-agents/:id/status
              v
        WS broadcast: agent status changed
${F}

## Internals

This table is the live "who is doing what" view; aura-network reads its count on project delete so a project with active agents cannot be removed out from under them.

${F}text
 aura-network DELETE project -> aura-storage agent count -> 0 ? delete : block
${F}`,
  },
  {
    title: "Specs & Tasks",
    slug: "aura-storage-specs-tasks",
    section: "aura-storage",
    sortOrder: 403,
    excerpt:
      "Requirements documents and the task DAG with an enforced transition state machine.",
    body: `# Specs & Tasks

Markdown specs (requirements) and the task graph that agents execute, governed by an enforced state machine.

## Overview

- Specs are requirements documents attached to a project.
- Tasks form a dependency hierarchy (a DAG) with an enforced status state machine.
- Transitions: \`pending\` -> \`ready\` -> \`in_progress\` -> \`done\` / \`failed\` / \`blocked\`.
- Task transitions broadcast over WebSocket for live boards.
- Managed by the \`aura-storage-specs\` and \`aura-storage-tasks\` crates.

## Architecture

${F}text
 Spec (requirements.md) --> derives --> Tasks (DAG)
                                          |  dependencies
                                          v
                          ready task picked by an agent
${F}

## Internals

The task state machine only permits valid transitions; an agent claims a \`ready\` task, moves it \`in_progress\`, then to a terminal state, with each move emitting a WebSocket event.

${F}text
 pending --(deps met)--> ready --(claim)--> in_progress --+--> done
                                                          +--> failed
                                                          +--> blocked
   every transition -> WS task update
${F}`,
  },
  {
    title: "Sessions & Event Stream",
    slug: "aura-storage-sessions-events",
    section: "aura-storage",
    sortOrder: 404,
    excerpt:
      "Agent execution sessions and the typed event stream (LLM deltas, tool calls, task lifecycle, build/git, loops).",
    body: `# Sessions & Event Stream

Agent execution sessions and the typed events recorded during them.

## Overview

- A session is one agent execution span, linked to a project agent.
- Events are a typed stream: LLM deltas, tool calls, task lifecycle, build/git results, loop activity.
- aura-router writes events via \`POST /internal/events\` (one per LLM call) when session headers are present.
- Session lifecycle changes broadcast over WebSocket.
- Managed by the \`aura-storage-sessions\` and \`aura-storage-events\` crates.

## Architecture

${F}text
 Session (per agent run)
   '--- events (ordered, typed):
          llm_delta · tool_call · task_lifecycle · build · git · loop
              ^  POST /internal/events (aura-router / aura-swarm)
              |
        WS broadcast: session lifecycle
${F}

## Internals

The event stream is append-only and typed, so a session can be replayed or rendered as a timeline; aura-router attaches events to a session only when \`X-Aura-Session-Id\` is supplied.

${F}text
 LLM call -> aura-router -> POST /internal/events { sessionId, type, payload }
                                   -> append to session timeline -> WS
${F}`,
  },
  {
    title: "Logs & Stats",
    slug: "aura-storage-logs-stats",
    section: "aura-storage",
    sortOrder: 405,
    excerpt:
      "Structured project logs and aggregated metrics (tasks, tokens, sessions, cost pulled from aura-network).",
    body: `# Logs & Stats

Structured project logs and the aggregated metrics derived from execution data.

## Overview

- Structured log entries scoped to a project, written by agents/services.
- Stats aggregate tasks, tokens, sessions, and cost.
- Cost figures are pulled from \`aura-network\` usage records and merged into the rollup.
- Logs are written internally via \`POST /internal/logs\`.
- Managed by the \`aura-storage-logs\` crate.

## Architecture

${F}text
 agents / services --POST /internal/logs--> log entries (PostgreSQL)
 execution data (tasks, sessions, events) ----+
 aura-network usage (cost) --------------------+--> stats rollup
${F}

## Internals

Storage owns the execution-side counts (tasks, sessions, tokens) but borrows dollar cost from \`aura-network\`, so a single stats response combines both without duplicating billing data.

${F}text
 stats = { tasks, sessions, tokens (local) } + { cost (aura-network) }
${F}`,
  },
  {
    title: "Processes (Workflow Engine)",
    slug: "aura-storage-processes",
    section: "aura-storage",
    sortOrder: 406,
    excerpt:
      "Visual node-graph workflows: nodes and connections, cron-scheduled or manual runs, per-node events, and sub-processes.",
    body: `# Processes (Workflow Engine)

Visual workflow definitions built as directed node graphs, with scheduled or manual runs and per-node execution records.

## Overview

- A process is a graph of **nodes** (\`ignition\`, \`action\`, \`condition\`, \`prompt\`, \`artifact\`, \`delay\`, \`merge\`, \`sub_process\`, \`for_each\`) joined by **connections** (edges with optional handles).
- A **run** executes the graph: \`pending\` -> \`running\` -> \`completed\` / \`failed\` / \`cancelled\`, with trigger \`manual\` or \`scheduled\`, plus token usage and cost.
- Each node execution produces an **event** capturing input, output, status, tokens, and model.
- Processes are org-scoped, optionally project-linked, cron-schedulable, and support sub-processes via \`parent_run_id\`.
- Managed by the \`aura-storage-processes\` crate.

## Architecture

${F}text
 Process (nodes + connections)
   ignition -> action -> condition --+--> prompt -> artifact
                                     '--> for_each -> sub_process
        |  create Run (manual | scheduled cron)
        v
   Run (pending -> running -> completed|failed|cancelled)
     '--- per-node events { input, output, status, tokens, model }
${F}

## Internals

A scheduler polls \`GET /internal/processes/scheduled\` and creates runs for due cron entries; an executor walks the node graph, emitting an event per node, and nested \`sub_process\` runs link back through \`parent_run_id\`.

${F}text
 scheduler: poll /internal/processes/scheduled -> due ? create Run
 executor: walk nodes -> emit event per node -> artifacts; sub_process -> child Run (parent_run_id)
${F}`,
  },
  {
    title: "Artifacts",
    slug: "aura-storage-artifacts",
    section: "aura-storage",
    sortOrder: 407,
    excerpt:
      "Metadata for outputs produced during runs (reports, documents, data, media, code); file content stays on the local machine.",
    body: `# Artifacts

Metadata for the outputs a process run produces - reports, documents, data files, media, and code.

## Overview

- Artifacts are produced during a run (e.g. by \`artifact\` nodes) and indexed here by metadata.
- Only metadata is stored; the file *content* remains on the local machine.
- Artifacts link to their producing run and node for traceability.
- Generated media artifacts (from \`aura-router\` image/3D generation) are auto-stored when a \`projectId\` is supplied.

## Architecture

${F}text
 Run --produces--> Artifact (metadata)
                     { kind(report|doc|data|media|code), runId, nodeId, ref }
                     content stays local / on S3 (router media)
${F}

## Internals

Keeping content out of the database keeps storage lightweight and lets large outputs live where they are produced; the row is just an index pointing at the real file.

${F}text
 artifact row { metadata, location } -----> actual file (local machine / S3)
${F}`,
  },
  {
    title: "Real-Time Notifications",
    slug: "aura-storage-realtime",
    section: "aura-storage",
    sortOrder: 408,
    excerpt:
      "WebSocket broadcasts for agent status, task transitions, and session lifecycle changes.",
    body: `# Real-Time Notifications

WebSocket broadcasts that keep clients live as execution state changes.

## Overview

- Broadcasts cover project-agent status, task transitions, and session lifecycle.
- Clients subscribe to receive push updates instead of polling.
- Writes from both public and internal routes fan out to subscribers.
- Pairs with \`aura-network\`'s feed WebSocket for a complete live picture.

## Architecture

${F}text
 write (status / task transition / session lifecycle)
        |
        v
 aura-storage WS hub --> subscribed clients (boards, dashboards)
${F}

## Internals

Each mutation that changes visible state emits a typed message after the database commit, so the UI reflects task moves and agent status without a refresh.

${F}text
 commit -> emit { entity, change } -> all subscribed sockets
${F}`,
  },
  {
    title: "Internal Service API",
    slug: "aura-storage-internal-api",
    section: "aura-storage",
    sortOrder: 409,
    excerpt:
      "Headless CRUD for aura-swarm and aura-router: sessions, events, logs, tasks, process runs, and artifact writes.",
    body: `# Internal Service API

The headless surface that aura-swarm and \`aura-router\` use to record execution data, authenticated with \`X-Internal-Token\`.

## Overview

- \`POST /internal/project-agents/:id/status\` updates agent status.
- \`POST /internal/sessions\` creates execution sessions.
- \`POST /internal/events\` writes typed session events (one per LLM call).
- \`POST /internal/logs\` writes structured logs.
- Internal process routes drive executor/scheduler flows; public \`/api/process-*\` routes serve desktop-triggered writes.

## Architecture

${F}text
 aura-swarm orchestration (X-Internal-Token)
   1 POST /internal/project-agents/:id/status
   2 POST /internal/sessions
   3 POST /internal/events   (per LLM call)
   4 POST /internal/logs
 aura-router
   POST /internal/events     (session conversation events)
${F}

## Internals

The internal API mirrors the public records but skips per-user auth so trusted services can stream execution data at speed; desktop clients use the JWT-backed public routes for the same entities.

${F}text
 service (X-Internal-Token) -> write session/event/log/status (no JWT subject)
 desktop (JWT) -------------> same entities via /api/* public routes
${F}`,
  },
];
