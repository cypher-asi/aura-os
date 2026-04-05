# Mobile Companion Execution Plan

This plan turns the initial mobile companion/PWA slice into parallel follow-up workstreams that can be implemented without constant merge conflicts.

## Current Status

Completed on branch `codex/mobile-companion-pwa`:

- Mobile shell with topbar, bottom nav, and drawer-based context panels
- Capability gating for desktop-only features
- PWA manifest, icons, and service worker shell caching
- Playwright mobile smoke and visual coverage

Still open:

- Host reachability beyond localhost assumptions
- Mobile/remote auth hardening
- Parity-first mobile UX for existing desktop/web functionality
- Realtime/background resilience for mobile clients after parity
- PWA production hardening beyond shell caching

## Scope Reset: Parity First

The immediate goal is not to invent a separate mobile product surface.

The goal is:

- match the existing web/desktop functionality that already translates well to mobile
- reuse the current web UI as much as possible
- hide only the desktop-only capabilities that cannot work honestly on mobile
- defer sessions, deeper realtime hardening, and advanced mobile-specific behavior until after parity

In practice this means:

- prefer adapting existing routes, views, and components over creating mobile-only replacements
- keep project, task, chat, execution, org, billing, and settings flows where they already exist
- only introduce mobile-specific chrome where the desktop shell model breaks down

## Parity Matrix

### Provide In The Parity Phase

- Sign in and sign out
- Switch orgs and view billing/settings surfaces
- Browse projects and agents
- Open project execution view
- View tasks, logs, specs, stats, and high-value existing panels
- Chat with agents
- Trigger lightweight control actions that already exist in the current UI, such as start, pause, stop, and retry

### Defer Until After Parity

- Session-focused workflows
- Background/resume-specific live reliability
- New mobile-only monitor/control information architecture
- Advanced offline behavior
- Full PWA hardening beyond installability and shell caching

### Keep Desktop-Only

- Linking local folders from a phone
- File and folder pickers for the host machine
- IDE editing routes
- Embedded terminal and PTY workflows
- Direct host filesystem browsing and “open in IDE” behavior
- Local build/test execution as if the phone were the host

## Coordination Rules

All sub-agents must follow these rules:

1. Start from `codex/mobile-companion-pwa`.
2. Create a dedicated branch with the `codex/` prefix.
3. Commit at least every 45-90 minutes or at each logical checkpoint.
4. Keep commits small and titled by outcome, not by file list.
5. Do not modify another sub-agent's owned files unless the handoff rules below allow it.
6. If a shared file must change, make that change in its own commit with a clear message.
7. Rebase onto `codex/mobile-companion-pwa` before opening for merge.

Recommended commit pattern:

- Commit 1: failing test, fixture, or scaffolding
- Commit 2: core implementation
- Commit 3: polish, docs, and cleanup

## Shared Files Requiring Extra Care

These files are cross-cutting and should only be touched when necessary:

- `interface/src/components/AppShell.tsx`
- `interface/src/hooks/use-aura-capabilities.ts`
- `interface/src/api/client.ts`
- `interface/src/context/AuthContext.tsx`
- `interface/src/hooks/use-event-stream.ts`
- `interface/public/sw.js`
- `interface/playwright.config.ts`

If a sub-agent needs one of these:

1. Make the change in a separate commit.
2. Call it out in the PR summary.
3. Avoid mixing shared-file edits with unrelated refactors.

## Workstream A: Host Connectivity

Branch:

- `codex/mobile-host-connectivity`

Goal:

- Make the mobile companion connect to a real Aura host without assuming `localhost`.

Deliverables:

- Configurable API and websocket base handling
- Host status and health model in the interface
- Mobile-safe host selection or host bootstrap flow
- Development path for LAN/mobile testing

Primary ownership:

- `interface/src/api/client.ts`
- `interface/src/api/terminal.ts`
- `interface/src/hooks/use-event-stream.ts`
- `interface/src/components/AppShell.tsx`
- `interface/src/context/*` if host state needs context
- `interface/vite.config.ts`
- `apps/server/**` only if backend support is required

Out of scope:

- Auth model redesign
- UI polish unrelated to connectivity

Acceptance criteria:

- The interface can target a non-localhost host cleanly
- Host online/offline state is visible to the user
- Playwright can run against an explicit base host without local-only assumptions

Suggested commits:

- `Add configurable interface host base`
- `Surface host connectivity state in mobile shell`
- `Document LAN/mobile host workflow`

## Workstream B: Mobile Auth and Session Model

Branch:

- `codex/mobile-auth-session`

Goal:

- Make auth reliable for mobile and remote clients without expanding into session-centric product work yet.

Deliverables:

- Clear unauthorized and expired-session behavior
- Mobile-safe session restore flow
- Login/logout flows that tolerate remote/mobile resumes
- Explicit handling for auth bootstrap failures

Primary ownership:

- `interface/src/context/AuthContext.tsx`
- `interface/src/views/LoginView.tsx`
- `interface/src/api/client.ts`
- `apps/server/**`
- `crates/domain/auth/**`
- `crates/domain/sessions/**`

