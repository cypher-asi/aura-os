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

Persisted browser-owned state lives client-side in IndexedDB, while the local backend keeps only lightweight JSON/runtime state needed for local execution. The backend is Rust (Axum), the interface is React + TypeScript served through a native desktop shell (tao + wry), and the LLM provider is the Claude API. Optional remote services (configured via `.env`) include **aura-network** (orgs/project sync), **aura-storage** (execution data), **billing** (credits), **aura-integrations** (secret-backed integrations), and **Orbit** (Git/repo hosting).

---

## Core Concepts

1. **Projects:** The top-level container for metadata, planning, and execution history. Specs, tasks, and agent instances belong to a project, but the executable workspace lives on the agent instance rather than the project itself.

2. **Specs:** AI-generated structured implementation plans produced from the project requirements. Each spec is a standalone markdown file, ordered from most foundational to least foundational, covering purpose, interfaces, use cases, and dependencies.

3. **Tasks:** Concrete units of work extracted from specs. Each task tracks its own state through a full lifecycle: `pending` → `ready` → `in_progress` → `done` / `failed` / `blocked`. Tasks carry dependency information so the agent loop can resolve execution order automatically.

4. **Agents & Sessions:** Autonomous workers that execute tasks. An agent instance picks the next available task, loads relevant spec context, performs the work against its local or remote workspace, and updates state. When the context window fills past a threshold, the agent rolls over into a new session, carrying forward only a compressed summary, and continues seamlessly.

---

## Quick Start

### Prerequisites

