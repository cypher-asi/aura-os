//! Classification of whether an agent's harness session will run
//! off-box (another pod / container / host) vs on the same loopback
//! interface as the control plane.
//!
//! The cross-agent tool manifest shipped to the harness via
//! `InstalledTool.endpoint` gets stamped with the control-plane base
//! URL (see [`aura_os_agent_tools::ceo::absolutize_agent_tool_endpoints`])
//! right before it leaves the server. When the harness runs off-box a
//! loopback URL like `http://127.0.0.1:3100` is unreachable — the
//! swarm harness POSTs into its own loopback and every cross-agent
//! tool call fails with `os error 10061 (connection refused)`. The
//! helpers below let the call sites ask "should I refuse to stamp a
//! loopback URL here?" without leaking the environment plumbing.

/// Returns true when the harness that will receive this agent's
/// session runs off-box (another pod / container / host) and therefore
/// cannot reach a loopback control-plane URL.
///
/// Inputs checked (in order):
/// 1. The agent's `machine_type` — anything other than `"local"` means
///    the session is routed through the swarm gateway on a remote
///    host (the canonical value is `"remote"`, but any non-`"local"`
///    variant maps to the same "runs off-box" classification).
/// 2. When `machine_type` is `"local"`, inspect the environment that
///    chooses the harness:
///     - If `LOCAL_HARNESS_URL` is set and its host is loopback, the
///       harness shares the server's loopback interface — return
///       `false`.
///     - If `LOCAL_HARNESS_URL` is set and its host is non-loopback,
///       the local-machine-type agent is being routed to a harness
///       on a different host — return `true`.
///     - If `LOCAL_HARNESS_URL` is unset but `SWARM_BASE_URL` is set,
///       the session will fall back to the swarm gateway — return
///       `true`. This matches
///       [`apps/aura-os-server/src/app_builder.rs`](../../../app_builder.rs)
///       where the SwarmHarness is constructed from `SWARM_BASE_URL`
///       and used when no local harness is wired in.
pub(crate) fn harness_target_is_remote(machine_type: &str) -> bool {
    if !machine_type.eq_ignore_ascii_case("local") {
        return true;
    }

    match std::env::var("LOCAL_HARNESS_URL") {
        Ok(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return swarm_base_url_is_set();
            }
            // Invalid URLs are treated as "unknown" rather than "remote"
            // to preserve forgiving local-dev semantics — if the harness
            // URL is malformed the operator will hit a clearer error
            // later when the session opens.
            match url::Url::parse(trimmed) {
                Ok(parsed) => match parsed.host_str() {
                    Some(host) => !is_loopback_host(host),
                    None => false,
                },
                Err(_) => false,
            }
        }
        Err(_) => swarm_base_url_is_set(),
    }
}

fn swarm_base_url_is_set() -> bool {
    std::env::var("SWARM_BASE_URL")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

/// Local copy of the loopback classifier used by the integrations
/// crate. Kept private here so the crate boundary's internals don't
/// leak — the set is tiny and stable (`127.0.0.1`, `::1`, `[::1]`,
/// `localhost`).
fn is_loopback_host(host: &str) -> bool {
    let normalized = host.trim().trim_start_matches('[').trim_end_matches(']');
    matches!(normalized, "127.0.0.1" | "::1") || normalized.eq_ignore_ascii_case("localhost")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialises env-var mutations within this test module. Tests in
    // other modules that also mutate `LOCAL_HARNESS_URL` / `SWARM_BASE_URL`
    // should take their own lock; we only need to prevent these four
    // tests from racing against each other.
    static HARNESS_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, prev }
        }

        fn unset(key: &'static str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn swarm_machine_type_is_always_remote() {
        let _lock = HARNESS_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _local = EnvGuard::set("LOCAL_HARNESS_URL", "http://127.0.0.1:19080");
        let _swarm = EnvGuard::unset("SWARM_BASE_URL");

        assert!(harness_target_is_remote("remote"));
        assert!(harness_target_is_remote("swarm_microvm"));
    }

    #[test]
    fn local_machine_type_with_loopback_harness_is_not_remote() {
        let _lock = HARNESS_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _local = EnvGuard::set("LOCAL_HARNESS_URL", "http://127.0.0.1:19080");
        let _swarm = EnvGuard::unset("SWARM_BASE_URL");

        assert!(!harness_target_is_remote("local"));
    }

    #[test]
    fn local_machine_type_with_non_loopback_harness_is_remote() {
        let _lock = HARNESS_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _local = EnvGuard::set("LOCAL_HARNESS_URL", "http://10.0.0.5:8080");
        let _swarm = EnvGuard::unset("SWARM_BASE_URL");

        assert!(harness_target_is_remote("local"));
    }

    #[test]
    fn local_machine_type_with_swarm_fallback_is_remote() {
        let _lock = HARNESS_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _local = EnvGuard::unset("LOCAL_HARNESS_URL");
        let _swarm = EnvGuard::set("SWARM_BASE_URL", "https://swarm.example.com");

        assert!(harness_target_is_remote("local"));
    }
}
