use tokio::sync::broadcast;
use tokio::time::Duration;
use tracing::{debug, info, warn};

use futures_util::StreamExt;
use tokio_tungstenite::tungstenite;

use crate::state::ValidationCache;

fn wrap_balance_event(text: &str) -> Option<serde_json::Value> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let balance_cents = value.get("balance_cents").and_then(|v| v.as_i64());
    let balance_formatted = value
        .get("balance_formatted")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    Some(serde_json::json!({
        "type": "credit_balance_updated",
        "balance_cents": balance_cents,
        "balance_formatted": balance_formatted,
    }))
}

/// Convert an HTTP(S) base URL to a WebSocket URL for the balance endpoint.
fn build_ws_url(base_url: &str, jwt: &str) -> String {
    let ws_base = base_url
        .replace("https://", "wss://")
        .replace("http://", "ws://")
        .trim_end_matches('/')
        .to_string();
    format!("{ws_base}/ws/balance?token={jwt}")
}

async fn read_ws_messages(
    ws_stream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    broadcast_tx: &broadcast::Sender<serde_json::Value>,
) {
    let (_, mut read) = ws_stream.split();
    loop {
        match read.next().await {
            Some(Ok(tungstenite::Message::Text(text))) => {
                if let Some(wrapped) = wrap_balance_event(&text) {
                    if broadcast_tx.send(wrapped).is_err() {
                        debug!("No local WS subscribers for billing balance event");
                    }
                }
            }
            Some(Ok(tungstenite::Message::Close(_))) | None => {
                info!("z-billing WebSocket closed");
                break;
            }
            Some(Ok(_)) => {}
            Some(Err(e)) => {
                warn!(error = %e, "z-billing WebSocket error");
                break;
            }
        }
    }
}

fn get_cached_jwt(cache: &ValidationCache) -> Option<String> {
    cache.iter().next().map(|entry| entry.key().clone())
}

/// Connects to z-billing's `/ws/balance` WebSocket and rebroadcasts real-time
/// balance updates on the local `event_broadcast` channel.
///
/// Uses a JWT from the validation cache (populated when a user logs in).
pub(crate) fn spawn_billing_ws_bridge(
    billing_base_url: String,
    cache: ValidationCache,
    broadcast_tx: broadcast::Sender<serde_json::Value>,
) {
    tokio::spawn(async move {
        let mut backoff = Duration::from_secs(2);
        let max_backoff = Duration::from_secs(60);

        loop {
            let jwt = match get_cached_jwt(&cache) {
                Some(jwt) => jwt,
                None => {
                    debug!("No cached session for billing WS bridge, retrying...");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };

            let url = build_ws_url(&billing_base_url, &jwt);
            debug!("Connecting to z-billing WS...");

            match tokio_tungstenite::connect_async(&url).await {
                Ok((ws_stream, _)) => {
                    info!("Connected to z-billing WebSocket");
                    backoff = Duration::from_secs(2);
                    read_ws_messages(ws_stream, &broadcast_tx).await;
                }
                Err(e) => {
                    warn!(error = %e, "Failed to connect to z-billing WebSocket");
                }
            }

            info!(
                backoff_secs = backoff.as_secs(),
                "Reconnecting to z-billing WS..."
            );
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(max_backoff);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn build_ws_url_https() {
        let url = build_ws_url("https://z-billing.onrender.com", "tok123");
        assert_eq!(url, "wss://z-billing.onrender.com/ws/balance?token=tok123");
    }

    #[test]
    fn build_ws_url_http() {
        let url = build_ws_url("http://localhost:8080", "jwt");
        assert_eq!(url, "ws://localhost:8080/ws/balance?token=jwt");
    }

    #[test]
    fn build_ws_url_trailing_slash() {
        let url = build_ws_url("https://z-billing.onrender.com/", "t");
        assert_eq!(url, "wss://z-billing.onrender.com/ws/balance?token=t");
    }

    #[test]
    fn wrap_balance_event_valid() {
        let msg = r#"{"userId":"u1","balance_cents":5000,"balance_formatted":"$50.00"}"#;
        let wrapped = wrap_balance_event(msg).unwrap();
        assert_eq!(wrapped["type"], "credit_balance_updated");
        assert_eq!(wrapped["balance_cents"], 5000);
        assert_eq!(wrapped["balance_formatted"], "$50.00");
    }

    #[test]
    fn wrap_balance_event_invalid_json() {
        assert!(wrap_balance_event("not json").is_none());
    }

    #[test]
    fn get_cached_jwt_returns_none_when_empty() {
        let cache: ValidationCache = Arc::new(dashmap::DashMap::new());
        assert!(get_cached_jwt(&cache).is_none());
    }
}
