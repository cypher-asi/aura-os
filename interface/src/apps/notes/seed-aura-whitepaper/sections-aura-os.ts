/**
 * Whitepaper sections for the aura-os repo (cypher-asi/aura-os): the product
 * and control-plane layer on top of the AURA Harness. Authored from this
 * repo's crates/apps/interface and docs/. Grouped under the "aura-os" nav key;
 * sortOrder band 100+.
 */

import { F, type WhitepaperSection } from "./sections-types";

export const AURA_OS_SECTIONS: WhitepaperSection[] = [
  {
    title: "Overview",
    slug: "aura-os-overview",
    section: "aura-os",
    sortOrder: 100,
    excerpt:
      "The product and control-plane layer on the harness: turns requirements into specs and tasks, orchestrates agent sessions, and ships server + web + desktop surfaces.",
    body: `# Overview

AURA OS is the product and control-plane layer built on top of the AURA Harness runtime. It turns requirements into structured specs and executable tasks, orchestrates autonomous agent sessions, and exposes that workflow through a server API, a web interface, and a native desktop shell.

## Overview

- A modular Rust workspace of domain crates (\`aura-os-projects\`, \`aura-os-agents\`, \`aura-os-sessions\`, \`aura-os-tasks\`, ...) plus shared wire types (\`aura-protocol\`) and a harness adapter (\`aura-os-harness\`).
- The harness stays the runtime authorization and execution boundary; AURA OS owns capability definitions, the integration catalog, and brokering.
- Local-first posture: client state in IndexedDB, lightweight host JSON state (\`aura-os-store\`); durable data is optional remote services.
- Surfaces: \`apps/aura-os-server\` (HTTP/WS API), \`interface/\` (React SPA + Capacitor mobile), \`apps/aura-os-desktop\` (native shell).
- Optional cloud backends: \`aura-storage\`, \`aura-network\`, \`z-billing\`, and the integrations service.

## Architecture

${F}text
 React SPA / mobile  +  desktop shell (WebView)
        |  REST + SSE/WS (/api, /ws)
        v
 aura-os-server  (control plane: handlers, EventHub, LoopRegistry)
        |  RuntimeRequest + installed capabilities
        v
 AURA Harness  (POST /v1/run, WS /stream/:run_id)  -- executes + enforces
        |
        v
 optional remote: aura-storage · aura-network · z-billing · integrations
${F}

## Internals

AURA OS orchestrates and brokers; the harness executes and enforces. The control plane assembles a \`RuntimeRequest\` (identity, model, permissions, capabilities) and streams harness events back to the UI.

${F}text
 user intent -> server builds RuntimeRequest -> harness runs -> stream events -> UI
                       |                                            |
                 capabilities / integrations              sessions / tasks / logs (remote)
${F}`,
  },
  {
    title: "Control Plane & API Host",
    slug: "aura-os-control-plane",
    section: "aura-os",
    sortOrder: 101,
    excerpt:
      "The Axum HTTP/WS gateway: auth, routing, app state, the event hub, loop registry, and static UI serving.",
    body: `# Control Plane & API Host

\`apps/aura-os-server\` is the control-plane gateway: it authenticates requests, routes them to domain handlers, serves the web UI, and fans real-time events back to clients.

## Overview

- Axum HTTP API plus WebSockets; serves the built \`interface/\` SPA as static assets.
- Auth and session types live in \`aura-os-auth\`; handlers route to the domain crates.
- \`aura-os-events\` provides a typed \`EventHub\` with topic-scoped subscriptions.
- \`aura-os-loops\` tracks per-connection loop activity via a \`LoopRegistry\`.
- The desktop's embedded server proxies shared-data requests to the remote services.

## Architecture

${F}text
 client --> Axum router
   |  auth (aura-os-auth)
   |  /api/* handlers --> domain crates (projects, agents, sessions, tasks, ...)
   |  /ws    --> EventHub (aura-os-events) topic subscriptions
   |  static --> interface/ SPA
        |
        v
 LoopRegistry (aura-os-loops) tracks active dev-loops per connection
${F}

## Internals

The server is a thin composition root: it validates and routes, delegates work to domain crates and the harness bridge, and publishes results onto the \`EventHub\` so every subscribed client sees them live.

${F}text
 request -> handler -> domain crate / harness bridge -> result
                                   |
                                   v
                          EventHub.publish(topic) -> WS subscribers
${F}`,
  },
  {
    title: "Harness Runtime Bridge",
    slug: "aura-os-harness-bridge",
    section: "aura-os",
    sortOrder: 102,
    excerpt:
      "The single adapter to the AURA Harness: submits runs, streams events, and proxies harness management APIs.",
    body: `# Harness Runtime Bridge

\`aura-os-harness\` is the one adapter between AURA OS and the harness runtime. Everything that runs an agent goes through it.

## Overview

- Submits runs over the harness wire: \`POST /v1/run\` then \`WS /stream/:run_id\`.
- Normalizes harness stream events into AURA OS event types via a WS bridge.
- Wire shapes are shared through \`aura-protocol\` (\`RuntimeRequest\`, stream messages), kept in sync with the harness.
- Supports a local bundled harness or a remote swarm harness behind one interface.
- Hosts the automaton client used by the dev loop.

## Architecture

${F}text
 aura-os-server -> aura-os-harness adapter
        |  RuntimeRequest (aura-protocol)
        v
 POST /v1/run --> { run_id, event_stream_url }
        |
 WS /stream/:run_id --> harness events --> normalize --> EventHub
        |
   local harness  |  remote swarm harness   (same adapter interface)
${F}

## Internals

The bridge is the only place that speaks the harness protocol, so swapping local vs swarm execution, or evolving the wire, touches exactly one crate.

${F}text
 RuntimeRequest -> harness -> stream(TextDelta / ToolResult / AssistantMessageEnd)
                                   -> event_normalization -> AURA OS events
${F}`,
  },
  {
    title: "Workspace Model",
    slug: "aura-os-workspace-model",
    section: "aura-os",
    sortOrder: 103,
    excerpt:
      "The Project -> Spec -> Task hierarchy plus the agent and session lifecycle that drives execution.",
    body: `# Workspace Model

The core domain: projects contain specs, specs derive tasks, and agents execute tasks within sessions.

## Overview

- \`aura-os-projects\` manages projects (network-backed with a local-compat path).
- \`aura-os-agents\` manages agent templates, instances, and runtime state.
- \`aura-os-sessions\` owns session lifecycle, context usage, and storage integration (including context rollover).
- \`aura-os-tasks\` enforces the task state machine: \`pending\` -> \`ready\` -> \`in_progress\` -> terminal.
- \`aura-os-storage\` persists specs/tasks/sessions remotely when configured.

## Architecture

${F}text
 Project
   '--- Spec (requirements) --> derives --> Task DAG
                                              |  ready
                                              v
                            Agent picks task -> Session -> harness run
                                              |
                                              v
                                  context rollover (new session + summary)
${F}

## Internals

A session fills with execution events until context pressure triggers a rollover - a new session carries a summary forward - so long-running work continues without losing the audit trail.

${F}text
 session fills -> context usage high ? -> rollover: new session + carry-forward summary
   tasks advance pending -> ready -> in_progress -> done/failed/blocked
${F}`,
  },
  {
    title: "Capabilities, Integrations & Credentials",
    slug: "aura-os-capabilities",
    section: "aura-os",
    sortOrder: 104,
    excerpt:
      "The control plane owns capability definitions and the integration catalog; the integrations service owns secrets; the harness owns runtime auth.",
    body: `# Capabilities, Integrations & Credentials

A three-way split: AURA OS defines and brokers capabilities, the integrations service holds the secrets, and the harness enforces authorization at runtime.

## Overview

- \`aura-os-integrations\` is the client to the integrations microservice, the provider catalog, trusted dispatch, and harness projection.
- AURA OS owns capability definitions and enablement; it projects \`InstalledTool\` / \`InstalledIntegration\` into a run.
- The integrations service is the canonical store of org secrets; AURA OS brokers retrieval but does not persist credentials.
- The harness is the runtime authorization and execution boundary (policy-checked tool calls).
- \`aura-os-orgs\` carries org membership and org integrations.

## Architecture

${F}text
 integrations service  <- canonical org secrets
        ^  retrieve / broker (authorized)
        |
 AURA OS: catalog · enablement · InstalledTool/Integration projection
        |  session injection (policy-checked)
        v
 Harness runtime  <- authorization + execution + audit
        |
 trusted integration dispatch routes back through AURA OS
${F}

## Internals

Secrets never live in AURA OS or the harness record; the control plane projects only the capabilities a session may use, and the harness gates each tool call against policy.

${F}text
 enable capability -> project InstalledTool into RuntimeRequest
   -> harness policy check per tool call -> broker secret on demand (authorized)
${F}`,
  },
  {
    title: "Autonomous Dev Loop & Observability",
    slug: "aura-os-dev-loop",
    section: "aura-os",
    sortOrder: 105,
    excerpt:
      "Continuous task execution with loop logging, run heuristics, and debug surfaces.",
    body: `# Autonomous Dev Loop & Observability

The dev loop drives continuous, autonomous task execution and records everything for analysis.

## Overview

- The server's dev-loop handlers run an agent against ready tasks until a spec is complete.
- \`aura-loop-log-schema\` defines the on-disk schema for dev-loop run bundles.
- \`aura-run-heuristics\` is a rule engine that flags dev-loop pathologies (e.g. repeated blockers, token hogs, slow iterations).
- \`apps/aura-run-analyze\` is a CLI over those heuristics for offline bundle analysis.
- The web \`debug\` app surfaces runs and signals for inspection.

## Architecture

${F}text
 dev loop: pick ready task -> harness run -> result -> next task ...
        |  emit loop-log bundle (aura-loop-log-schema)
        v
 aura-run-heuristics (rules) -> signals (repeated_blocker, token_hog, slow_iteration, ...)
        |
        v
 aura-run-analyze (CLI)  +  interface/ debug app
${F}

## Internals

Each loop iteration appends to a structured run bundle; heuristics replay the bundle to synthesize signals, turning raw runs into actionable observations.

${F}text
 run bundle (iterations) -> heuristic rules -> signals -> analyze CLI / debug UI
${F}`,
  },
  {
    title: "Execution Surfaces",
    slug: "aura-os-execution-surfaces",
    section: "aura-os",
    sortOrder: 106,
    excerpt:
      "The terminal, browser, and file/workspace tooling agents use at runtime.",
    body: `# Execution Surfaces

The concrete surfaces an agent acts through at runtime: a terminal, a headless browser, and workspace file tooling.

## Overview

- \`aura-os-terminal\` provides a PTY-based terminal for agent command execution.
- \`aura-os-browser\` provides headless browser sessions (a stub or a CDP / Chromium backend).
- Server handlers expose terminal and browser endpoints to the UI.
- File/workspace tooling is driven through the harness tool pipeline.
- \`aura-os-channels\` bridges external messaging (Telegram-first) into agent chats.

## Architecture

${F}text
 agent (via harness tools)
   |--- terminal --> aura-os-terminal (PTY) --> shell
   |--- browser  --> aura-os-browser (CDP / Chromium) --> web
   |--- files    --> harness FS tools --> workspace
 external chat --> aura-os-channels (Telegram) --> agent session
${F}

## Internals

Each surface is a separate crate behind a backend trait, so a browser session can run as a no-op stub in CI or a full Chromium backend in production without changing callers.

${F}text
 aura-os-browser: BrowserBackend trait -> { stub | CDP/Chromium }
 aura-os-terminal: PTY session per agent command
${F}`,
  },
  {
    title: "Remote Services Layer",
    slug: "aura-os-remote-services",
    section: "aura-os",
    sortOrder: 107,
    excerpt:
      "Optional cloud backends for sync, durable execution data, billing, and repos - each behind a thin client crate.",
    body: `# Remote Services Layer

AURA OS talks to the core platform services through thin client crates; all are optional, enabling a local-first or cloud-synced deployment.

## Overview

- \`aura-os-network\` syncs orgs/projects and wraps the Orbit Git/repo client (maps to AURA Network).
- \`aura-os-storage\` reads/writes remote execution data - tasks, specs, sessions, notes (maps to AURA Storage).
- \`aura-os-billing\` is the credits/usage/balance client (maps to Z-Billing).
- \`aura-os-auth\` provides JWT/session types and auth against external APIs.
- When the remote URLs are unset, the host falls back to local JSON state (\`aura-os-store\`).

## Architecture

${F}text
 aura-os-network  --> AURA Network (orgs, projects, Orbit repos)
 aura-os-storage  --> AURA Storage (specs, tasks, sessions, notes)
 aura-os-billing  --> Z-Billing   (credits, usage, balance)
 aura-os-auth     --> zOS / external auth
        |  (URLs unset)
        v
 aura-os-store (local JSON KV) - local-first fallback
${F}

## Internals

Each client crate isolates a single backend, so the same control plane runs fully local (no remotes) or cloud-synced (all remotes) by configuration alone.

${F}text
 configured ? remote client (HTTP) : local aura-os-store (JSON KV)
${F}`,
  },
  {
    title: "Web & Mobile Interface",
    slug: "aura-os-interface",
    section: "aura-os",
    sortOrder: 108,
    excerpt:
      "The React/TypeScript SPA: app shell, ~16 registered shell apps, streaming UI, Zustand + React Query, and Capacitor mobile shells.",
    body: `# Web & Mobile Interface

\`interface/\` is the React 19 + TypeScript SPA (Vite), shipped on web, desktop (WebView), and mobile (Capacitor).

## Overview

- \`App.tsx\` + \`AppShell\` boot the shell; marketing/public routes are lazy-loaded (including this \`/os\` whitepaper).
- ~16 registered shell apps (agents, chat, projects, tasks, process, feed, notes, integrations, debug, ...), each with routes and lazy panels.
- State via Zustand stores and React Query; the vendored ZUI component library provides UI primitives.
- Client persistence in IndexedDB; auth token helpers in \`shared/lib\`.
- Capacitor packages the same SPA as iOS/Android apps.

## Architecture

${F}text
 main.tsx -> App.tsx -> AppShell
   |  app registry (~16 apps): Left / Main / Sidekick panels (lazy)
   |  Zustand stores + React Query  ·  ZUI components
   |  REST + SSE/WS to aura-os-server
        |
        v
 web  ·  desktop (WebView)  ·  mobile (Capacitor)
${F}

## Internals

Each shell app declares routes and lazily-loaded panels, so the bundle stays small and a route only pulls in its app's code when first opened.

${F}text
 route change -> lazy import app chunk -> mount Left/Main/Sidekick panels
   streaming: SSE/WS -> store update -> React re-render
${F}`,
  },
  {
    title: "Desktop Native Shell",
    slug: "aura-os-desktop",
    section: "aura-os",
    sortOrder: 109,
    excerpt:
      "The packaged product: an embedded server, a WebView, an auto-updater, computer-use, and native bridges.",
    body: `# Desktop Native Shell

\`apps/aura-os-desktop\` packages AURA OS as a native application: it embeds the server, renders the SPA in a WebView, and adds native capabilities.

## Overview

- Built on tao + wry: a native window hosting a WebView that loads the built \`interface/\`.
- Embeds \`apps/aura-os-server\` in-process and points the WebView at it via a loopback host.
- Ships an auto-updater and computer-use (native input/screen) support.
- \`apps/aura-os-ide\` is a secondary IDE-window helper.
- Release tooling produces signed installers per platform.

## Architecture

${F}text
 aura-os-desktop (tao + wry)
   |--- embedded aura-os-server (loopback)
   |--- WebView -> interface/ SPA (?host=loopback)
   |--- updater · computer_use (input/screen) · native bridges
${F}

## Internals

The desktop is a thin native wrapper: it boots the same server the cloud runs, then loads the same web UI against it, so one codebase serves web, desktop, and mobile.

${F}text
 launch -> start embedded server -> open WebView(host=127.0.0.1:port) -> same SPA
   updater checks releases -> download -> apply on restart
${F}`,
  },
];
