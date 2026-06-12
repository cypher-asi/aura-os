//! Async runner that captures the workspace's build health at
//! `task_started` so the completion gate can diff against it at
//! `task_done`.
//!
//! This module is the App-side complement to
//! [`super::super::health::parse_cargo_check_json_output`]: the
//! pure-Rust parser lives in the `dev_loop::health` module (no I/O),
//! and the actual shell-out to `cargo check` lives here so the
//! dev-loop's tokio runtime owns the spawn-blocking boundary.
//!
//! Design notes:
//!
//! * The runner is fire-and-forget. The caller (the
//!   `task_started` arm in
//!   [`crate::handlers::dev_loop::streaming::side_effects`])
//!   `tokio::spawn`s it so claim latency stays unchanged. If the
//!   snapshot doesn't finish before `task_done`, the completion gate
//!   reads back `None` from the `HealthBaselineTracker` and falls
//!   through to the existing `workspace_health_unknown_baseline`
//!   path.
//! * Test status stays `TestStatus::Unknown` at baseline; running
//!   tests there is cost-prohibitive.
//! * `AURA_HEALTH_SNAPSHOT_DISABLED` short-circuits the spawn
//!   entirely, mirroring the parsing in
//!   [`super::classifiers::auto_decompose_disabled`]. Empty
//!   workspace paths short-circuit the same way (the dev-loop has
//!   no workspace to check).
//! * The wall-clock cap is [`HEALTH_SNAPSHOT_TIMEOUT`] (120s) —
//!   sized for a cold-cache `task_started` snapshot. The
//!   `task_done` snapshot (see `side_effects::maybe_run_health_gate`)
//!   reuses the same runner and inherits the same cap.
//! * On any tooling failure (timeout, cargo not found, non-UTF-8
//!   output, …) we return `WorkspaceHealth::unknown` so the gate
//!   can distinguish "we couldn't observe" from "workspace was
//!   clean".

use std::process::Command;

use super::super::health::{parse_cargo_check_json_output, WorkspaceHealth};

use super::super::limits::HEALTH_SNAPSHOT_TIMEOUT;

/// Capture the workspace's build health asynchronously.
///
/// Always returns a [`WorkspaceHealth`] — tooling errors are mapped
/// to [`WorkspaceHealth::unknown`] so the App layer can stash a
/// value either way and Phase 4 can branch on the
/// `BuildStatus::Unknown` discriminator.
///
/// The function shells out to `cargo check --workspace
/// --message-format=json --quiet` on `tokio::task::spawn_blocking` so
/// the dev-loop's tokio runtime isn't stalled.
pub(crate) async fn snapshot_workspace_health(workspace_path: String) -> WorkspaceHealth {
    if workspace_path.trim().is_empty() {
        return WorkspaceHealth::clean();
    }
    if health_snapshot_disabled() {
        return WorkspaceHealth::clean();
    }

    let blocking = tokio::task::spawn_blocking(move || run_cargo_check_json(&workspace_path));

    match tokio::time::timeout(HEALTH_SNAPSHOT_TIMEOUT, blocking).await {
        Ok(Ok(Some((stdout, exit_ok)))) => {
            let errors = parse_cargo_check_json_output(&stdout);
            if exit_ok && errors.is_empty() {
                WorkspaceHealth::clean()
            } else {
                WorkspaceHealth::failing(errors)
            }
        }
        Ok(Ok(None)) | Ok(Err(_)) | Err(_) => WorkspaceHealth::unknown(),
    }
}

