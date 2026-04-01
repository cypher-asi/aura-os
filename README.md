<h1 align="center">AURA</h1>

<p align="center">
  <b>Continuous Agentic Coding</b><br>
  A local desktop app that turns requirements into structured specs and autonomously executes implementation tasks against agent workspaces.
</p>

<p align="center">
  <a href="#overview">Overview</a> · <a href="#quick-start">Quick Start</a> · <a href="#architecture">Architecture</a> · <a href="#principles">Principles</a> · <a href="#specs">Specs</a>
</p>

## Overview

Aura is a desktop application for continuous agentic coding. It reads a project's `requirements.md`, uses AI to generate a structured implementation spec, extracts ordered tasks, and then runs an autonomous development loop that works through those tasks against the attached agent's workspace.

The core workflow follows a strict hierarchy: **Project → Spec → Task**. Agents operate within sessions, rotating context automatically when the window fills, so execution can continue indefinitely without manual intervention.

Core state lives in RocksDB on-device. The backend is Rust (Axum), the interface is React + TypeScript served through a native desktop shell (tao + wry), and the LLM provider is the Claude API. Optional remote services (configured via `.env`) include **aura-network** (orgs/project sync), **aura-storage** (execution data), **billing** (credits), and **Orbit** (Git/repo hosting). You can run fully local with only `ANTHROPIC_API_KEY` set.

---

## Core Concepts

1. **Projects:** The top-level container for metadata, planning, and execution history. Specs, tasks, and agent instances belong to a project, but the executable workspace lives on the agent instance rather than the project itself.

2. **Specs:** AI-generated structured implementation plans produced from the project requirements. Each spec is a standalone markdown file, ordered from most foundational to least foundational, covering purpose, interfaces, use cases, and dependencies.

3. **Tasks:** Concrete units of work extracted from specs. Each task tracks its own state through a full lifecycle: `pending` → `ready` → `in_progress` → `done` / `failed` / `blocked`. Tasks carry dependency information so the agent loop can resolve execution order automatically.

4. **Agents & Sessions:** Autonomous workers that execute tasks. An agent instance picks the next available task, loads relevant spec context, performs the work against its local or remote workspace, and updates state. When the context window fills past a threshold, the agent rolls over into a new session, carrying forward only a compressed summary, and continues seamlessly.

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
| `AURA_NETWORK_URL` | No | aura-network backend for orgs/sync (e.g. `https://your-network-host.example.com`). Omit for local-only. |
| `AURA_NETWORK_AUTH_TOKEN` | No | Auth token for aura-network (when using `AURA_NETWORK_URL`) |
| `AURA_STORAGE_URL` | No | aura-storage URL for execution data (e.g. `https://your-storage-host.example.com`). Omit to disable. |
| `ORBIT_BASE_URL` | No | URL of the **standalone Orbit service** (host and port). Aura connects to this service as a client; it does not run the Orbit API. Omit to disable Orbit features. |
| `GITHUB_APP_*` | No | GitHub App ID, private key, and slug for repository linking |

The server reads `.env` from the current working directory when you run `aura-os-server` or `aura-os-desktop`.

### Authentication

All protected API endpoints require a JWT via `Authorization: Bearer <token>` header. WebSocket connections use `?token=<jwt>` query parameter. The JWT is obtained from the `/api/auth/login` or `/api/auth/register` response (`access_token` field) and stored client-side in localStorage. The same auth flow works for both the desktop app and web deployment.

### Server URLs (local development)

- **Backend (Axum):** `http://127.0.0.1:3100` — API at `/api`, WebSocket at `/ws`
- **Frontend (Vite dev):** `http://localhost:5173` — proxies `/api` and `/ws` to the backend

### Run backend

From the repo root (so `.env` is found):

```bash
cargo run -p aura-os-server
```

The Axum server listens on `http://127.0.0.1:3100`.

### Run interface (dev)

```bash
cd interface
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` to `http://localhost:3100`, so the backend must be running.

