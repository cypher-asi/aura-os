//! Canonical resolution of the local harness HTTP base URL (`LOCAL_HARNESS_URL`).

/// Returns the configured local harness base URL, trimmed of trailing slashes.
///
/// Reads `LOCAL_HARNESS_URL` from the environment; defaults to `http://localhost:8080`
/// when unset (same default as the aura-os-server local harness autospawn logic).
pub fn local_harness_base_url() -> String {
    std::env::var("LOCAL_HARNESS_URL")
        .unwrap_or_else(|_| "http://localhost:8080".to_string())
        .trim_end_matches('/')
        .to_string()
}