/// True when the `AURA_HEALTH_SNAPSHOT_DISABLED` env var is set to a
/// truthy value. Mirrors the parser used by
/// [`super::classifiers::auto_decompose_disabled`] so the knob is
/// consistent with the rest of the dev-loop's env-var surface.
#[must_use]
pub(crate) fn health_snapshot_disabled() -> bool {
    std::env::var("AURA_HEALTH_SNAPSHOT_DISABLED")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// True when the `AURA_HEALTH_GATE` env var is set to a truthy value
/// (`1 | true | yes | on`, case-insensitive).
///
/// Default OFF and opt-in. Toggling this flag enables the live
/// forwarder demotion hook in
/// [`crate::handlers::dev_loop::streaming::side_effects`] that
/// intercepts `task_completed`, runs a fresh workspace-health
/// snapshot, and demotes the event to `task_failed` when the
/// workspace regressed against the `task_started` baseline.
#[must_use]
pub(crate) fn health_gate_enabled() -> bool {
    std::env::var("AURA_HEALTH_GATE")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Blocking runner: invoke `cargo check --workspace --message-format=json
/// --quiet` against `workspace_path` and return the captured stdout
/// plus the exit-success flag, or `None` if the process couldn't be
/// spawned / its output couldn't be read.
fn run_cargo_check_json(workspace_path: &str) -> Option<(String, bool)> {
    let output = Command::new("cargo")
        .args(["check", "--workspace", "--message-format=json", "--quiet"])
        .current_dir(workspace_path)
        .output()
        .ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    Some((stdout, output.status.success()))
}

#[cfg(test)]
// The std `ENV_GUARD` is deliberately held across awaits: it
// serializes whole env-mutating test bodies (process-global state), so
// an async-aware mutex would add ceremony without changing behavior.
#[allow(clippy::await_holding_lock)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Serialize the env-mutating tests in this module so cargo's
    /// parallel test runner can't observe a torn `AURA_HEALTH_SNAPSHOT_DISABLED`.
    /// Cargo runs unit tests in parallel by default; without this
    /// guard two tests that flip the same env var race each other.
    static ENV_GUARD: Mutex<()> = Mutex::new(());

    /// Empty workspace paths must short-circuit to `clean()` without
    /// spawning anything (the dev-loop has no workspace to inspect).
    #[tokio::test]
    async fn empty_workspace_path_short_circuits_to_clean() {
        let health = snapshot_workspace_health(String::new()).await;
        assert!(
            health.is_clean(),
            "empty workspace path must short-circuit to clean(), got {health:?}"
        );
    }

    /// Whitespace-only paths take the same short-circuit as empty.
    #[tokio::test]
    async fn whitespace_workspace_path_short_circuits_to_clean() {
        let health = snapshot_workspace_health("   \t\n".to_string()).await;
        assert!(
            health.is_clean(),
            "whitespace-only workspace path must short-circuit to clean(), got {health:?}"
        );
    }

    /// `AURA_HEALTH_SNAPSHOT_DISABLED` must short-circuit to `clean()`
    /// without spawning. Test mutates env; restores after.
    #[tokio::test]
    async fn env_var_short_circuits_to_clean() {
        let _guard = ENV_GUARD
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let key = "AURA_HEALTH_SNAPSHOT_DISABLED";
        let original = std::env::var(key).ok();
        // SAFETY: env mutation is constrained to this test scope,
        // serialized via ENV_GUARD, and restored at the end.
        std::env::set_var(key, "1");
        // Use a non-empty path so the env-var branch is the one that
        // wins. The path doesn't have to exist — we should never
        // shell out.
        let health =
            snapshot_workspace_health("C:\\definitely-not-a-real-path-xyz".to_string()).await;
        assert!(
            health.is_clean(),
            "AURA_HEALTH_SNAPSHOT_DISABLED=1 must short-circuit to clean(), got {health:?}"
        );
        if let Some(value) = original {
            std::env::set_var(key, value);
        } else {
            std::env::remove_var(key);
        }
    }

    /// The `AURA_HEALTH_GATE` knob parser must accept the same
    /// truthy spellings as the rest of the dev-loop's env-var surface.
    #[test]
    fn health_gate_enabled_parses_truthy_values() {
        let _guard = ENV_GUARD
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let key = "AURA_HEALTH_GATE";
        let original = std::env::var(key).ok();
        for truthy in ["1", "true", "yes", "on", "TRUE", "Yes", "ON"] {
            std::env::set_var(key, truthy);
            assert!(
                health_gate_enabled(),
                "expected `{truthy}` to parse as truthy"
            );
        }
        for falsy in ["", "0", "false", "no", "off", "anything-else"] {
            std::env::set_var(key, falsy);
            assert!(
                !health_gate_enabled(),
                "expected `{falsy}` to parse as falsy"
            );
        }
        std::env::remove_var(key);
        assert!(!health_gate_enabled(), "missing env var must be falsy");
        if let Some(value) = original {
            std::env::set_var(key, value);
        }
    }

    /// The disabled-knob parser must accept the same truthy spellings
    /// as the rest of the dev-loop's env-var surface.
    #[test]
    fn health_snapshot_disabled_parses_truthy_values() {
        let _guard = ENV_GUARD
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let key = "AURA_HEALTH_SNAPSHOT_DISABLED";
        let original = std::env::var(key).ok();
        for truthy in ["1", "true", "yes", "on", "TRUE", "Yes", "ON"] {
            std::env::set_var(key, truthy);
            assert!(
                health_snapshot_disabled(),
                "expected `{truthy}` to parse as truthy"
            );
        }
        for falsy in ["", "0", "false", "no", "off", "anything-else"] {
            std::env::set_var(key, falsy);
            assert!(
                !health_snapshot_disabled(),
                "expected `{falsy}` to parse as falsy"
            );
        }
        std::env::remove_var(key);
        assert!(!health_snapshot_disabled(), "missing env var must be falsy");
        if let Some(value) = original {
            std::env::set_var(key, value);
        }
    }
}
