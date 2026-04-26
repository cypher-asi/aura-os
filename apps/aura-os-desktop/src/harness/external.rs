//! `--external-harness` startup gate: validate that the harness pointed at
//! by `LOCAL_HARNESS_URL` is actually reachable and reports a command
//! policy compatible with the autonomous dev loop, otherwise exit fast
//! with a clear message.

use tracing::{info, warn};

use crate::init::env::env_string;
use crate::net::probe::{probe_http_get_json, probe_http_ok};

/// Outcome of the policy probe against an external harness `/health`
/// response. Reused by [`enforce_external_harness_or_exit`] and its
/// unit tests so the decision matrix is pinned in one place.
///
/// The standard aura-harness runtime now selects its command execution policy
/// explicitly at startup rather than reading env-based command switches. The
/// probe only warns when the advertised policy disagrees so mixed-version
/// external harnesses still boot with a clear diagnostic.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ExternalHarnessPolicy {
    /// Harness confirmed the command policy needed by the dev loop. Safe to proceed.
    RunCommandEnabled,
    /// Harness confirmed a disabled or incomplete command policy. This is
    /// incompatible with the autonomous dev loop, so startup must stop before
    /// the first agent turn fails on `run_command`.
    IncompleteCommandPolicy,
    /// Health probe succeeded but the field is missing — this is a
    /// pre-policy-disclosure harness (older than the /health schema
    /// bump). Warn but proceed, matching the existing "unknown is
    /// permissive" stance so mixed-version fleets keep working.
    UnknownLegacyHarness,
    /// `/health` responded 200 but returned something that isn't
    /// parseable JSON. Same treatment as `UnknownLegacyHarness` — warn
    /// and proceed.
    UnparseableResponse,
}

/// Classify a parsed `/health` JSON body into an
/// [`ExternalHarnessPolicy`]. Split out from
/// [`enforce_external_harness_or_exit`] so unit tests can pin the
/// decision matrix without spinning up a real harness.
pub(crate) fn classify_external_harness_policy(
    response: Option<&serde_json::Value>,
) -> ExternalHarnessPolicy {
    let Some(json) = response else {
        return ExternalHarnessPolicy::UnparseableResponse;
    };
    let Some(run_command_enabled) = json.get("run_command_enabled").and_then(|v| v.as_bool())
    else {
        return ExternalHarnessPolicy::UnknownLegacyHarness;
    };
    if !run_command_enabled {
        return ExternalHarnessPolicy::IncompleteCommandPolicy;
    }

    let Some(shell_enabled) = json.get("shell_enabled").and_then(|v| v.as_bool()) else {
        return ExternalHarnessPolicy::UnknownLegacyHarness;
    };
    if !shell_enabled {
        return ExternalHarnessPolicy::IncompleteCommandPolicy;
    }

    match json.get("binary_allowlist").and_then(|v| v.as_array()) {
        Some(list) if !list.is_empty() => ExternalHarnessPolicy::RunCommandEnabled,
        Some(_) => ExternalHarnessPolicy::IncompleteCommandPolicy,
        None => ExternalHarnessPolicy::UnknownLegacyHarness,
    }
}

/// Validate that an external harness is actually reachable before we let the
/// desktop shell boot with bundled-sidecar autospawn disabled. If the env
/// isn't set or the harness isn't up, exit fast with a clear message instead
/// of silently coming up and surfacing as a 20-second tool-callback timeout
/// the first time an agent tries to act.
///
/// This check fails fast when `/health` advertises an incomplete command
/// policy. Older harnesses that do not publish the policy fields still warn and
/// proceed, but an explicit `run_command_enabled=false`, `shell_enabled=false`,
/// or empty `binary_allowlist` is not usable for the autonomous dev loop.
pub(crate) fn enforce_external_harness_or_exit() {
    let Some(url) = env_string("LOCAL_HARNESS_URL").map(|v| v.trim_end_matches('/').to_string())
    else {
        eprintln!(
            "--external-harness requires LOCAL_HARNESS_URL to be set to the URL of the running \
             external harness (e.g. http://127.0.0.1:3404)."
        );
        std::process::exit(2);
    };

    if !probe_http_ok(&url, "/health") {
        eprintln!(
            "--external-harness was passed but LOCAL_HARNESS_URL ({url}) is not reachable at \
             /health. Start the external harness first, then rerun."
        );
        std::process::exit(2);
    }

    let policy = classify_external_harness_policy(probe_http_get_json(&url, "/health").as_ref());
    match policy {
        ExternalHarnessPolicy::RunCommandEnabled => {
            info!(url = %url, "external harness policy check: run_command enabled");
        }
        ExternalHarnessPolicy::IncompleteCommandPolicy => {
            warn!(
                url = %url,
                "external harness reports an incomplete command policy on /health. \
                 Refusing to start because the autonomous dev loop requires \
                 run_command, shell_script support, and a non-empty binary_allowlist."
            );
            eprintln!(
                "--external-harness connected to {url}, but that harness reports an incomplete \
                 command policy on /health. Restart it with the dev-loop ToolConfig profile \
                 (`ToolConfig::for_autonomous_dev_loop()`), or update AURA_HARNESS_BIN / \
                 LOCAL_HARNESS_URL to point at a current aura-node."
            );
            std::process::exit(2);
        }
        ExternalHarnessPolicy::UnknownLegacyHarness => {
            warn!(
                url = %url,
                "external harness /health did not publish run_command_enabled; \
                 assuming a pre-policy-disclosure aura-node build. Upgrade the \
                 harness if run_command invocations start failing."
            );
        }
        ExternalHarnessPolicy::UnparseableResponse => {
            warn!(
                url = %url,
                "external harness /health returned a body that could not be parsed as JSON; \
                 continuing without a policy check"
            );
        }
    }

    std::env::set_var("AURA_DESKTOP_EXTERNAL_HARNESS", "1");
    info!(
        url = %url,
        "using external harness; bundled local harness sidecar autospawn disabled"
    );
}

