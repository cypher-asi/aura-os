//! Passive URL discovery from terminal (or arbitrary log) output.
//!
//! Callers feed raw text lines via [`extract_localhost_urls`]. The function
//! returns zero or more validated URLs that look like a local dev server —
//! port whitelisted, scheme `http`/`https`, host `localhost`/`127.0.0.1`/
//! `0.0.0.0`/`[::1]`. A server handler can then persist these via
//! [`crate::SettingsStore::record_detected`].

use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use url::Url;

use crate::session::settings::{DetectedUrl, DetectionSource};

/// Whitelist of well-known dev-server ports. Lines that mention
/// `localhost:22` won't create a false positive.
pub const PORT_WHITELIST: &[u16] = &[
    3000, 3001, 3002, 3003, 3030, 4000, 4200, 4321, 5000, 5173, 5174, 5500, 5501, 5555, 6006, 7000,
    7070, 8000, 8001, 8080, 8081, 8088, 8888, 9000, 9001, 9090,
];

static URL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?ix)
        \b
        https?://
        (?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])
        (?::\d{2,5})?
        (?:/[^\s<>"'`]*)?
        "#,
    )
    .expect("localhost URL regex should compile")
});

const TRAILING_PUNCT: &[char] = &[
    ',', '.', ';', ':', ')', ']', '}', '>', '"', '\'', '`',
];

/// Extract dev-server URLs from an arbitrary line of text.
///
/// Returns a vector of [`DetectedUrl`] entries, one per distinct URL found,
/// stamped at `Utc::now()` with [`DetectionSource::Terminal`].
pub fn extract_localhost_urls(line: &str) -> Vec<DetectedUrl> {
    let mut out = Vec::new();
    for m in URL_RE.find_iter(line) {
        let raw = m.as_str();
        let trimmed = raw.trim_end_matches(TRAILING_PUNCT);
        let Ok(parsed) = Url::parse(trimmed) else {
            continue;
        };
        if !is_acceptable(&parsed) {
            continue;
        }
        let stripped = strip_query_and_fragment(&parsed);
        if out.iter().any(|entry: &DetectedUrl| entry.url == stripped) {
            continue;
        }
        out.push(DetectedUrl {
            url: stripped,
            source: DetectionSource::Terminal,
            at: Utc::now(),
        });
    }
    out
}

fn is_acceptable(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    match url.port_or_known_default() {
        Some(port) => PORT_WHITELIST.contains(&port),
        None => false,
    }
}

fn strip_query_and_fragment(url: &Url) -> Url {
    let mut stripped = url.clone();
    stripped.set_query(None);
    stripped.set_fragment(None);
    stripped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn urls(line: &str) -> Vec<String> {
        extract_localhost_urls(line)
            .into_iter()
            .map(|d| d.url.to_string())
            .collect()
    }

    #[test]
    fn finds_vite_local_line() {
        let line = "  ➜  Local:   http://localhost:5173/";
        assert_eq!(urls(line), vec!["http://localhost:5173/"]);
    }

    #[test]
    fn finds_ipv4_loopback_with_trailing_punct() {
        let line = "Listening on http://127.0.0.1:3000, press ctrl-c to exit.";
        assert_eq!(urls(line), vec!["http://127.0.0.1:3000/"]);
    }

    #[test]
    fn finds_0_0_0_0_binding() {
        let line = "bound to http://0.0.0.0:8080/ok";
        assert_eq!(urls(line), vec!["http://0.0.0.0:8080/ok"]);
    }

    #[test]
    fn rejects_non_local_hosts() {
        assert!(urls("fetched https://example.com:5173").is_empty());
    }

    #[test]
    fn rejects_non_whitelisted_ports() {
        assert!(urls("http://localhost:22 is ssh").is_empty());
        assert!(urls("http://127.0.0.1:80/").is_empty());
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(urls("connect ws://localhost:3000").is_empty());
    }

    #[test]
    fn dedups_within_line() {
        let line = "http://localhost:3000/ and again http://localhost:3000/";
        assert_eq!(urls(line), vec!["http://localhost:3000/"]);
    }

    #[test]
    fn strips_query_and_fragment() {
        let line = "visit http://localhost:5173/path?foo=1#hash to see";
        assert_eq!(urls(line), vec!["http://localhost:5173/path"]);
    }

    #[test]
    fn finds_ipv6_loopback() {
        let line = "listening at http://[::1]:8000/";
        assert_eq!(urls(line), vec!["http://[::1]:8000/"]);
    }

    #[test]
    fn empty_line_produces_no_matches() {
        assert!(urls("").is_empty());
        assert!(urls("nothing to see here").is_empty());
    }
}
