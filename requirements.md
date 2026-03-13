# Requirements: Autonomous Multi-App Project Workspace (Rust + React/TypeScript)

## 1. Overview

Build a multi-app product workspace where users manage autonomous software delivery workflows. The system combines:

- **Backend/logic in Rust** (real-time orchestration, state management, workflows, persistence).
- **Frontend in React + TypeScript** (multi-app UI, project navigation, live updates).

The core value proposition is **ongoing autonomous execution**: agents continue working overnight by breaking tasks down, creating new contexts, and moving work through a structured hierarchy:

**Team → Project → Spec → Task → Code Changes/Commits**

## 2. Product Goals

1. Provide a unified workspace for software project execution across multiple apps.
2. Enable real-time visibility into agents, tasks, commits, and progress.
3. Support autonomous workflows where agents continue operating without manual intervention.
4. Enforce context hierarchy so all code changes are traceable to task/spec/project/team context.
5. Maintain user context while switching apps (especially current project continuity).
6. Support multi-team collaboration with secure auth and role-based administration.

## 3. Information Architecture

### 3.1 Global Navigation

- **Apps Bar** on the far left.
- Selecting an app updates the main content area to that app’s module.
- The bottom-left area shows current signed-in user and current team selector.

### 3.2 Project Navigation

- After selecting an app, display a **Projects nav bar** listing all Projects for current team.
- Clicking a Project loads contextual content for the selected **App + Project** pair.
- When switching between apps, the **currently selected Project remains the same**.

### 3.3 Team and User Context

- A user can belong to multiple teams.
- User can switch active team without logging out.
- Project list and app data are scoped to active team.
- Current user identity and current active team are always visible in bottom-left UI.

### 3.4 Context Hierarchy (Domain Constraint)

The data and workflow model must enforce:

- All **code changes** happen within a **Task**.
- Every **Task** belongs to a **Spec**.
- Every **Spec** belongs to a **Project**.
- Every **Project** belongs to a **Team**.

No code-change activity may exist outside this hierarchy.

## 4. App Modules

### 4.1 Agents App

Purpose: Monitor autonomous and active agents.

Required capabilities:

- List all agents in current project context.
- Show live status (e.g., idle, planning, coding, blocked, awaiting review).
- Show what each agent is currently working on in real time.
- Surface currently active task/spec context per agent.

### 4.2 Tasks App

Purpose: Manage project execution via kanban flow.

Required capabilities:

- Kanban-style board similar to Linear/Trello.
- Columns in strict left-to-right order:
  1. Requirements
  2. Spec
  3. Up Next
  4. In Progress
  5. Code Review
  6. Done
  7. Deployed
- Support assigning tasks and moving tasks across columns.
- Show relationship to parent spec and project.

### 4.3 Commits App

Purpose: Track code changes across agents/projects.

Required capabilities:

- Live commit feed.
- Historical commit timeline.
- Filtering by project, agent, task, spec, time range.
- Traceability from commit → task → spec → project → team.

### 4.4 Stats App

Purpose: Display progress and KPI analytics.

Required capabilities:

- Project progress dashboards.
- Throughput and cycle-time KPIs.
- Agent productivity and utilization indicators.
- Trend view across time windows.

### 4.5 Settings App

Purpose: Manage credentials and configuration.

Required capabilities:

- Secure entry and storage of API keys for providers (e.g., Claude, Codex).
- Key validation status and last-updated metadata.
- User-level and optionally team-level/project-level configuration controls.
- Team admin management controls.

## 5. Identity, Access, and Teams Requirements

### 5.1 Authentication

- Users can register with email/password.
- Users can log in with email/password.
- Users can log out and manage sessions securely.
- Support password reset flow.

### 5.2 Team Membership Model

- A single user can belong to multiple teams.
- Teams have members and admins.
- Team admins can promote other members to admin.
- Team admins can invite existing users to join their team.

### 5.3 Authorization and Visibility

- Data access is scoped by team membership.
- Only team admins can perform admin actions (invite members, change admin roles).
- Non-members cannot access team resources.

## 6. Autonomous Workflow and Harness Requirements

### 6.1 Core Autonomous Behavior

The platform must support long-running agent workflows where agents:

- Continue executing overnight.
- Decompose large tasks into smaller actionable tasks.
- Create and manage new execution contexts when needed.
- Re-prioritize within project/spec constraints.
- Report status and outcomes continuously.

### 6.2 Task Execution Harness

- Agent task execution must run through a **harness** abstraction rather than directly through a raw model provider.
- The required harness for this application is **Aura Runtime**: https://github.com/cypher-asi/aura-runtime.
- Harness integration must preserve task/spec/project/team lineage on every execution.
- Harness execution metadata should be available for audit and debugging.

### 6.3 Orchestration Rules

- Agents must always attach work to an existing task/spec/project/team context.
- Auto-generated subtasks inherit parent team/project/spec lineage.
- Any blocked state must include reason and recommended next action.
- Handoffs between agents must preserve full context and history.

