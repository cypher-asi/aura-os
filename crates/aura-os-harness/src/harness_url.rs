//! Canonical resolution of the local harness HTTP base URL (`LOCAL_HARNESS_URL`).

use aura_os_core::Channel;
use url::Url;

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

#[must_use]
pub fn is_hosted_harness_base_url(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let Ok(parsed) = Url::parse(trimmed) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    match parsed.host_str() {
        Some(host) => {
            let normalized = host.trim_start_matches('[').trim_end_matches(']');
            !matches!(normalized, "127.0.0.1" | "::1")
                && !normalized.eq_ignore_ascii_case("localhost")
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_harness_base_url_rejects_loopback_and_non_http() {
        assert!(is_hosted_harness_base_url(
            "https://aura-harness-latest.onrender.com"
        ));
        assert!(!is_hosted_harness_base_url("http://localhost:8080"));
        assert!(!is_hosted_harness_base_url("http://127.0.0.1:8080"));
        assert!(!is_hosted_harness_base_url("http://[::1]:8080"));
        assert!(!is_hosted_harness_base_url("ws://example.com"));
    }
}
