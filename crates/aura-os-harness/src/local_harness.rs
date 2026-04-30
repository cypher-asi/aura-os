use anyhow::Context;
use async_trait::async_trait;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite;
use tracing::info;

use crate::error::HarnessError;
use crate::harness::{build_session_init, HarnessLink, HarnessSession, SessionConfig};
use crate::harness_url::local_harness_base_url;
use crate::ws_bridge::spawn_ws_bridge;
use aura_protocol::{InboundMessage, OutboundMessage};

/// WebSocket close code 1013 ("Try Again Later") signals upstream
/// capacity exhaustion before the upgrade completes. Detect it by
/// matching the tungstenite close-frame code numerically.
const WS_CLOSE_CODE_TRY_AGAIN_LATER: u16 = 1013;

#[derive(Debug, Clone)]
pub struct LocalHarness {
    base_url: String,
}

impl LocalHarness {
    pub fn new(base_url: String) -> Self {
        Self { base_url }
    }

    pub fn from_env() -> Self {
        Self::new(local_harness_base_url())
    }

    fn ws_url(&self) -> String {
        let base = self
            .base_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        format!("{base}/stream")
    }
}

#[async_trait]
impl HarnessLink for LocalHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        let ws_url = self.ws_url();
        let connect_result = tokio::time::timeout(
            Duration::from_secs(8),
            tokio_tungstenite::connect_async(&ws_url),
        )
        .await
        .map_err(|_| {
            anyhow::anyhow!("timed out connecting to local harness websocket: {ws_url}")
        })?;
        let (ws_stream, _) = match connect_result {
            Ok(ok) => ok,
            Err(err) => {
                if is_capacity_exhausted_ws_error(&err) {
                    return Err(anyhow::Error::new(HarnessError::CapacityExhausted)
                        .context(format!("local harness websocket connect rejected: {err}")));
                }
                return Err(
                    anyhow::Error::new(err).context("local harness websocket connect failed")
                );
            }
        };

        let (events_tx, raw_events_tx, commands_tx) = spawn_ws_bridge(ws_stream);

        commands_tx
            .try_send(InboundMessage::SessionInit(Box::new(build_session_init(
                &config,
            ))))
            .context("local harness session_init send failed")?;

        let mut rx = events_tx.subscribe();
        let session_id = loop {
            match rx.recv().await {
                Ok(OutboundMessage::SessionReady(ready)) => {
                    break ready.session_id;
                }
                Ok(OutboundMessage::Error(err)) => {
                    anyhow::bail!("Harness error during init ({}): {}", err.code, err.message);
                }
                Err(_) => {
                    anyhow::bail!("Connection closed before session_ready");
                }
                _ => continue,
            }
        };

        info!(%session_id, "Local harness session ready");

        Ok(HarnessSession {
            session_id,
            events_tx,
            raw_events_tx,
            commands_tx,
        })
    }

    async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

/// Returns `true` when the tungstenite connect error matches an
/// upstream capacity-exhaustion rejection. Two wire shapes are
/// covered:
///
/// * `tungstenite::Error::Http` with status `503` (the upstream
///   refused the upgrade outright).
/// * Any tungstenite error whose `Display` form mentions WS close
///   code `1013` ("Try Again Later") — the rare path where the
///   upgrade completes briefly before the server slams a 1013 close
///   frame on top, observed when the slot semaphore loses a race
///   with the upgrade handshake.
///
/// Other transport errors (DNS, TLS, generic IO) intentionally fall
/// through so the existing `bad_gateway` mapping in the server keeps
/// firing for them.
fn is_capacity_exhausted_ws_error(err: &tungstenite::Error) -> bool {
    if let tungstenite::Error::Http(resp) = err {
        if resp.status().as_u16() == 503 {
            return true;
        }
    }
    let display = err.to_string();
    display.contains(&WS_CLOSE_CODE_TRY_AGAIN_LATER.to_string())
        && display.to_ascii_lowercase().contains("try again")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::http::Response;

    #[test]
    fn capacity_detector_matches_http_503() {
        let resp: Response<Option<Vec<u8>>> = Response::builder()
            .status(503)
            .body(None)
            .expect("response");
        let err = tungstenite::Error::Http(Box::new(resp));
        assert!(is_capacity_exhausted_ws_error(&err));
    }

    #[test]
    fn capacity_detector_ignores_http_502() {
        let resp: Response<Option<Vec<u8>>> = Response::builder()
            .status(502)
            .body(None)
            .expect("response");
        let err = tungstenite::Error::Http(Box::new(resp));
        assert!(!is_capacity_exhausted_ws_error(&err));
    }

    #[test]
    fn capacity_detector_ignores_unrelated_io_error() {
        let err = tungstenite::Error::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "nope",
        ));
        assert!(!is_capacity_exhausted_ws_error(&err));
    }
}
