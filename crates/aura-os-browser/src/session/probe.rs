//! Active localhost port probe.
//!
//! Fires parallel TCP connect attempts against [`PORT_WHITELIST`] within a
//! total budget; returns [`DetectedUrl`] entries for every port that
//! accepted a connection. This is a *liveness* check, not a protocol
//! handshake — good enough to pick the first running dev server without
//! pulling in an HTTP client.

use std::time::{Duration, Instant};

use chrono::Utc;
use tokio::net::TcpStream;
use tokio::time;
use tracing::{debug, trace};
use url::Url;

use crate::config::BrowserConfig;
use crate::session::discovery::PORT_WHITELIST;
use crate::session::settings::{DetectedUrl, DetectionSource};

/// Probe `127.0.0.1` against [`PORT_WHITELIST`].
///
/// Runs until either the list is exhausted or `config.probe_budget` elapses.
/// Each individual connect attempt is capped at
/// `config.probe_per_port_timeout`.
pub async fn probe_dev_ports(config: &BrowserConfig) -> Vec<DetectedUrl> {
    probe_dev_ports_on(config, "127.0.0.1").await
}

/// Probe `host` against [`PORT_WHITELIST`] with the budgets from `config`.
pub async fn probe_dev_ports_on(config: &BrowserConfig, host: &str) -> Vec<DetectedUrl> {
    let deadline = Instant::now() + config.probe_budget;
    let mut open = Vec::new();

    for &port in PORT_WHITELIST {
        if Instant::now() >= deadline {
            debug!(?port, "probe budget exhausted before reaching port");
            break;
        }
        let per_timeout = config.probe_per_port_timeout.min(deadline - Instant::now());
        if try_connect(host, port, per_timeout).await {
            if let Some(detected) = build_detected(host, port) {
                open.push(detected);
            }
        }
    }

    open
}

async fn try_connect(host: &str, port: u16, timeout: Duration) -> bool {
    let addr = format!("{host}:{port}");
    match time::timeout(timeout, TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => {
            trace!(%host, port, "port accepted connection");
            true
        }
        Ok(Err(err)) => {
            trace!(%host, port, %err, "connect failed");
            false
        }
        Err(_) => {
            trace!(%host, port, "connect timed out");
            false
        }
    }
}

fn build_detected(host: &str, port: u16) -> Option<DetectedUrl> {
    let raw = format!("http://{host}:{port}/");
    Url::parse(&raw).ok().map(|url| DetectedUrl {
        url,
        source: DetectionSource::Probe,
        at: Utc::now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[tokio::test(flavor = "current_thread")]
    async fn probe_finds_a_listening_port() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let config = BrowserConfig {
            probe_budget: Duration::from_millis(250),
            probe_per_port_timeout: Duration::from_millis(50),
            ..BrowserConfig::default()
        };
        let detected = probe_dev_ports_on_with_ports(&config, "127.0.0.1", &[addr.port()]).await;
        assert_eq!(detected.len(), 1);
        assert_eq!(detected[0].source, DetectionSource::Probe);
    }

    async fn probe_dev_ports_on_with_ports(
        config: &BrowserConfig,
        host: &str,
        ports: &[u16],
    ) -> Vec<DetectedUrl> {
        let deadline = Instant::now() + config.probe_budget;
        let mut open = Vec::new();
        for &port in ports {
            if Instant::now() >= deadline {
                break;
            }
            let per = config.probe_per_port_timeout.min(deadline - Instant::now());
            if try_connect(host, port, per).await {
                if let Some(d) = build_detected(host, port) {
                    open.push(d);
                }
            }
        }
        open
    }

    #[tokio::test(flavor = "current_thread")]
    async fn probe_times_out_on_closed_ports_quickly() {
        let config = BrowserConfig {
            probe_budget: Duration::from_millis(120),
            probe_per_port_timeout: Duration::from_millis(30),
            ..BrowserConfig::default()
        };
        let start = Instant::now();
        let _ = probe_dev_ports_on(&config, "127.0.0.1").await;
        assert!(start.elapsed() < Duration::from_millis(600));
    }
}
