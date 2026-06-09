/**
 * Seed content for the documentation CMS (the public `/docs` page).
 *
 * The docs are organized by repository / package. Each entry below becomes
 * a published note under the reserved aura-docs project; the `section`
 * field doubles as the collapsible left-nav group key on the public page
 * (the repository name), and `sortOrder` controls both the group order
 * (smallest first) and the within-group order. All pages are fully
 * editable afterwards by sys admins in the Notes app.
 */

/**
 * Markdown fence token. Kept as a double-quoted constant so the section
 * bodies below can embed fenced code blocks without escaping every
 * backtick.
 */
const F = "```";

export interface DocsSection {
  /** Human title; also the left-nav label for the page. */
  title: string;
  /** URL slug (stable, kebab-case). */
  slug: string;
  /** Collapsible section group key (the repository / package name). */
  section: string;
  /** Group + within-group order (ascending). */
  sortOrder: number;
  /** Short summary (shown as the listing lede). */
  excerpt: string;
  /** Markdown body. */
  body: string;
}

/** Display name for a section key. Extend as new top-level groups land. */
export const SECTION_LABELS: Readonly<Record<string, string>> = {
  "getting-started": "Getting Started",
  "aura-os-server": "aura-os-server",
  "aura-os-desktop": "aura-os-desktop",
  interface: "interface",
  "aura-protocol": "aura-protocol",
  "external-services": "External Services",
  "internal-crates": "Internal Crates",
  zui: "vendor/zui",
};