- Rust toolchain `1.94.1`
- Node.js `25.9.0` and npm
- Java `26` for Android validation and release lanes
- Ruby `4.0.2` for iOS and Android release lanes
- Xcode `26` (iOS 26 SDK) for iOS validation and release lanes — required by App Store Connect since 2026-04-28
- Vendored [ZUI](https://github.com/cypher-asi/zui) source already included under `vendor/zui`

### CI Runtime Parity

GitHub Actions now uses the same explicit runtime matrix across desktop, mobile, and eval workflows:

- Node.js `25.9.0` via [`.nvmrc`](.nvmrc)
- Rust `1.94.1` via [`rust-toolchain.toml`](rust-toolchain.toml)
- Java `26` for Android native lanes
- Ruby `4.0.2` for mobile release lanes
- Xcode `26` selected explicitly on the `macos-26` runner image for the iOS lanes

Use the shared parity scripts from the repo root before pushing changes:

```bash
node scripts/ci/check-runtime.mjs desktop
node scripts/ci/verify-desktop.mjs --smoke
node scripts/ci/verify-evals.mjs smoke
```

For native mobile validation:

```bash
node scripts/ci/check-runtime.mjs ios --native
node scripts/ci/check-runtime.mjs android --native
```

Desktop packaging parity also expects an `aura-harness` checkout next to this repo, or an `AURA_HARNESS_DIR` override that points to that checkout.

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
| `AURA_NETWORK_FEEDBACK_URL` | No | Optional Feedback-only aura-network override. Leave unset normally so Feedback shares `AURA_NETWORK_URL`; set it only when intentionally testing a different aura-network deployment for `/api/feedback/*`. |
| `AURA_NETWORK_AUTH_TOKEN` | No | Auth token for aura-network (when using `AURA_NETWORK_URL`) |
| `AURA_STORAGE_URL` | No | aura-storage URL for execution data (e.g. `https://your-storage-host.example.com`). Omit to disable. |
| `ORBIT_BASE_URL` | No | URL of the **standalone Orbit service** (host and port). Aura connects to this service as a client; it does not run the Orbit API. Omit to disable Orbit features. |
| `GITHUB_APP_*` | No | GitHub App ID, private key, and slug for repository linking |

The server reads `.env` from the current working directory when you run `aura-os-server` or `aura-os-desktop`.

### Authentication

All protected API endpoints require a JWT via `Authorization: Bearer <token>` header. WebSocket connections use `?token=<jwt>` query parameter. The JWT is obtained from the `/api/auth/login` or `/api/auth/register` response (`access_token` field) and persisted client-side in IndexedDB with an in-memory runtime cache for active requests. The same auth flow works for both the desktop app and web deployment.

### Dev vs Stable channel

AURA ships in two flavors that can run side-by-side on one machine so you can use the installed stable AURA to build the next version of AURA without colliding on local files, ports, or single-instance locks.

| Identifier | Stable (installed) | Dev (`cargo run`) |
| --- | --- | --- |
| Data dir | `%LOCALAPPDATA%\aura` (`~/Library/Application Support/aura`, `~/.local/share/aura`) | `…\aura-dev` |
| User skills | `~/.aura/skills` | `~/.aura-dev/skills` |
| Standalone server port | `3100` | `3101` |
| Embedded desktop server port | `19847` | `19848` |
| Harness sidecar port | `19080` | `19081` |
| Default harness URL port | `8080` | `8081` |
| Vite dev server port | `5173` | `5174` |
| Window title | `AURA` | `AURA Dev` |
| Windows single-instance mutex | `Local\com.aura.desktop.single-instance` | `Local\com.aura.desktop-dev.single-instance` |
| Auto-updater | enabled | disabled |

Channel selection is a build-time cargo feature on `aura-os-core`. `cargo run -p aura-os-desktop` and the `scripts/dev/*` runners default to the `dev-channel` feature; the release pipeline (`cargo packager`, `scripts/ci/verify-desktop.mjs`, and the `release-stable` / `release-nightly` workflows) builds with `--no-default-features --features stable-channel`. There is no runtime override — the channel is baked into the binary.

Remote services (`AURA_NETWORK_URL`, `AURA_STORAGE_URL`, `BILLING_SERVER_URL`, `ORBIT_BASE_URL`, etc.) are unaffected by the channel and shared via `.env`.

If you run `npm run dev` directly (without the dev script wrapper) and want it to talk to a dev-channel `aura-os-server`, set `AURA_SERVER_PORT=3101` so the Vite proxy targets the dev backend instead of the stable one on `3100`.

### Server URLs (local development)

- **Backend (Axum):** `http://127.0.0.1:3100` — API at `/api`, WebSocket at `/ws` (stable; dev-channel uses `3101`)
- **Frontend (Vite dev):** `http://localhost:5173` — proxies `/api` and `/ws` to the backend (stable; dev-channel uses `5174`)

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
`npm install` also primes the vendored `vendor/zui` runtime dependencies, so no sibling ZUI checkout is needed.

### Run desktop app (live dev)

From the repo root:

```bash
./scripts/dev/run-desktop-dev.sh
```

On Windows PowerShell:

```powershell
./scripts/dev/run-desktop-dev.ps1
```

This starts Vite first, waits for `@vite/client`, then launches `aura-os-desktop` against the live frontend URL so CSS and TypeScript edits update in the native shell without rebuilding. Plain debug runs now also try to start and attach a local Vite server automatically, but this script is still the clearest way to keep the desktop shell and frontend pinned to the same dev URL.

#### Use an external harness

To run the desktop shell against a separately-running harness (for example, a sibling `aura-harness` checkout you started yourself), set `LOCAL_HARNESS_URL` to that harness URL and pass `--external-harness`:

```bash
LOCAL_HARNESS_URL=http://127.0.0.1:3404 cargo run -p aura-os-desktop -- --external-harness
```

With `--external-harness` the desktop binary refuses to start if `LOCAL_HARNESS_URL` is unset or `/health` is unreachable, and will not spawn the bundled local harness sidecar. The runtime config surfaces this as `AURA_DESKTOP_EXTERNAL_HARNESS=1` so the UI can reflect that the harness is externally managed.

The standard external harness runtime selects its command execution policy in code rather than through env-based command switches. Its `/health` response should report `run_command_enabled: true`, `shell_enabled: true`, and a non-empty `binary_allowlist`; if any of those are missing or disabled, restart the harness with the current autonomous-agent runtime policy before starting the dev loop.

### Run mobile web

For all mobile browser testing, use the shared mobile dev runner from the repo root:

```bash
./scripts/dev/run-mobile-dev.sh
```

What it does:

- starts `aura-os-server` on `AURA_SERVER_HOST:AURA_SERVER_PORT`
- starts the interface on `AURA_FRONTEND_HOST:AURA_FRONTEND_PORT`
- prints the exact URL you should open for simulator or phone testing
- fails fast if those ports are already in use, so the printed URLs stay accurate

Mobile is designed as a remote-backed experience. Keep the mobile runner pointed
at remote services rather than treating the phone as a local-workspace host.

Recommended mobile setup:

```bash
AURA_NETWORK_URL=https://aura-network.onrender.com
AURA_STORAGE_URL=https://aura-storage.onrender.com
ORBIT_BASE_URL=https://orbit-sfvu.onrender.com
```

#### Use iOS Simulator / Android Emulator

Use the defaults:

```bash
./scripts/dev/run-mobile-dev.sh
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
./scripts/dev/run-mobile-dev.sh
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
- Mobile project files are remote-workspace files. On mobile they are currently previewable, not editable.
- Linked local-workspace browsing remains a desktop capability.
- If you need different ports, set `AURA_SERVER_PORT` and/or `AURA_FRONTEND_PORT` before running the script.
- For simulator use on the same machine, the defaults still bind to `127.0.0.1`, which is the simplest setup.

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

Mobile should be treated as remote-only product behavior even when you are
running the local host in front of those services. Local folder attachment and
other host-workspace actions remain desktop-only by design.

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
bundle exec fastlane ios preflight
bundle exec fastlane ios beta
bundle exec fastlane ios release
```

GitHub Actions release input:

- Run `iOS Validation + TestFlight/App Store`
- Pushes to `main` automatically upload the iOS beta build to TestFlight
- Choose lane `preflight` to validate secrets/signing config, `beta` for TestFlight, or `release` for an App Store candidate
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
bundle exec fastlane android preflight
bundle exec fastlane android beta
bundle exec fastlane android release
```

GitHub Actions release input:

- Run `Android Validation + Play/GitHub Release`
- Pushes to `main` publish the signed Android APK through the separate `Mobile Nightly GitHub Release` workflow
- Choose lane `preflight` to validate secrets/signing config, `beta` for Play Internal Testing, or `release` for a release candidate
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

### Run desktop app with a built interface

Build the interface once, then run the desktop shell with the static bundle:

```bash
cd interface && npm run build && cd ..
cargo run -p aura-os-desktop
```

Run from the repo root so `.env` is loaded. The desktop app bundles the server and interface into a single native window via WebView. In debug builds it will also try to boot a local Vite server when the repo's `interface` sources are available, while the dev scripts remain the most explicit option for pinned ports and shared dev sessions.

### Release automation docs

For the current release-build plan and workflow map, see:

- [Release Build Strategy](docs/release-build-strategy.md)
- [Release Workflows](docs/release-workflows.md)
- [Mobile Store Compliance Audit](docs/mobile-store-compliance-audit.md)
- [ZUI Vendoring](docs/zui-vendoring.md)

### Optional services

- **aura-network** — When `AURA_NETWORK_URL` (and optionally `AURA_NETWORK_AUTH_TOKEN`) is set, the app can sync organizations and projects with a shared backend (e.g. `https://your-network-host.example.com`).
- **aura-storage** — When `AURA_STORAGE_URL` is set, execution data can be stored in a remote store (e.g. `https://your-storage-host.example.com`). Omit for local-only execution.
- **Billing** — `BILLING_SERVER_URL` defaults to `https://billing.zero.tech`; set `BILLING_INTERNAL_TOKEN` if your billing server requires it.
- **Orbit** — Third-party standalone service for Git/repo hosting. Set `ORBIT_BASE_URL` to the Orbit service URL (e.g. `https://orbit.your-domain.com` or `http://localhost:PORT`). Aura does not run Orbit; it only connects to it as a client.

---

## Principles

1. **Local-First:** Browser-owned state persists locally in IndexedDB, and the host backend keeps only lightweight local runtime/compatibility state. Remote services (aura-network, aura-storage, billing, aura-integrations, Orbit) are optional per feature.
2. **Autonomous:** The dev loop runs continuously. Context rotation happens automatically when sessions fill, so the agent can work through an entire spec without manual intervention.
3. **Transparent:** Every piece of work traces back through Task → Spec → Project. Execution logs, agent state, and session summaries are all persisted and visible in the UI.
4. **Extensible:** A modular Rust workspace with clean domain boundaries. Each crate owns a single concern, making it straightforward to add new capabilities or swap components.

---

## Architecture

### Apps (binaries)

| Crate | Description |
| --- | --- |
| **aura-os-desktop** | Standalone desktop GUI (tao + wry WebView) |
| **aura-os-server** | HTTP API server (Axum) serving the interface and API routes |
| **aura-os-ide** | IDE helper library for opening secondary IDE windows |

### Crates (libraries)

| Crate | Description |
| --- | --- |
| **aura-os-core** | Shared entity types, IDs, enums, and settings |
| **aura-os-store** | Lightweight local store and storage abstractions |
| **aura-os-auth** | Authentication against external auth APIs, JWT/session types |
| **aura-os-network** | Network client for remote org/project sync and Orbit integration |
| **aura-os-storage** | Storage client for remote execution data (tasks, specs, sessions, logs) |
| **aura-os-billing** | Billing client, credit tiers, and balance management |
| **aura-os-orgs** | Organization CRUD, members, and integrations |
| **aura-os-projects** | Project service merging network data with local compatibility state |
| **aura-os-agents** | Agent templates, instances, and runtime management |
| **aura-os-sessions** | Session lifecycle, context usage, and storage integration |
| **aura-os-tasks** | Task state machine, lifecycle transitions, and locking |
| **aura-os-harness** | Harness abstraction: WebSocket bridge, automaton client, local/swarm harness |
| **aura-os-terminal** | PTY-based terminal for agent command execution |

### Interface

| Component | Description |
| --- | --- |
| **interface** | React 19 + TypeScript SPA (Vite), with Capacitor for native mobile shells |

---

## Project Structure

```
aura-os/
  Cargo.toml                  # Rust workspace root
  apps/
    aura-os-desktop/           # Native desktop shell (tao + wry)
    aura-os-server/            # Axum HTTP API
    aura-os-ide/               # IDE helper lib
  crates/
    aura-os-core/              # Shared types and entity IDs
    aura-os-store/             # Local store backend
    aura-os-auth/              # Authentication
    aura-os-network/           # Remote network client + Orbit
    aura-os-storage/           # Remote storage client
    aura-os-billing/           # Credits and billing
    aura-os-orgs/              # Organizations
    aura-os-projects/          # Project management
    aura-os-agents/            # Agent lifecycle
    aura-os-sessions/          # Session and context rotation
    aura-os-tasks/             # Task state machine
    aura-os-harness/           # Harness / workspace bridge
    aura-os-terminal/          # Terminal emulation
  interface/                   # React + TypeScript SPA
    src/
      api/                     # API client and SSE streams
      apps/                    # Feature modules (projects, agents, process, feed)
      components/              # Shared UI components
      hooks/                   # Custom hooks
      stores/                  # Zustand stores
      views/                   # Page-level views
  docs/                        # Architecture, deployment, and strategy docs
  specs/                       # Numbered implementation spec documents
  evals/                       # Evaluation harness, promptfoo, and baselines
  scripts/                     # Dev, release, and test automation
  shared/                      # Cross-cutting data (tool manifests)
  skills/                      # Bundled SKILL.md catalog by category
```

---

## License

MIT