### 6.4 Human-in-the-loop Controls

- Users can pause/resume autonomous workflows.
- Users can approve/reject key transitions (configurable gates, e.g., Code Review → Done).
- Users can reassign tasks among agents.

## 7. Functional Requirements

### 7.1 Project and Context Management

- Create/read/update/archive projects.
- Create/read/update specs within projects.
- Create/read/update tasks within specs.
- Enforce referential integrity across team/project/spec/task hierarchy.

### 7.2 Real-time Data

- Frontend receives real-time updates for:
  - Agent status/activity
  - Task movement/status
  - Incoming commits
  - KPI refresh triggers
  - Team membership/admin changes relevant to active context
- UI should gracefully degrade to polling if websocket/channel unavailable.

### 7.3 Search and Filtering

- Global search by team/project/spec/task/agent/commit.
- App-specific filters persisted per user session.
- Deep links to app + team + project + selected entity.

### 7.4 Auditability and History

- Log all important state transitions (task moves, agent assignment, workflow starts/stops, admin actions).
- Maintain immutable event history for traceability.
- Associate every commit and task transition with actor (human or agent).

## 8. Non-Functional Requirements

### 8.1 Performance

- Initial app shell load should be fast enough for interactive use on typical developer hardware.
- Real-time updates should render with low latency suitable for "live" monitoring.

### 8.2 Reliability

- Long-running workflows must survive service restarts.
- Event delivery should be durable and replayable for recovery.

### 8.3 Security

- Encrypt API keys at rest.
- Never expose plaintext keys in logs/UI after save.
- Securely store passwords using modern password hashing.
- Enforce authentication and authorization for team/project data.

### 8.4 Scalability

- Support multiple teams, multiple projects per team, and many concurrent agents.
- Handle growing commit/event histories efficiently.

### 8.5 Observability

- Structured backend logging.
- Metrics for queue depth, workflow success/failure, update latency.
- Traces for critical orchestration paths and harness executions.

## 9. Suggested Technical Architecture

### 9.1 Backend (Rust)

- Rust service exposing API for auth/team/project/spec/task/agent/commit/stats/settings domains.
- Real-time channel support (e.g., WebSocket/SSE).
- Workflow orchestration engine for autonomous agents.
- Task execution harness integration using Aura Runtime.
- Persistent event store + relational/state store.

### 9.2 Frontend (React + TypeScript)

- SPA with persistent app shell:
  - Left Apps Bar
  - Project nav bar
  - Main contextual content
  - Bottom-left user/team context section
- State management for selected app/team/project and live entity streams.
- Reusable data-table/board components for each app module.

### 9.3 Integration Boundaries

- Clear API contracts between frontend and backend.
- Event schema for live updates (agent/task/commit/stats/team channels).
- Harness boundary for agent execution through Aura Runtime.
- Provider abstraction for multiple model API keys and vendors.

## 10. UX Requirements

- App switching should feel instant and preserve selected project context.
- Team switching should consistently re-scope projects and all app data.
- Current user and active team must always be visible in bottom-left.
- Project changes should re-scope all views consistently.
- Key entities (task/spec/project/team) should always be visibly identifiable in UI.
- Autonomous activity must be understandable at a glance (who, what, where, status).

## 11. MVP Scope

MVP must include:

1. Multi-app shell with Apps Bar and Projects nav bar.
2. Persistent selected-project behavior across app switches.
3. Basic implementations of Agents, Tasks (kanban), Commits, Stats, Settings.
4. Team-based auth (email/password registration/login) and membership model.
5. Team admin controls (promote admin, invite existing users).
6. Task/spec/project/team hierarchy with enforced constraints.
7. Basic autonomous workflow loop with real-time status updates.
8. Aura Runtime harness integration for agent task execution.
9. API key management for at least two providers.

## 12. Out of Scope (Initial)

- Native mobile apps.
- Advanced billing/organization administration.
- External marketplace/plugin ecosystem.
- Fully automated production deployment workflows.

## 13. Acceptance Criteria (High-Level)

1. User can register and log in via email/password.
2. A user can belong to multiple teams and switch active team.
3. Team admins can invite existing users and promote admins.
4. User can switch among all 5 apps from the left Apps Bar.
5. Bottom-left UI always shows current user and active team.
6. User can select a project in Projects nav and see app-specific contextual content.
7. Switching apps does not reset current project.
8. Tasks board supports all required columns and transitions.
9. Agents app reflects real-time status and active context.
10. Commits app shows live + historical commit activity linked to tasks/specs/projects/teams.
11. Stats app shows meaningful progress/KPI views.
12. Settings securely stores provider API keys.
13. Every code-change artifact is traceable to task → spec → project → team.
14. Autonomous workflows can continue without manual interaction and resume after restart.
15. Agent execution runs through Aura Runtime harness integration.
