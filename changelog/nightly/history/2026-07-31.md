# Safer worktree isolation and a sturdier desktop harness

- Date: `2026-07-31`
- Channel: `nightly`
- Version: `0.1.0-nightly.781.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.781.1

Today's nightly tightens two things that quietly shape day-to-day agent work: when Safe Workspace is offered to you, and how reliably the desktop harness and its cloud skills survive real-world restarts. The result is fewer confusing prompts in non-Git folders, a harness sidecar that finds its binary from a signed bundle, and hosted skill sync that actually notices when the remote registry has drifted.

## 4:54 AM — Safe Workspace hidden outside Git-backed projects

The Agent Chat panel now performs a read-only eligibility check before advertising Safe Workspace, so the option only surfaces where worktree isolation can actually work.

- Added a dedicated eligibility endpoint that probes whether the linked desktop folder is inside a Git repository with at least one commit, and hides the Safe Workspace affordance in the Agent Chat panel otherwise. (`399c614`)
- Preflight is strictly read-only: Aura never runs git init or mutates a user's source folder, and unsupported cases now return a clear "not a Git repository" or "needs at least one commit" message instead of a generic failure. (`399c614`)
- Agent-instance access is now re-authorized against the owning project before Safe Workspace status is returned, closing a cross-project lookup gap. (`399c614`)

## 4:03 AM — Desktop harness sidecar and hosted skill sync hardening

A larger stabilization pass reworks how the desktop app locates its harness binary and how the server reconciles cloud skills against a hosted Harness that may have restarted underneath it.

- Desktop now prefers the harness binary shipped next to the running executable — including the macOS .app Contents/Resources layout — before falling back to source-tree paths, avoiding a macOS Files & Folders permission prompt on launch and always running the signed, bundled sidecar. (`6cc5f34`)
- Added a guarded re-stage path that can replace a broken managed harness copy from the current app bundle, while explicitly refusing to touch operator-provided AURA_HARNESS_BIN overrides. (`6cc5f34`)
- Introduced a dedicated skills storage client and a new local harness-proxy sync module (~700 lines) so cloud skill definitions have a canonical materialization path shared by desktop and hosted deployments. (`6cc5f34`)
- Hosted skill reconciliation no longer trusts the local marker file alone: when the remote Harness is available, Aura re-POSTs the canonical definition and agent-skill assignment, logs a warning if the Harness rejects it, and lets sync retry — so a Harness restart or redeploy can no longer leave agents silently missing skills. (`6cc5f34`, `55487d1`)

## Highlights

- Safe Workspace now hidden in non-Git folders
- Desktop harness resolves its sidecar from the signed app bundle
- Hosted skill sync detects and retries drift against the remote Harness