export const DOCS_SECTIONS: DocsSection[] = [
  {
    title: "Introduction",
    slug: "introduction",
    section: "getting-started",
    sortOrder: 0,
    excerpt:
      "What AURA OS is, how the repository is laid out, and how these API docs are organized.",
    body: `# Introduction

AURA OS is a single Git monorepo containing a **Rust Cargo workspace** (runnable apps plus library crates) and a standalone **React + TypeScript** frontend in \`interface/\`. The primary HTTP API is served by \`aura-os-server\` (Axum); the desktop shell embeds that same server and adds native bridge endpoints.

## How these docs are organized

The documentation is grouped by **repository / package**. Even though everything lives in one Git repo, each logical package exposes its own API surface, so each gets its own section in the left nav:

| Section | What it covers |
|---------|----------------|
| Getting Started | Orientation, architecture, and the auth model. |
| aura-os-server | The local HTTP + WebSocket API (the main surface). |
| aura-os-desktop | Native bridge endpoints added by the desktop shell. |
| interface | The frontend TypeScript API client and generated bindings. |
| aura-protocol | The harness wire protocol shared with \`aura-harness\`. |
| External Services | Client contracts for services that live outside this repo. |
| Internal Crates | Rust domain/service crates (in-process APIs, not HTTP). |
| vendor/zui | The vendored design-system component library. |

## Where the source of truth lives

- Backend routes: \`apps/aura-os-server/src/router/\`
- Frontend client map: \`interface/src/api/client.ts\` and \`interface/src/shared/api/\`
- Wire protocol bindings: \`crates/aura-protocol/bindings/\`

These pages are a living scaffold: they summarize each surface and document representative endpoints in depth. Sys admins can expand any page directly in the Notes app.`,
  },
  {
    title: "Architecture",
    slug: "architecture",
    section: "getting-started",
    sortOrder: 1,
    excerpt:
      "The high-level layout: Rust workspace, the Axum server, the React SPA, and the external services.",
    body: `# Architecture

## Repository layout

${F}text
aura-os/
  apps/            runnable binaries
    aura-os-server     Axum HTTP API + static SPA host
    aura-os-desktop    native WebView shell (embeds the server)
    aura-os-ide        IDE window helper library
    aura-run-analyze   dev-loop bundle analysis CLI
  crates/          Rust libraries (domain + service clients)
  interface/       React 19 + TypeScript SPA (Vite)
  vendor/zui/      vendored @cypher-asi/zui design system
  docs/            curated markdown docs
${F}

## Request flow

${F}text
Browser (interface SPA)
   │  fetch /api/*  ·  ws /ws/*
   ▼
aura-os-server (Axum, port 3100/3101)
   │  Rust service crates (aura-os-*)
   ▼
External services (aura-network, aura-storage, z-billing,
                   aura-integrations, zOS auth, aura-harness)
${F}

## Tech stack

| Layer | Technologies |
|-------|--------------|
| Backend | Rust, Tokio, Axum, tower-http, reqwest, serde |
| Desktop | tao, wry (WebView), cargo-packager |
| Frontend | React 19, TypeScript, Vite, React Router, Zustand, TanStack Query |
| UI | Vendored ZUI, CSS modules |
| Auth | zOS API (external), JWT sessions |

## Ports

- \`3100\` — stable channel server
- \`3101\` — dev channel server
- \`5173\` / \`5174\` — Vite dev server (proxies \`/api\` and \`/ws\` to the backend)`,
  },
  {
    title: "Authentication & Access",
    slug: "authentication",
    section: "getting-started",
    sortOrder: 2,
    excerpt:
      "JWT bearer sessions, the verified-session middleware, and how system-administrator access is determined.",
    body: `# Authentication & Access

## Sessions

Authenticated requests carry a JWT in the \`Authorization: Bearer <token>\` header. WebSocket connections pass the token as a \`?token=\` query parameter or a short-lived ws-ticket. Most \`/api/*\` routes sit behind a \`require_verified_session\` middleware; the \`/api/public/*\` family is mounted **outside** that middleware and is fully anonymous.

## Endpoint tiers

| Tier | Examples | Auth |
|------|----------|------|
| Public | \`/api/public/blog\`, \`/api/public/docs\`, \`/api/public/chat/stream\` | none |
| Authenticated | \`/api/projects\`, \`/api/agents\`, \`/api/users/me\` | JWT |
| Sys-admin | writes to the reserved CMS projects (blog, whitepaper, docs) | JWT + \`is_sys_admin\` |

## System administrators

\`is_sys_admin\` is the authoritative flag for elevated access. It is sourced from the aura-network user record and an email allowlist (\`SYS_ADMIN_EMAILS\`). The server enforces it with:

${F}rust
pub(crate) fn require_sys_admin(session: &ZeroAuthSession) -> ApiResult<()> {
    if !session.is_sys_admin {
        return Err(ApiError::forbidden("requires system administrator access"));
    }
    Ok(())
}
${F}

The frontend exposes \`useIsSysAdmin()\` for UI gating only — the server is always the source of truth. The three reserved CMS projects (\`aura-blog\`, \`aura-whitepaper\`, \`aura-docs\`) are writable only by sys admins; their published notes are served anonymously through the public endpoints.`,
  },
  {
    title: "Overview & Route Map",
    slug: "server-overview",
    section: "aura-os-server",
    sortOrder: 10,
    excerpt:
      "The Axum server entry point, router assembly, and the full map of route modules.",
    body: `# aura-os-server — Overview

\`aura-os-server\` is the primary HTTP API. It is an **Axum 0.7 + Tokio** application that also serves the built SPA from \`interface/dist\` when present.

| Property | Value |
|----------|-------|
| Entry point | \`apps/aura-os-server/src/main.rs\` |
| Router assembly | \`apps/aura-os-server/src/router/mod.rs\` |
| Default port | \`3100\` (stable) / \`3101\` (dev) |
| Auth | JWT bearer; WebSockets use \`?token=\` or ws-ticket |

## Route modules

Every domain lives in its own module under \`apps/aura-os-server/src/router/\`:

| Module | Domain |
|--------|--------|
| \`auth.rs\` | Login, register, session, ws-ticket |
| \`users_orgs_billing.rs\` | Users, orgs, credits, subscriptions |
| \`projects_files.rs\` | Projects, artifacts, local file browse |
| \`specs.rs\` | Spec CRUD + AI generation |
| \`tasks.rs\` | Task lifecycle + dev-loop single-task run |
| \`agents.rs\` | Agents, instances, sessions, chat streams |
| \`streams.rs\` | Resumable SSE streams, subagent attach |
| \`channels.rs\` | Telegram channel links |
| \`social.rs\` | Feed, follows, leaderboard, usage |
| \`feedback.rs\` / \`bug_reports.rs\` | Product feedback + bug reports |
| \`public.rs\` | Anonymous \`/api/public/*\` |
| \`runtime.rs\` | Dev loop, terminal, browser, WebSockets, system |
| \`harness_proxy.rs\` | Proxy to harness memory/skills |
| \`notes.rs\` | Notes tree (blog/whitepaper/docs writes) |
| \`process_generation.rs\` | Process automations + media generation |
| \`marketplace_bootstrap.rs\` | Marketplace + agent bootstrap |
| \`debug_loops.rs\` | Debug runs, loop registry, admin health |

## Conventions

- Responses reuse \`aura-storage\` \`Storage*\` types directly (already \`serde\` camelCase), so there is no duplicate DTO layer.
- Errors funnel through \`ApiError\` / \`ApiResult\`, which map upstream storage 404s to HTTP 404s.
- The health probe is \`GET /health\`.`,
  },
  {
    title: "Auth API",
    slug: "server-auth-api",
    section: "aura-os-server",
    sortOrder: 11,
    excerpt:
      "Login, registration, session lifecycle, invites, and ws-ticket issuance.",
    body: `# Auth API

Defined in \`apps/aura-os-server/src/router/auth.rs\`.

## Public

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/api/auth/login\` | Exchange credentials for a session JWT. |
| POST | \`/api/auth/register\` | Create an account. |
| POST | \`/api/auth/logout\` | Invalidate the current session. |
| POST | \`/api/auth/request-password-reset\` | Begin a password reset. |
| POST | \`/api/invite/:code/validate\` | Validate an invite code. |
| POST | \`/api/capture/session\` | Capture an anonymous pre-auth session. |

## Authenticated

| Method | Path | Purpose |
|--------|------|---------|
| GET | \`/api/auth/session\` | Resolve the current session. |
| POST | \`/api/auth/validate\` | Validate a token. |
| POST | \`/api/auth/ws-ticket\` | Mint a short-lived ticket for WebSocket auth. |
| POST | \`/api/auth/delete-account\` | Delete the caller's account. |
| GET | \`/api/invite/me\` | The caller's invite status. |

## Example

${F}bash
curl -X POST https://localhost:3100/api/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{ "email": "me@example.com", "password": "…" }'
${F}

The returned JWT is sent on every subsequent request as \`Authorization: Bearer <token>\`.`,
  },
  {
    title: "Projects & Files API",
    slug: "server-projects-files-api",
    section: "aura-os-server",
    sortOrder: 12,
    excerpt:
      "Project CRUD, artifacts, and the local filesystem browse/read endpoints.",
    body: `# Projects & Files API

Defined in \`apps/aura-os-server/src/router/projects_files.rs\`. All routes require an authenticated session.

## Projects

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | \`/api/projects\` | List / create projects. |
| GET/PATCH/DELETE | \`/api/projects/:id\` | Read / update / delete a project. |
| POST | \`/api/projects/import\` | Import an existing project. |
| POST | \`/api/projects/:id/archive\` | Archive a project. |
| GET | \`/api/projects/:id/stats\` | Project statistics. |

## Artifacts

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | \`/api/projects/:id/artifacts\` | List / create artifacts. |
| GET | \`/api/artifacts/:id\` | Read an artifact. |
| GET | \`/api/artifacts/:id/thumbnail\` | Artifact thumbnail. |

## Local files

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/api/list-directory\` | List a directory on the host. |
| POST | \`/api/read-file\` | Read a file's contents. |
| POST | \`/api/file-preview\` | A bounded preview of a file. |

## Uploads

Large binaries are uploaded via a presign flow:

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/api/upload/presign\` | Get a presigned S3 PUT URL + object key. |

Markdown bodies for notes / blog / docs are uploaded through this same flow (see \`interface/src/api/upload.ts\`).`,
  },
  {
    title: "Agents & Chat API",
    slug: "server-agents-chat-api",
    section: "aura-os-server",
    sortOrder: 13,
    excerpt:
      "Agent CRUD, project-bound instances, sessions, and the streaming chat (SSE) endpoints.",
    body: `# Agents & Chat API

Defined in \`apps/aura-os-server/src/router/agents.rs\` and \`streams.rs\`. All routes require an authenticated session.

## Agents

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | \`/api/agents\` | List / create agents. |
| GET/PATCH/DELETE | \`/api/agents/:id\` | Read / update / delete an agent. |
| POST | \`/api/agents/:id/events/stream\` | Stream agent events as SSE. |
| POST | \`/api/agents/:id/reset-session\` | Reset the agent's session. |
| POST | \`/api/agents/:id/cancel-turn\` | Cancel the in-flight turn. |
| GET | \`/api/agents/:id/context-usage\` | Token / context usage. |

## Sessions

| Method | Path | Purpose |
|--------|------|---------|
| GET | \`/api/projects/:id/sessions\` | Sessions for a project. |
| GET | \`/api/me/sessions\` | The caller's sessions. |
| POST | \`/api/sessions/:id/share\` | Make a session publicly shareable. |
| GET | \`/api/sessions/:id/subagents\` | Subagent sessions. |

## Streams

| Method | Path | Purpose |
|--------|------|---------|
| GET | \`/api/streams/active\` | Currently active streams. |
| GET | \`/api/streams/:attach_id\` | Attach to a resumable stream. |
| POST | \`/api/streams/:attach_id/cancel\` | Cancel a stream. |

## SSE shape

Streaming endpoints emit Server-Sent Events; each \`data:\` line is a JSON envelope describing a chunk, tool call, or lifecycle transition. Clients reconnect via the \`attach_id\` to resume a stream without losing buffered frames.`,
  },
  {
    title: "Public API",
    slug: "server-public-api",
    section: "aura-os-server",
    sortOrder: 14,
    excerpt:
      "The anonymous /api/public/* family: setup, chat, share, blog, whitepaper, docs, and generation.",
    body: `# Public API

Defined in \`apps/aura-os-server/src/router/public.rs\` and \`handlers/public/\`. Mounted **outside** the auth middleware — no JWT is required or inspected.

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/api/public/setup\` | Bootstrap an anonymous guest session. |
| POST | \`/api/public/chat/stream\` | Rate-limited anonymous chat (SSE). |
| GET | \`/api/public/feedback\` | Public feedback board passthrough. |
| GET | \`/api/public/models\` | Public model catalog passthrough. |
| GET | \`/api/public/share/:token\` | Read a shared session transcript. |
| GET | \`/api/public/blog\` | Published blog posts (newest first). |
| GET | \`/api/public/blog/:slug\` | A single published blog post. |
| GET | \`/api/public/os\` | Published whitepaper sections (in order). |
| GET | \`/api/public/os/:slug\` | A single published whitepaper section. |
| GET | \`/api/public/docs\` | Published doc pages (in \`sortOrder\`). |
| GET | \`/api/public/docs/:slug\` | A single published doc page. |
| POST | \`/api/public/generation/{image,video,model3d}\` | Env-gated generation. |

## CMS-backed reads

\`/blog\`, \`/os\`, and \`/docs\` are all the same pattern: the pages are notes under a reserved project, authored by sys admins, with markdown bodies stored on S3. The public endpoints return only **published** rows, resolved server-side with an internal token (no caller JWT). The markdown body is **not** part of the JSON payload — it lives at the row's public S3 \`bodyUrl\` and is fetched separately by the browser.

## Generation toggle

The three generation endpoints are mounted only when \`AURA_PUBLIC_GENERATION_ENABLED\` is not \`false\`/\`0\`/\`no\`/\`off\` (default on), so ops can disable the expensive modalities without disabling public chat.`,
  },
  {
    title: "WebSockets",
    slug: "server-websockets",
    section: "aura-os-server",
    sortOrder: 15,
    excerpt:
      "The real-time WebSocket endpoints for events, terminals, browser sessions, and remote agents.",
    body: `# WebSockets

Defined alongside the HTTP routes (notably \`runtime.rs\`). WebSocket auth uses a \`?token=\` query parameter or a ws-ticket minted from \`POST /api/auth/ws-ticket\`.

| Path | Purpose |
|------|---------|
| \`/ws/events\` | Global domain events stream. |
| \`/ws/terminal/:id\` | PTY terminal I/O. |
| \`/ws/browser/:id\` | Browser CDP session. |
| \`/ws/agents/:id/remote_agent/terminal\` | Remote swarm terminal. |

## Companion HTTP endpoints

WebSocket sessions are created/managed over HTTP first:

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/api/terminal\` | Create a terminal session. |
| DELETE | \`/api/terminal/:id\` | Kill a terminal. |
| POST | \`/api/browser\` | Create a browser session. |
| DELETE | \`/api/browser/:id\` | Close a browser. |

The typed event payloads come from \`aura-os-events\` (\`DomainEvent\`); the terminal and browser backends live in \`aura-os-terminal\` and \`aura-os-browser\`.`,
  },
  {
    title: "Native Bridge API",
    slug: "desktop-overview",
    section: "aura-os-desktop",
    sortOrder: 30,
    excerpt:
      "The OS-level endpoints the desktop shell merges on top of the embedded server.",
    body: `# aura-os-desktop — Native Bridge API

The desktop app (\`apps/aura-os-desktop\`) is a \`tao\` + \`wry\` WebView shell that **embeds** \`aura-os-server\` and merges additional native-only routes (\`apps/aura-os-desktop/src/net/server.rs\`). These endpoints exist only when running inside the desktop binary.

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/api/pick-folder\` | Native folder picker dialog. |
| POST | \`/api/pick-file\` | Native file picker dialog. |
| GET/POST | \`/api/last-route\` | Persist / restore the last UI route. |
| POST | \`/api/open-path\` | Reveal a path in the OS file manager. |
| POST | \`/api/write-file\` | Write a file to the host filesystem. |
| POST | \`/api/open-ide\` | Open a secondary IDE window. |
| GET | \`/api/runtime-config\` | Desktop runtime flags. |
| POST | \`/api/update-*\` | Auto-updater (stable channel). |
| POST | \`/api/computer/{action,screenshot,abort}\` | Computer-use executor. |

The frontend talks to these through \`interface/src/shared/api/desktop.ts\`. When the SPA runs in a plain browser (not the desktop shell) these endpoints are absent, and the client degrades gracefully.`,
  },
  {
    title: "Frontend API Client",
    slug: "interface-overview",
    section: "interface",
    sortOrder: 40,
    excerpt:
      "The React SPA, its central api client object, and the generated protocol bindings.",
    body: `# interface — Frontend API Client

\`interface/\` is the React 19 + TypeScript SPA built with Vite. In dev it runs on port \`5173\`/\`5174\` and proxies \`/api\` and \`/ws\` to the backend.

## The \`api\` object

The central client is \`interface/src/api/client.ts\`, which exposes one module per backend domain:

${F}text
auth, orgs, projects, tasks, agents, sessions, desktop, loop,
follows, users, profiles, feed, feedback, leaderboard,
platformStats, usage, activity, environment, swarm, channels,
superAgent, process, memory, harnessSkills, notes, marketplace,
debug, streams, shares
${F}

Implementations live in \`interface/src/shared/api/\` (plus a few app-specific modules under \`interface/src/api/\`). Each module maps closely to the matching \`aura-os-server\` route group.

## Marketing clients

Public, unauthenticated pages use dedicated clients under \`interface/src/api/marketing/\`:

- \`blog.ts\` — \`/api/public/blog\` (prod-pinned host in dev).
- \`os.ts\` — \`/api/public/os\` (same-origin).
- \`docs.ts\` — \`/api/public/docs\` (same-origin).

## Generated bindings

TypeScript types for the harness wire protocol are generated from Rust and synced to \`interface/src/shared/types/generated/protocol/\`. Do not hand-edit them — regenerate from \`crates/aura-protocol/bindings/\`.

## State & data

- **Zustand** stores for client state (auth, notes, projects, …).
- **TanStack Query** for server data fetching and caching.
- **CSS modules** for styling, on top of the vendored ZUI components.`,
  },
  {
    title: "Harness Wire Protocol",
    slug: "protocol-overview",
    section: "aura-protocol",
    sortOrder: 50,
    excerpt:
      "The request/stream contract shared between aura-os and the external aura-harness.",
    body: `# aura-protocol — Harness Wire Protocol

\`crates/aura-protocol\` defines the wire contract between aura-os and the agent harness. It is the shared source of truth for both the Rust client (\`aura-os-harness\`) and the generated TypeScript bindings consumed by the SPA.

## Key types

- \`RuntimeRequest\` — the payload that starts a run.
- WebSocket message envelopes — streamed run events (chunks, tool calls, lifecycle).

## Harness endpoints (served by \`aura-harness\`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/v1/run\` | Start a run. |
| WS | \`/stream/:run_id\` | Stream run events. |
| POST | \`/v1/run/:id/{pause,stop,resume,status}\` | Control a run. |
| GET/POST | \`/v1/agents/*\` | Swarm agent management. |

## Bindings

TypeScript bindings are generated into \`crates/aura-protocol/bindings/\` and synced into the SPA. Because the protocol crate sits at the boundary, any change here ripples to both the server's \`aura-os-harness\` client and the frontend types — regenerate bindings as part of the change.`,
  },
  {
    title: "External Services Overview",
    slug: "external-services-overview",
    section: "external-services",
    sortOrder: 60,
    excerpt:
      "The services that live in separate repos/deployments and the Rust client crates that call them.",
    body: `# External Services — Overview

Several services AURA OS depends on are **not vendored in this repo**. \`aura-os-server\` talks to them via env-configured HTTP client crates. Each client crate documents the upstream API contract from the caller's perspective.

| Service | Client crate | Configured by |
|---------|--------------|---------------|
| aura-network | \`crates/aura-os-network\` | \`AURA_NETWORK_URL\` |
| aura-storage | \`crates/aura-os-storage\` | \`AURA_STORAGE_URL\` + internal token |
| z-billing | \`crates/aura-os-billing\` | billing service URL |
| aura-integrations | \`crates/aura-os-integrations\` | integrations service URL |
| zOS auth | \`crates/aura-os-auth\` | \`zosapi.zero.tech\` |
| aura-harness | \`crates/aura-os-harness\` | harness URL |

See \`.env.example\` for the full set of environment variables. The following pages summarize each upstream surface.`,
  },
  {
    title: "aura-network",
    slug: "external-aura-network",
    section: "external-services",
    sortOrder: 61,
    excerpt:
      "Users, orgs, projects, social graph, feed, leaderboard, and access codes.",
    body: `# aura-network

Client: \`crates/aura-os-network\` (\`NetworkClient\`, plus \`OrbitClient\` for Git/repo operations). This is the system-of-record for accounts, organizations, and the social graph.

## Surface (client expectations)

| Group | Paths |
|-------|-------|
| Users | \`/api/users/*\` |
| Orgs | \`/api/orgs/*\` |
| Projects | \`/api/projects/*\` |
| Agents | \`/api/agents/*\` |
| Social | \`/api/follows\`, \`/api/feed\`, \`/api/posts/*\`, \`/api/leaderboard\` |
| Usage | \`/api/stats\`, \`/api/usage\` |
| Access | \`/api/access-codes/*\` |

\`aura-os-server\` merges aura-network data with local state where relevant (for example \`aura-os-projects\` reconciles network + local projects). Orbit (\`OrbitClient\`) handles repository discovery and Git operations and is also external.`,
  },
  {
    title: "aura-storage",
    slug: "external-aura-storage",
    section: "external-services",
    sortOrder: 62,
    excerpt:
      "Durable execution data: tasks, specs, sessions, agents, artifacts, logs, notes.",
    body: `# aura-storage

Client: \`crates/aura-os-storage\` (\`StorageClient\`). Stores durable, project-scoped execution data. The server resolves anonymous CMS reads with its own \`X-Internal-Token\` against the internal endpoints here.

## Surface (client expectations)

| Group | Paths |
|-------|-------|
| Tasks | \`/api/projects/:id/tasks\`, \`/api/tasks/:id\` |
| Specs | \`/api/projects/:id/specs\`, \`/api/specs/:id\` |
| Sessions | \`/api/projects/:id/sessions\`, \`/api/sessions/:id\` |
| Agents | \`/api/projects/:id/agents\`, \`/api/project-agents/:id\` |
| Artifacts / Logs | \`/api/projects/:id/artifacts\`, \`.../logs\` |
| Notes | \`/api/notes/*\`, \`/api/projects/:id/notes\`, \`.../note-folders\` |
| Processes | \`/api/processes/*\` |

## StorageNote

The blog, whitepaper, and docs CMS all persist as \`StorageNote\` rows (\`crates/aura-os-storage/src/types/note.rs\`). The markdown body is **not** stored in the row — only metadata plus an S3 reference (\`bodyUrl\` / \`bodyS3Key\`). Relevant fields: \`title\`, \`slug\`, \`sortOrder\`, \`status\` (\`draft\`/\`published\`), \`blogType\` (the section/repository key), \`excerpt\`, \`publishedAt\`.`,
  },
  {
    title: "z-billing",
    slug: "external-z-billing",
    section: "external-services",
    sortOrder: 63,
    excerpt: "Credits balance, purchases, transactions, and account provisioning.",
    body: `# z-billing

Client: \`crates/aura-os-billing\` (\`BillingClient\`). Backs credits and subscriptions.

## Surface (client expectations)

| Method | Path | Purpose |
|--------|------|---------|
| GET | \`/v1/credits/balance\` | Current credit balance. |
| POST | \`/v1/credits/purchase\` | Purchase credits. |
| GET | \`/v1/credits/transactions\` | Transaction history. |

\`aura-os-server\` surfaces these to the SPA through \`/api/orgs/:org_id/credits/*\` and \`/api/subscriptions/*\` (see \`router/users_orgs_billing.rs\`).`,
  },
  {
    title: "aura-integrations",
    slug: "external-aura-integrations",
    section: "external-services",
    sortOrder: 64,
    excerpt: "Third-party integration config and the tool/provider manifest catalog.",
    body: `# aura-integrations

Client: \`crates/aura-os-integrations\` (\`IntegrationsClient\`). Manages per-org third-party integrations and the provider/tool manifest catalog.

## Surface (client expectations)

| Method | Path | Purpose |
|--------|------|---------|
| GET/PUT | \`/api/orgs/:org_id/integrations\` | Read / update an org's integrations. |

The provider catalog and tool manifests are exposed to the SPA through the org tool-action endpoints in \`router/users_orgs_billing.rs\` (including MCP tool actions).`,
  },
  {
    title: "zOS Auth",
    slug: "external-zos-auth",
    section: "external-services",
    sortOrder: 65,
    excerpt: "The upstream identity provider used to mint and validate sessions.",
    body: `# zOS Auth

Client: \`crates/aura-os-auth\` (\`AuthService\`), pointing at \`https://zosapi.zero.tech\`. This is the upstream identity provider behind the server's auth routes.

## Surface (client expectations)

| Path | Purpose |
|------|---------|
| \`/api/v2/accounts/*\` | Account lifecycle. |
| \`/api/users/current\` | Current user. |
| \`/api/v2/users/me\` | Current user (v2). |

The session JWTs that gate \`/api/*\` are issued/validated against this service. \`is_sys_admin\` is derived from the resolved user record plus the \`SYS_ADMIN_EMAILS\` allowlist.`,
  },
  {
    title: "aura-harness",
    slug: "external-aura-harness",
    section: "external-services",
    sortOrder: 66,
    excerpt: "The agent runtime that executes runs and streams events.",
    body: `# aura-harness

Client: \`crates/aura-os-harness\` (\`HarnessClient\`, plus \`LocalHarness\` / \`SwarmHarness\`). Executes agent runs and streams their events back to the server, which relays them to the SPA over SSE / WebSockets.

## Surface (client expectations)

| Method | Path | Purpose |
|--------|------|---------|
| POST | \`/v1/run\` | Start a run. |
| WS | \`/stream/:run_id\` | Stream run events. |
| POST | \`/v1/run/:id/{pause,stop,resume,status}\` | Control a run. |
| GET/POST | \`/v1/agents/*\` | Swarm agent management. |

The wire contract is defined in \`aura-protocol\` (see that section). \`aura-os-server\` proxies harness memory and skills through \`/api/harness/*\` (\`router/harness_proxy.rs\`).`,
  },
  {
    title: "Domain Crates Overview",
    slug: "internal-crates-overview",
    section: "internal-crates",
    sortOrder: 80,
    excerpt:
      "The in-process Rust service crates that the apps compose (not HTTP servers).",
    body: `# Internal Crates — Overview

These crates under \`crates/\` are **internal Rust APIs** consumed by \`aura-os-server\` and \`aura-os-desktop\`. They are not HTTP servers; their public surface is their \`lib.rs\` exports.

| Crate | Purpose | Key exports |
|-------|---------|-------------|
| \`aura-os-core\` | Shared entities, IDs, enums | \`Project\`, \`Task\`, \`Agent\`, \`Session\`, \`JwtProvider\` |
| \`aura-os-store\` | Local JSON settings store | \`SettingsStore\`, \`BatchOp\` |
| \`aura-os-orgs\` | Local org integration shadow | \`OrgService\` |
| \`aura-os-projects\` | Project merge (network + local) | \`ProjectService\` |
| \`aura-os-agents\` | Agent templates / instances | \`AgentService\`, \`AgentInstanceService\` |
| \`aura-os-sessions\` | Session lifecycle | \`SessionService\` |
| \`aura-os-tasks\` | Task state machine | \`safe_transition\`, \`TaskService\` |
| \`aura-os-terminal\` | PTY terminal | \`TerminalId\`, spawn / kill |
| \`aura-os-browser\` | CDP browser backend | \`BrowserManager\`, \`CdpBackend\` |
| \`aura-os-channels\` | Telegram bridge | \`ChannelService\`, \`TelegramConnector\` |
| \`aura-os-events\` | Typed event hub | \`EventHub\`, \`DomainEvent\` |
| \`aura-os-loops\` | In-process loop registry | \`LoopRegistry\` |
| \`aura-loop-log-schema\` | Dev-loop bundle schema | \`RunMetadata\` |
| \`aura-run-heuristics\` | Run bundle analyzer | \`analyze\`, \`Finding\` |

## Layering

Crates depend only on lower or same layers; upward edges fail CI. The full layered architecture is documented in the AURA OS whitepaper (\`/os\`).`,
  },
  {
    title: "ZUI Component Library",
    slug: "zui-overview",
    section: "zui",
    sortOrder: 90,
    excerpt:
      "The vendored design system that provides the SPA's UI primitives.",
    body: `# vendor/zui — Component Library

\`vendor/zui\` is the vendored \`@cypher-asi/zui\` design system. It provides the UI primitives the SPA builds on (shell, menus, inputs, overlays). It is consumed as a normal package import, not a REST API.

## Notes

- Source and docs live under \`vendor/zui/\` (\`vendor/zui/README.md\`, \`vendor/zui/docs/\`).
- Vendoring is maintained per \`docs/zui-vendoring.md\`; update through that process rather than editing vendored output ad hoc.
- The marketing pages (blog, whitepaper, docs) deliberately use scoped CSS modules for their reading layouts rather than ZUI components, so their typography is self-contained.`,
  },
];
