//! Inbound `X-Aura-Client-Retry` header parsing for instance chat POSTs.

/// Inbound header the chat client sets on every Phase 2 auto-retry
/// POST. Holds the retry attempt number as ASCII digits (1, 2, 3,
/// …); the server only checks for *presence* of a parseable
/// non-zero value to bump `client_auto_retry_streamdropped`. The
/// actual retry semantics (whether to retry, how long to back off)
/// stay client-side — this header is purely observability.
pub(crate) const CLIENT_RETRY_HEADER: &str = "x-aura-client-retry";

/// Returns `true` if the request carries a parseable
/// `X-Aura-Client-Retry: <n>` header with `n >= 1`. Anything else —
/// missing header, blank string, non-ASCII bytes, non-numeric
/// payload, or `0` — is treated as "not a retry" and silently
/// ignored. Header parse failures must NEVER reject the request:
/// the counter is best-effort observability.
pub(crate) fn header_indicates_client_retry(headers: &axum::http::HeaderMap) -> bool {
    let Some(value) = headers.get(CLIENT_RETRY_HEADER) else {
        return false;
    };
    let Ok(text) = value.to_str() else {
        return false;
    };
    text.trim().parse::<u64>().map(|n| n >= 1).unwrap_or(false)
}

#[cfg(test)]
mod client_retry_header_tests {
    use super::header_indicates_client_retry;
    use axum::http::HeaderMap;

    /// Pin the parsing rules for `X-Aura-Client-Retry`: any positive
    /// integer counts as a retry, blank / zero / non-numeric /
    /// missing values do not. The chat client always sends the
    /// attempt number (1+) on retries, so the threshold is "any
    /// positive integer". Header parse failures must never reject
    /// the request — the counter is best-effort observability.
    #[test]
    fn header_indicates_client_retry_only_for_positive_integers() {
        let mut headers = HeaderMap::new();
        assert!(
            !header_indicates_client_retry(&headers),
            "missing header must not bump the counter"
        );

        headers.insert("x-aura-client-retry", "1".parse().unwrap());
        assert!(header_indicates_client_retry(&headers));

        headers.insert("x-aura-client-retry", "  3  ".parse().unwrap());
        assert!(
            header_indicates_client_retry(&headers),
            "leading/trailing whitespace must be tolerated"
        );

        headers.insert("x-aura-client-retry", "0".parse().unwrap());
        assert!(
            !header_indicates_client_retry(&headers),
            "explicit 0 must not bump - only retries (>=1) count"
        );

        headers.insert("x-aura-client-retry", "abc".parse().unwrap());
        assert!(
            !header_indicates_client_retry(&headers),
            "non-numeric values must be silently ignored"
        );
    }
}