### Run mobile web

For all mobile browser testing, use the shared mobile dev runner from the repo root:

```bash
./scripts/run-mobile-dev.sh
```

What it does:

- starts `aura-os-server` on `AURA_SERVER_HOST:AURA_SERVER_PORT`
- starts the interface on `AURA_FRONTEND_HOST:AURA_FRONTEND_PORT`
- prints the exact URL you should open for simulator or phone testing
- fails fast if those ports are already in use, so the printed URLs stay accurate

The same runner supports both data modes:

- **Local-only mobile**: leave `AURA_NETWORK_URL`, `AURA_STORAGE_URL`, and `ORBIT_BASE_URL` unset in `.env`
- **Remote-backed mobile**: set those URLs in `.env`, then run the same script

Recommended remote-backed setup:

```bash
AURA_NETWORK_URL=https://your-network-host.example.com
AURA_STORAGE_URL=https://your-storage-host.example.com
ORBIT_BASE_URL=https://your-orbit-host.example.com
```

#### Use iOS Simulator / Android Emulator

Use the defaults:

```bash
./scripts/run-mobile-dev.sh
```

Then open:

```bash
http://127.0.0.1:5173/projects
```

This is the easiest path for simulator testing.

#### Use a physical phone

To test Aura on your actual phone, your phone and computer must be on the same Wi-Fi network.

1. Find your computer's LAN IP address, for example `192.168.1.42`.
2. Start the shared mobile runner with LAN bindings and a public host:

```bash
AURA_SERVER_HOST=0.0.0.0 \
AURA_FRONTEND_HOST=0.0.0.0 \
AURA_PUBLIC_HOST=192.168.1.42 \
./scripts/run-mobile-dev.sh
```

3. Open the printed URL on your phone:

```bash
http://192.168.1.42:5173/projects
```

Notes:

- `AURA_SERVER_HOST=0.0.0.0` lets the local Aura host accept requests from your phone.
- `AURA_FRONTEND_HOST=0.0.0.0` lets Vite serve the interface to your phone.
- `AURA_PUBLIC_HOST` is only for the printed/opened URL. Set it to your machine's real LAN IP, not `0.0.0.0`.
- If your macOS firewall prompts for access, allow incoming connections for the dev processes.
- `127.0.0.1` only works for simulators running on the same machine. It does **not** work from a physical phone.

### Install as a mobile app (PWA)

If you want the mobile experience without Safari chrome, install Aura from the browser as a home-screen app.

#### iPhone / iPad (Safari)

1. Open the mobile URL in Safari:

```bash
http://127.0.0.1:5173/projects
```

If you are testing on a real iPhone instead of Simulator, use your LAN URL instead, for example:

```bash
http://192.168.1.42:5173/projects
```

2. Tap the Share button.
3. Choose **Add to Home Screen**.
4. Launch Aura from the new home-screen icon instead of the Safari tab.

This gives you the installed-PWA presentation, which is closer to the intended mobile shell and avoids most of the Safari URL-bar chrome.

#### Android (Chrome)

1. Open the same mobile URL in Chrome.
2. Open the browser menu.
3. Choose **Install app** or **Add to Home screen**.
4. Launch Aura from the installed app icon.

Notes:

- Mobile web uses the local Aura host (`aura-os-server`) even when the underlying services are remote.
- Some capabilities remain desktop-only by design, such as linked host folders, IDE open, and other native bridge actions.
- Imported project files do work on mobile through the shared host file APIs; true linked-workspace browsing is still a desktop capability.
- If you need different ports, set `AURA_SERVER_PORT` and/or `AURA_FRONTEND_PORT` before running the script.
- For simulator/local-only use, the defaults still bind to `127.0.0.1`, which is the simplest setup.

### Build native mobile shells (Capacitor)

Aura's mobile store builds now use Capacitor on top of the existing Vite app.

From `interface/`:

```bash
npm install
npm run build:native
```