Out of scope:

- Host connectivity primitives unless strictly needed
- Session-centric UX redesign
- PWA cache work

Acceptance criteria:

- Mobile login does not fail due to local-only assumptions
- Session restore paths have clean UI states
- Auth failures produce intentional UX, not generic 500/502 confusion

Suggested commits:

- `Harden auth bootstrap for remote clients`
- `Add explicit expired-session handling`
- `Improve mobile login error states`

## Workstream C: Desktop/Web Parity UX

Branch:

- `codex/mobile-parity-ux`

Goal:

- Adapt the existing web/desktop UI so the current feature set is usable on mobile with minimal divergence.

Deliverables:

- Improved mobile project/task/chat/execution layout
- Better drawer and navigation behavior
- Reuse of existing views and components wherever possible
- Explicit empty, loading, and unsupported states

Primary ownership:

- `interface/src/components/AppShell.tsx`
- `interface/src/components/AppShell.module.css`
- `interface/src/components/Sidekick.tsx`
- `interface/src/components/Preview.tsx`
- `interface/src/views/ExecutionView.tsx`
- `interface/src/components/ChatView.tsx`
- `interface/src/views/*` that already power desktop/web parity
- relevant CSS modules

Out of scope:

- Rewriting auth or connectivity layers
- Session-first IA changes
- Service worker changes

Acceptance criteria:

- Existing desktop/web functionality that translates to mobile is reachable and usable on a narrow viewport
- Monitoring, chat, and control actions are reachable without desktop chrome
- Unsupported desktop-only actions are explained clearly

Suggested commits:

- `Refine mobile project navigation and drawers`
- `Adapt execution and chat views for parity on mobile`
- `Polish unsupported desktop-only states`

## Workstream D: Realtime and Background Resilience

Branch:

- `codex/mobile-realtime-resilience`

Goal:

- Improve live mobile behavior after parity ships.

Deliverables:

- Reconnect handling for events
- Polling or fallback strategy where needed
- Stale/live UI indicators
- Resume behavior after backgrounding

Primary ownership:

- `interface/src/hooks/use-event-stream.ts`
- `interface/src/hooks/ws-reconnect.ts`
- `interface/src/context/EventContext.tsx`
- `interface/src/views/ExecutionView.tsx`
- `interface/src/components/AppShell.tsx`

Out of scope:

- Auth redesign
- Parity-phase UI adaptation

Acceptance criteria:

- Mobile clients recover from temporary disconnects gracefully
- UI exposes live vs stale state clearly
- Background/resume behavior is documented and tested where practical

Suggested commits:

- `Add stale-state handling for mobile event streams`
- `Improve websocket resume and fallback behavior`
- `Surface reconnect status in execution UI`

## Workstream E: PWA Hardening and QA

Branch:

- `codex/mobile-pwa-hardening`

Goal:

- Make the installable companion production-ready rather than just installable.

Deliverables:

- Service worker versioning/update strategy
- Better cache rules
- Installability verification notes for iOS and Android
- Expanded Playwright mobile coverage

Primary ownership:

- `interface/public/sw.js`
- `interface/public/manifest.webmanifest`
- `interface/src/lib/registerServiceWorker.ts`
- `interface/playwright.config.ts`
- `interface/tests/e2e/**`
- `interface/index.html`

Out of scope:

- Backend auth/connectivity work

Acceptance criteria:

- Static shell caching is deliberate and versioned
- PWA installability remains green after changes
- Mobile smoke coverage expands without relying on the backend

Suggested commits:

- `Version service worker cache strategy`
- `Expand mobile PWA smoke coverage`
- `Document install verification checklist`

## Merge Order

Preferred merge order for the parity phase:

1. Workstream A: Host Connectivity
2. Workstream B: Mobile Auth and Session Model
3. Workstream C: Desktop/Web Parity UX

Then later:

4. Workstream D: Realtime and Background Resilience
5. Workstream E: PWA Hardening and QA

Reason:

- Connectivity and auth define the real mobile foundation.
- Parity UX should land before deeper mobile-specific behavior.
- Realtime hardening should follow the stabilized parity surface.
- PWA hardening should finish against the stabilized product shape.

## Merge Conflict Avoidance

To avoid stepping on each other:

- A owns network/bootstrap files
- B owns auth/session files
- C owns parity/mobile presentation files
- D owns live event and reconnect files
- E owns service worker and test files

The most conflict-prone file is `interface/src/components/AppShell.tsx`.

Rule:

- Only Workstream C should make structural shell UX changes.
- Workstreams A and D may touch it only for minimal status wiring and only in isolated commits.

## Review Checklist Per Workstream

Every sub-agent should include:

- What user-facing problem was solved
- Which files were intentionally left untouched
- How the work was tested
- What assumptions still remain

## Done Definition

The mobile companion follow-up is complete when:

- A phone can reach a live Aura host without localhost hacks
- Mobile auth/session behavior is reliable
- Existing desktop/web functionality that translates to mobile has parity
- Realtime behavior survives reconnect and resume in a later hardening phase
- PWA installability and update behavior are stable