#[cfg(test)]
mod tests {
    use super::{classify_external_harness_policy, ExternalHarnessPolicy};

    // === External harness policy probe (3.0-class run_command fix) ===
    //
    // These pin the decision matrix for `enforce_external_harness_or_exit`
    // so the cross-repo contract with aura-node's `/health` handler
    // (crates/aura-runtime/src/router/mod.rs::health_handler) can't silently
    // drift. If someone renames the command-policy fields on the harness
    // side, or flips the runtime policy, this suite fails immediately.

    #[test]
    fn classify_policy_treats_explicit_true_as_enabled() {
        let body = serde_json::json!({
            "status": "ok",
            "version": "0.1.0",
            "run_command_enabled": true,
            "shell_enabled": true,
            "binary_allowlist": ["cargo", "git"],
        });
        assert_eq!(
            classify_external_harness_policy(Some(&body)),
            ExternalHarnessPolicy::RunCommandEnabled
        );
    }

    #[test]
    fn classify_policy_treats_explicit_false_as_disabled() {
        // A harness with a disabled command policy may be valid for other
        // embedders, but it is incompatible with the desktop dev loop. The
        // startup path treats this classification as fatal.
        let body = serde_json::json!({
            "status": "ok",
            "version": "0.1.0",
            "run_command_enabled": false,
            "shell_enabled": false,
            "binary_allowlist": [],
        });
        assert_eq!(
            classify_external_harness_policy(Some(&body)),
            ExternalHarnessPolicy::IncompleteCommandPolicy
        );
    }

    #[test]
    fn classify_policy_treats_missing_field_as_legacy_harness() {
        // Older aura-runtime builds that don't yet publish the policy
        // fields on /health are still allowed through with a warning -
        // mixed-version fleets must keep working.
        let body = serde_json::json!({
            "status": "ok",
            "version": "0.0.9",
        });
        assert_eq!(
            classify_external_harness_policy(Some(&body)),
            ExternalHarnessPolicy::UnknownLegacyHarness
        );
    }

    #[test]
    fn classify_policy_treats_empty_binary_allowlist_as_disabled() {
        let body = serde_json::json!({
            "status": "ok",
            "version": "0.1.0",
            "run_command_enabled": true,
            "shell_enabled": true,
            "binary_allowlist": [],
        });
        assert_eq!(
            classify_external_harness_policy(Some(&body)),
            ExternalHarnessPolicy::IncompleteCommandPolicy
        );
    }

    #[test]
    fn classify_policy_treats_non_bool_field_as_legacy_harness() {
        // Defensive: a harness that returns a string "true" instead of
        // a JSON boolean is treated the same as "missing" — warn and
        // proceed rather than silently hard-fail on a typo upstream.
        let body = serde_json::json!({
            "status": "ok",
            "run_command_enabled": "true",
        });
        assert_eq!(
            classify_external_harness_policy(Some(&body)),
            ExternalHarnessPolicy::UnknownLegacyHarness
        );
    }

    #[test]
    fn classify_policy_treats_none_response_as_unparseable() {
        assert_eq!(
            classify_external_harness_policy(None),
            ExternalHarnessPolicy::UnparseableResponse
        );
    }
}
