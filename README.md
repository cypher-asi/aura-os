<h1 align="center">AURA</h1>

<p align="center">
  <b>Continuous Agentic Coding</b><br>
  A local desktop app that turns requirements into structured specs and autonomously executes implementation tasks against a linked codebase.
</p>

<p align="center">
  <a href="#overview">Overview</a> · <a href="#quick-start">Quick Start</a> · <a href="#architecture">Architecture</a> · <a href="#principles">Principles</a> · <a href="#specs">Specs</a>
</p>

## Overview

Aura is a desktop application for continuous agentic coding. It reads a project's `requirements.md`, uses AI to generate a structured implementation spec, extracts ordered tasks, and then runs an autonomous development loop that works through those tasks against a linked local code repository.

The core workflow follows a strict hierarchy: **Project → Spec → Task**. Agents operate within sessions, rotating context automatically when the window fills, so execution can continue indefinitely without manual intervention.

Core state lives in RocksDB on-device. The backend is Rust (Axum), the frontend is React + TypeScript served through a native desktop shell (tao + wry), and the LLM provider is the Claude API. Optional remote services (configured via `.env`) include **aura-network** (orgs/project sync), **aura-storage** (execution data), **billing** (credits), and **Orbit** (Git/repo hosting). You can run fully local with only `ANTHROPIC_API_KEY` set.

---

## Core Concepts

1. **Projects:** The top-level container. Each project links a `requirements.md` file to a local codebase folder. All specs, tasks, and agents belong to a project.

2. **Specs:** AI-generated structured implementation plans produced from the project requirements. Each spec is a standalone markdown file, ordered from most foundational to least foundational, covering purpose, interfaces, use cases, and dependencies.

3. **Tasks:** Concrete units of work extracted from specs. Each task tracks its own state through a full lifecycle: `pending` → `ready` → `in_progress` → `done` / `failed` / `blocked`. Tasks carry dependency information so the agent loop can resolve execution order automatically.

4. **Agents & Sessions:** Autonomous workers that execute tasks. An agent picks the next available task, loads relevant spec context, performs the work against the local codebase, and updates state. When the context window fills past a threshold, the agent rolls over into a new session, carrying forward only a compressed summary, and continues seamlessly.

---

## Quick Start

### Prerequisites