Then open the native project you want:

```bash
npm run cap:open:ios
npm run cap:open:android
```

Notes:

- `npm run build:native` rebuilds the web app and syncs it into the native iOS and Android shells.
- Store-safe mobile builds currently disable in-app credit purchases. Buy or manage credits on the web app, then return to mobile.
- If you regenerate native assets after changing the web UI, run `npm run build:native` again before archiving or uploading a store build.
- Native shells can ship with a mobile-only default Aura API host by setting one or more Vite env vars before `npm run build`:
  - `VITE_NATIVE_DEFAULT_HOST` for one shared native default
  - `VITE_IOS_DEFAULT_HOST` for an iOS-specific default
  - `VITE_ANDROID_DEFAULT_HOST` for an Android-specific default
- Desktop and browser builds still fall back to their current origin when no host override is configured.
- Native mobile auth is cross-origin, so the Aura API must allow credentialed CORS for native localhost origins. Add any deployed interface origins with `AURA_ALLOWED_ORIGINS`.

#### Local native fastlane commands

For day-to-day native validation, use the wrapper commands from `interface/`:

```bash
npm run mobile:android:local
npm run mobile:ios:local
```

Or build both in sequence:

```bash
npm run mobile:local:all
```

What these commands do:

- rebuild the web app
- sync Capacitor assets into the native shell
- build the local Android APK or iOS simulator app through `fastlane`
- auto-detect the local gem bin, and for Android also pick up `JAVA_HOME` / `ANDROID_HOME` when available

Backend env needed for a useful local mobile session:

- Minimum for remote-backed projects/orgs:
  - `AURA_NETWORK_URL`
- Recommended full remote-backed setup:
  - `AURA_NETWORK_URL=https://your-network-host.example.com`
  - `AURA_STORAGE_URL=https://your-storage-host.example.com`
  - `AURA_ROUTER_URL=https://your-router-host.example.com`
  - `Z_BILLING_URL=https://your-billing-host.example.com`
  - `ORBIT_BASE_URL=https://your-orbit-host.example.com`
  - `SWARM_BASE_URL=https://your-swarm-gateway.example.com`

Native build env used by the local wrappers:

- `VITE_ANDROID_DEFAULT_HOST`
  - default: `http://10.0.2.2:3100`
- `VITE_IOS_DEFAULT_HOST`
  - default: `http://127.0.0.1:3100`

You only need to override those `VITE_*` values if your backend is running on a different host or port.

#### iOS TestFlight / App Store pipeline

The iOS branch now includes a `fastlane` setup under [`interface/ios`](./interface/ios) and a GitHub Actions workflow in [`.github/workflows/ios-mobile.yml`](./.github/workflows/ios-mobile.yml).

Local release commands from `interface/ios/`:

```bash
bundle install
bundle exec fastlane ios beta
bundle exec fastlane ios release
```

GitHub Actions release input:

- Run `iOS Mobile`
- Choose lane `beta` for TestFlight or `release` for an App Store candidate
- Set `submit_for_review=true` only when metadata, screenshots, and review notes are ready

Required iOS secrets for CI:

- `IOS_APP_STORE_CONNECT_KEY_ID`
- `IOS_APP_STORE_CONNECT_ISSUER_ID`
- `IOS_APP_STORE_CONNECT_KEY_BASE64`
- `IOS_DEVELOPER_TEAM_ID`
- `IOS_MATCH_GIT_URL`
- `IOS_MATCH_PASSWORD`
- One match auth method:
  - `IOS_MATCH_GIT_PRIVATE_KEY`, or
  - `IOS_MATCH_GIT_BASIC_AUTHORIZATION`
- Optional overrides:
  - `IOS_BUNDLE_ID`
  - `IOS_MATCH_GIT_BRANCH`
  - `IOS_APP_STORE_CONNECT_TEAM_ID`
  - `IOS_APPLE_ID`

Still needed before a real App Store submission:

- A live production Aura backend/API that Apple can reach during review
- App Store Connect app record for the final bundle ID
- Distribution signing assets in the `match` repo
- Final app icon, screenshots, and any preview video you want to ship
- App Privacy answers, privacy policy URL, support URL, and age rating
- App review contact info, demo credentials, and review notes
- Final decision on whether production builds should lock to one hosted Aura backend

#### Android Play pipeline

The Android branch now includes a `fastlane` setup under [`interface/android`](./interface/android) and a GitHub Actions workflow in [`.github/workflows/android-mobile.yml`](./.github/workflows/android-mobile.yml).

Local release commands from `interface/android/`:

```bash
bundle install
bundle exec fastlane android beta
bundle exec fastlane android release
```

GitHub Actions release input:

- Run `Android Mobile`
- Choose lane `beta` for Play Internal Testing or `release` for a release candidate
- Choose the Play track (`internal`, `closed`, or `production`)
- Leave `release_status=draft` until you are ready for a real rollout

Required Android secrets for CI:

- `ANDROID_PLAY_SERVICE_ACCOUNT_JSON_BASE64`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- Optional overrides:
  - `ANDROID_PACKAGE_NAME`

Still needed before a real Google Play submission:

- A Google Play Console app record for the final package name
- A Play service account with release permissions for that app
- The Android upload keystore used to sign release bundles
- Store listing copy, screenshots, and high-res app icon
- Privacy policy URL, Data safety answers, and content rating
- App access / review instructions if login is required
- A live production Aura backend/API that Play reviewers can reach

### Run desktop app

Build the interface once, then run the desktop shell (it embeds the server and interface):

```bash
cd interface && npm run build && cd ..
cargo run -p aura-os-desktop
```

Run from the repo root so `.env` is loaded. The desktop app bundles the server and interface into a single native window via WebView.

### Release automation docs

For the current release-build plan and workflow map, see:

- [Release Build Strategy](/Users/shahrozkhan/Documents/zero/aura-os/docs/release-build-strategy.md)
- [Release Workflows](/Users/shahrozkhan/Documents/zero/aura-os/docs/release-workflows.md)

### Optional services

- **aura-network** — When `AURA_NETWORK_URL` (and optionally `AURA_NETWORK_AUTH_TOKEN`) is set, the app can sync organizations and projects with a shared backend (e.g. `https://your-network-host.example.com`).
- **aura-storage** — When `AURA_STORAGE_URL` is set, execution data can be stored in a remote store (e.g. `https://your-storage-host.example.com`). Omit for local-only execution.
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
| **aura-os-desktop** | Standalone desktop GUI (tao + wry WebView) |
| **aura-os-server** | HTTP API server (Axum) serving the interface and API routes |
| **aura-os-ide** | IDE helper library for the desktop shell |
| **aura-os-core** | Shared entity types, IDs, and enums |
| **aura-os-store** | RocksDB persistence layer and storage abstractions |
| **aura-claude** | Claude API client |
| **aura-os-terminal** | Terminal emulation for agent command execution |
| **aura-os-projects** | Project CRUD and lifecycle management |
| **aura-os-specs** | Spec generation, storage, and streaming |
| **aura-os-tasks** | Task state machine, extraction, and transitions |
| **aura-os-agents** | Agent and agent instance management |
| **aura-os-sessions** | Session lifecycle and context rotation |
| **aura-os-auth** | Authentication and session tokens |
| **aura-os-orgs** | Organization CRUD, members, and invites |
| **aura-os-billing** | Credit tiers, balance, and checkout |
| **aura-os-settings** | API key management and app configuration |
| **aura-github** | GitHub App integration and repository linking |
| **aura-engine** | AI orchestration and autonomous dev loop |
| **aura-chat** | Chat and streaming orchestration |
| **aura-tools** | AI tool definitions (file operations, commands) |
| **interface** | React 19 + TypeScript SPA (Vite) |

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
  interface/                 # React + TypeScript SPA
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
