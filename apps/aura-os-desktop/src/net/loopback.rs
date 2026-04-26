//! Loopback-URL inspection used by the desktop startup self-heal
//! that strips stale `AURA_SERVER_BASE_URL` / `VITE_API_URL` overrides
//! pinned to a port nothing actually listens on.

/// Parse an explicit control-plane override URL just far enough to
/// decide whether it points at loopback on a port **different from**
/// the one we actually bound. Used by the desktop startup self-heal
/// to strip stale `AURA_SERVER_BASE_URL` / `VITE_API_URL` values that
/// would otherwise make
/// `aura_os_integrations::control_plane_api_base_url()` pin every
/// `send_to_agent` callback to a port nothing listens on (classic
/// symptom: "operation timed out" on 127.0.0.1:19847 even though the
/// embedded server bound an ephemeral port because 19847 was taken).
///
/// Returns `false` when:
///   * the URL can't be parsed as `http[s]://host[:port][/...]`,
///   * the host is not a recognised loopback literal (`127.0.0.1`,
///     `::1`, `localhost`), or
///   * no explicit port is present, or
///   * the explicit port already equals `bound_port`.
///
/// We deliberately don't strip non-loopback overrides — prod
/// deployments legitimately set these to a public URL.
pub(crate) fn url_is_loopback_with_port_other_than(url: &str, bound_port: u16) -> bool {
    match parse_loopback_port(url) {
        Some(port) => port != bound_port,
        None => false,
    }
}

/// Companion to [`url_is_loopback_with_port_other_than`] used by the
/// startup diagnostics log: returns `true` if `url` is a non-loopback
/// URL (prod override — mismatch is not our concern) **or** a loopback
/// URL whose port matches `bound_port`. Any surviving `false` after
/// the self-heal ran indicates a loopback override the self-heal
/// missed and is logged at error level.
pub(crate) fn url_loopback_port_matches(url: &str, bound_port: u16) -> bool {
    match parse_loopback_port(url) {
        Some(port) => port == bound_port,
        None => true,
    }
}

/// Extract the explicit port from a loopback-hosted URL, if any.
/// Returns `None` for any non-loopback host and for loopback URLs
/// without an explicit port (we can't compare against `bound_port`
/// in that case, so the caller defaults to "match").
fn parse_loopback_port(url: &str) -> Option<u16> {
    let trimmed = url.trim();
    // Scheme is case-insensitive per RFC 3986 — users legitimately
    // type `HTTP://...` in env files and we don't want the log to be
    // misleadingly quiet for those.
    let scheme_prefix_len = if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("http://") {
        7
    } else if trimmed.len() >= 8 && trimmed[..8].eq_ignore_ascii_case("https://") {
        8
    } else {
        return None;
    };
    let without_scheme = &trimmed[scheme_prefix_len..];
    let authority = without_scheme
        .split_once('/')
        .map(|(a, _)| a)
        .unwrap_or(without_scheme);
    let authority = authority
        .split_once('?')
        .map(|(a, _)| a)
        .unwrap_or(authority);
    let authority = authority
        .split_once('#')
        .map(|(a, _)| a)
        .unwrap_or(authority);
    let (host, port_str) = if let Some(stripped) = authority.strip_prefix('[') {
        // IPv6 literal: `[::1]:port`.
        let (host, rest) = stripped.split_once(']')?;
        let port_str = rest.strip_prefix(':')?;
        (host.to_string(), port_str)
    } else {
        let (host, port_str) = authority.split_once(':')?;
        (host.to_string(), port_str)
    };
    if !host_is_loopback(&host) {
        return None;
    }
    port_str.parse::<u16>().ok()
}

fn host_is_loopback(host: &str) -> bool {
    let normalized = host.trim().trim_start_matches('[').trim_end_matches(']');
    matches!(normalized, "127.0.0.1" | "::1") || normalized.eq_ignore_ascii_case("localhost")
}

#[cfg(test)]
mod tests {
    use super::{url_is_loopback_with_port_other_than, url_loopback_port_matches};

    #[test]
    fn stripped_when_loopback_port_differs() {
        assert!(url_is_loopback_with_port_other_than(
            "http://127.0.0.1:19847",
            52345
        ));
        assert!(url_is_loopback_with_port_other_than(
            "http://localhost:19847/",
            52345
        ));
        assert!(url_is_loopback_with_port_other_than(
            "http://[::1]:19847",
            52345
        ));
        assert!(url_is_loopback_with_port_other_than(
            "HTTP://LOCALHOST:19847",
            52345
        ));
    }

    #[test]
    fn kept_when_loopback_port_matches_bound_port() {
        assert!(!url_is_loopback_with_port_other_than(
            "http://127.0.0.1:19847",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "http://localhost:19847/api",
            19847
        ));
    }

    #[test]
    fn kept_for_non_loopback_hosts() {
        assert!(!url_is_loopback_with_port_other_than(
            "https://api.aura.dev:443",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "http://10.0.0.1:19847",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "https://render-app.onrender.com",
            19847
        ));
    }

    #[test]
    fn kept_when_port_missing_or_unparseable() {
        // No explicit port — we can't prove a mismatch, so don't strip.
        assert!(!url_is_loopback_with_port_other_than(
            "http://127.0.0.1",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "http://localhost/",
            19847
        ));
        // Garbage input — never strip.
        assert!(!url_is_loopback_with_port_other_than("not a url", 19847));
        assert!(!url_is_loopback_with_port_other_than("", 19847));
    }

    #[test]
    fn matches_helper_mirrors_the_strip_helper() {
        // Non-loopback override — not our concern; treated as "match".
        assert!(url_loopback_port_matches("https://api.aura.dev", 19847));
        // Loopback + correct port — match.
        assert!(url_loopback_port_matches("http://127.0.0.1:19847", 19847));
        // Loopback + wrong port — mismatch (would trigger the error log).
        assert!(!url_loopback_port_matches("http://127.0.0.1:3100", 19847));
    }
}