- Rust toolchain (1.85.0+)
- Node.js and npm
- [ZUI](https://github.com/cypher-asi/zui) cloned as a sibling directory (`../zui`) if you use the ZUI terminal component

### Environment and `.env`

Copy the example env file and set at least your Claude API key:

```bash
cp .env.example .env
```

Edit `.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | Your Anthropic API key for spec generation and agent execution |
| `BILLING_SERVER_URL` | No | Credits/billing server (default: `https://billing.zero.tech`) |
| `AURA_NETWORK_URL` | No | aura-network backend for orgs/sync (e.g. `https://aura-network.onrender.com`). Omit for local-only. |
| `AURA_NETWORK_AUTH_TOKEN` | No | Auth token for aura-network (when using `AURA_NETWORK_URL`) |
| `AURA_STORAGE_URL` | No | aura-storage URL for execution data (e.g. `https://aura-storage.onrender.com`). Omit to disable. |
| `ORBIT_BASE_URL` | No | URL of the **standalone Orbit service** (host and port). Aura connects to this service as a client; it does not run the Orbit API. Omit to disable Orbit features. |
| `GITHUB_APP_*` | No | GitHub App ID, private key, and slug for repository linking |

The server reads `.env` from the current working directory when you run `aura-server` or `aura-desktop`.

### Server URLs (local development)

- **Backend (Axum):** `http://127.0.0.1:3100` — API at `/api`, WebSocket at `/ws`
- **Frontend (Vite dev):** `http://localhost:5173` — proxies `/api` and `/ws` to the backend

### Run backend

From the repo root (so `.env` is found):

```bash
cargo run -p aura-server
```

The Axum server listens on `http://127.0.0.1:3100`.

### Run frontend (dev)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` to `http://localhost:3100`, so the backend must be running.

### Run desktop app

Build the frontend once, then run the desktop shell (it embeds the server and frontend):

```bash
cd frontend && npm run build && cd ..
cargo run -p aura-desktop
```

Run from the repo root so `.env` is loaded. The desktop app bundles the server and frontend into a single native window via WebView.

### Optional services

- **aura-network** — When `AURA_NETWORK_URL` (and optionally `AURA_NETWORK_AUTH_TOKEN`) is set, the app can sync organizations and projects with a shared backend (e.g. `https://aura-network.onrender.com`).
- **aura-storage** — When `AURA_STORAGE_URL` is set, execution data can be stored in a remote store (e.g. `https://aura-storage.onrender.com`). Omit for local-only execution.
- **Billing** — `BILLING_SERVER_URL` defaults to `https://billing.zero.tech`; set `BILLING_INTERNAL_TOKEN` if your billing server requires it.
- **Orbit** — Third-party standalone service for Git/repo hosting. Set `ORBIT_BASE_URL` to the Orbit service URL (e.g. `https://orbit.your-domain.com` or `http://localhost:PORT`). Aura does not run Orbit; it only connects to it as a client.

---

## Principles

1. **Local-First:** Core project and execution state lives in RocksDB on your machine. Remote services (aura-network, aura-storage, billing, Orbit) are optional; you can run with only an API key and no cloud.
2. **Autonomous:** The dev loop runs continuously. Context rotation happens automatically when sessions fill, so the agent can work through an entire spec without manual intervention.
3. **Transparent:** Every piece of work traces back through Task → Spec → Project. Execution logs, agent state, and session summaries are all persisted and visible in the UI.
4. **Extensible:** A modular Rust workspace with clean domain boundaries. Each crate owns a single concern, making it straightforward to add new capabilities or swap components.

---

## Architecture

| Crate | Description |
| --- | --- |
| **aura-desktop** | Standalone desktop GUI (tao + wry WebView) |
| **aura-server** | HTTP API server (Axum) serving the frontend and API routes |
| **aura-ide** | IDE helper library for the desktop shell |
| **aura-core** | Shared entity types, IDs, and enums |
| **aura-store** | RocksDB persistence layer and storage abstractions |
| **aura-claude** | Claude API client |
| **aura-terminal** | Terminal emulation for agent command execution |
| **aura-projects** | Project CRUD and lifecycle management |
| **aura-specs** | Spec generation, storage, and streaming |
| **aura-tasks** | Task state machine, extraction, and transitions |
| **aura-agents** | Agent and agent instance management |
| **aura-sessions** | Session lifecycle and context rotation |
| **aura-auth** | Authentication and session tokens |
| **aura-orgs** | Organization CRUD, members, and invites |
| **aura-billing** | Credit tiers, balance, and checkout |
| **aura-settings** | API key management and app configuration |
| **aura-github** | GitHub App integration and repository linking |
| **aura-engine** | AI orchestration and autonomous dev loop |
| **aura-chat** | Chat and streaming orchestration |
| **aura-tools** | AI tool definitions (file operations, commands) |
| **frontend** | React 19 + TypeScript SPA (Vite) |

---

## Project Structure

```
aura-app/
  Cargo.toml                # Rust workspace root
  apps/
    desktop/                # Native desktop shell (tao + wry)
    server/                 # Axum HTTP API
    ide/                    # IDE helper lib
  crates/
    ai/
      engine/               # Dev loop orchestration
      chat/                 # Chat / streaming
      tools/                # AI tool definitions
    domain/
      projects/             # Project management
      specs/                # Spec generation and storage
      tasks/                # Task state machine
      agents/               # Agent lifecycle
      sessions/             # Session and context rotation
      auth/                 # Authentication
      orgs/                 # Organizations
      billing/              # Credits and checkout
      settings/             # API keys and config
      github/               # GitHub integration
    infra/
      core/                 # Shared types and entity IDs
      store/                # RocksDB backend
      claude/               # Claude API client
      terminal/             # Terminal emulation
  frontend/                 # React + TypeScript SPA
    src/
      api/                  # API client and SSE streams
      apps/                 # Feature apps (projects, agents, feed)
      components/           # Shared UI components
      context/              # React context providers
      hooks/                # Custom hooks
      views/                # Page-level views
  specs/                    # Implementation spec documents (01–10)
  requirements.md           # MVP requirements
```

---

## License

MIT
