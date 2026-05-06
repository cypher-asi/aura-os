//! Canonical resolution of the local harness HTTP base URL (`LOCAL_HARNESS_URL`).

use aura_os_core::Channel;

/// Returns the configured local harness base URL, trimmed of trailing slashes.
///
/// Reads `LOCAL_HARNESS_URL` from the environment; defaults to a
/// channel-specific port on `http://localhost` (8080 stable, 8081 dev) so a
/// dev build's harness autospawn can't collide with a stable build's harness
/// running on the same machine.
pub fn local_harness_base_url() -> String {
    std::env::var("LOCAL_HARNESS_URL")
        .unwrap_or_else(|_| {
            format!(
                "http://localhost:{}",
                Channel::current().default_harness_port()
            )
        })
        .trim_end_matches('/')
        .to_string()
}
