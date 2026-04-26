//! Tiny synchronous TCP probes used by the desktop startup pipeline to
//! poke local sidecars (harness, Vite dev server) without dragging in a
//! full HTTP client. All probes are short-timeout and best-effort —
//! callers treat any error / non-200 response as "not ready yet".

use std::io::{Read, Write};
use std::net::ToSocketAddrs;
use std::time::Duration;

pub(crate) fn parse_host_port(url: &str) -> Option<(String, u16)> {
    let uri: axum::http::Uri = url.parse().ok()?;
    let host = uri.host()?.to_string();
    let port = uri.port_u16().unwrap_or_else(|| {
        if uri.scheme_str() == Some("https") {
            443
        } else {
            80
        }
    });
    Some((host, port))
}

pub(crate) fn is_local_bind_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Fetch a JSON-body response from `base_url + path` with the same
/// short-timeout, no-redirect, TCP-level strategy as [`probe_http_ok`].
///
/// Returns `Some(parsed_json)` when the response is 200 OK and the body
/// parses as JSON; `None` on any failure (DNS, connect, timeout, non-200,
/// malformed body). Used by the `--external-harness` startup check to
/// read the aura-harness `/health` tool-policy fields
/// (`run_command_enabled`, `shell_enabled`, ...). Older harness versions
/// that don't publish those fields still produce valid JSON here; the
/// caller decides how to treat missing keys.
///
/// The body limit is deliberately loose (8 KiB) — the real /health
/// response is under 300 bytes but a future version may include more
/// diagnostics. We still cap it to keep a misbehaving endpoint from
/// hanging desktop startup.
pub(crate) fn probe_http_get_json(base_url: &str, path: &str) -> Option<serde_json::Value> {
    let probe_url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let uri: axum::http::Uri = probe_url.parse().ok()?;
    let host = uri.host()?;
    let port = uri.port_u16().unwrap_or_else(|| {
        if uri.scheme_str() == Some("https") {
            443
        } else {
            80
        }
    });
    let addr = format!("{host}:{port}")
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())?;
    let request_path = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/");

    let mut stream =
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

    write!(
        stream,
        "GET {request_path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )
    .ok()?;

    // Read up to 8 KiB of response (headers + body). With
    // `Connection: close` the server signals end-of-message by closing
    // the socket, so an ordinary read-to-EOF loop terminates naturally
    // when the harness has finished writing.
    let mut response = Vec::with_capacity(1024);
    let mut buf = [0_u8; 1024];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                response.extend_from_slice(&buf[..n]);
                if response.len() >= 8192 {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let response_text = std::str::from_utf8(&response).ok()?;
    let mut status_line_end = response_text.find("\r\n")?;
    let status_line = &response_text[..status_line_end];
    if !(status_line.starts_with("HTTP/1.1 200") || status_line.starts_with("HTTP/1.0 200")) {
        return None;
    }
    // `find` can return a position past the actual delimiter run when
    // headers are all \n-terminated (rare but legal); use the canonical
    // `\r\n\r\n` split and fall back to `\n\n` for tolerance.
    status_line_end += 2;
    let headers_end = response_text[status_line_end..]
        .find("\r\n\r\n")
        .map(|i| status_line_end + i + 4)
        .or_else(|| {
            response_text[status_line_end..]
                .find("\n\n")
                .map(|i| status_line_end + i + 2)
        })?;
    let body = &response_text[headers_end..];
    serde_json::from_str(body).ok()
}

pub(crate) fn probe_http_ok(base_url: &str, path: &str) -> bool {
    let probe_url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let Ok(uri) = probe_url.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(host) = uri.host() else {
        return false;
    };
    let port = uri.port_u16().unwrap_or_else(|| {
        if uri.scheme_str() == Some("https") {
            443
        } else {
            80
        }
    });
    let Some(addr) = format!("{host}:{port}")
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
    else {
        return false;
    };
    let request_path = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/");

    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300))
    else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));

    if write!(
        stream,
        "GET {request_path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }

    let mut buf = [0_u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    if n == 0 {
        return false;
    }

    let response = String::from_utf8_lossy(&buf[..n]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

pub(crate) fn probe_vite_dev_server(base_url: &str) -> bool {
    let probe_url = format!("{}/@vite/client", base_url.trim_end_matches('/'));
    let Ok(uri) = probe_url.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(host) = uri.host() else {
        return false;
    };
    let port = uri.port_u16().unwrap_or_else(|| {
        if uri.scheme_str() == Some("https") {
            443
        } else {
            80
        }
    });
    let Some(addr) = format!("{host}:{port}")
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
    else {
        return false;
    };
    let path = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/@vite/client");

    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(250))
    else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));

    if write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }

    let mut buf = [0_u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    if n == 0 {
        return false;
    }

    let response = String::from_utf8_lossy(&buf[..n]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

#[cfg(test)]
mod tests {
    use super::{is_local_bind_host, parse_host_port};

    #[test]
    fn parse_host_port_extracts_local_harness_bind_target() {
        assert_eq!(
            parse_host_port("http://127.0.0.1:19080"),
            Some(("127.0.0.1".to_string(), 19080))
        );
        assert_eq!(
            parse_host_port("https://localhost"),
            Some(("localhost".to_string(), 443))
        );
    }

    #[test]
    fn is_local_bind_host_only_accepts_loopback_targets() {
        assert!(is_local_bind_host("127.0.0.1"));
        assert!(is_local_bind_host("localhost"));
        assert!(is_local_bind_host("::1"));
        assert!(!is_local_bind_host("0.0.0.0"));
        assert!(!is_local_bind_host("harness.example.com"));
    }
}
