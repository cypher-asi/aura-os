use std::sync::Arc;

use tokio::sync::broadcast;
use tokio::time::Duration;
use tracing::{debug, info, warn};

use futures_util::StreamExt;
use tokio_tungstenite::tungstenite;

use aura_os_network::NetworkClient;

use crate::state::ValidationCache;

fn wrap_network_event(text: &str) -> Option<serde_json::Value> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => {
            let event_type = value
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            Some(serde_json::json!({
                "type": "network_event",
                "network_event_type": event_type,
                "payload": value,
            }))
        }
        Err(e) => {
            debug!(error = %e, "Non-JSON message from network WS");
            None
        }
    }
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
                if let Some(wrapped) = wrap_network_event(&text) {
                    if broadcast_tx.send(wrapped).is_err() {
                        debug!("No local WS subscribers for network event");
                    }
                }
            }
            Some(Ok(tungstenite::Message::Close(_))) | None => {
                info!("aura-network WebSocket closed");
                break;
            }
            Some(Ok(_)) => {}
            Some(Err(e)) => {
                warn!(error = %e, "aura-network WebSocket error");
                break;
            }
        }
    }
}

/// Pick any valid JWT from the validation cache for the bridge connection.
fn get_cached_jwt(cache: &ValidationCache) -> Option<String> {
    cache.iter().next().map(|entry| entry.key().clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::CachedSession;
    use chrono::Utc;
    use std::time::Instant;

    fn make_session() -> aura_os_core::ZeroAuthSession {
        aura_os_core::ZeroAuthSession {
            user_id: "u1".into(),
            network_user_id: None,
            profile_id: None,
            display_name: "Test".into(),
            profile_image: String::new(),
            primary_zid: "0://test".into(),
            zero_wallet: "0x0".into(),
            wallets: vec![],
            access_token: "the-jwt".into(),
            is_zero_pro: false,
            created_at: Utc::now(),
            validated_at: Utc::now(),
        }
    }

    #[test]
    fn get_cached_jwt_returns_none_when_empty() {
        let cache: ValidationCache = Arc::new(dashmap::DashMap::new());
        assert!(get_cached_jwt(&cache).is_none());
    }

    #[test]
    fn get_cached_jwt_returns_jwt_when_populated() {
        let cache: ValidationCache = Arc::new(dashmap::DashMap::new());
        cache.insert(
            "my-jwt".into(),
            CachedSession {
                session: make_session(),
                validated_at: Instant::now(),
            },
        );
        assert_eq!(get_cached_jwt(&cache).unwrap(), "my-jwt");
    }
}

/// Connects to the aura-network WebSocket and rebroadcasts social events
/// (feed activity, follows, usage updates) on the local event_broadcast channel.
///
/// Uses a JWT from the validation cache (populated when a user logs in)
/// to authenticate with aura-network.
pub(crate) fn spawn_network_ws_bridge(
    client: Arc<NetworkClient>,
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
                    debug!("No cached session for network WS bridge, retrying...");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };

            let url = client.ws_events_url(&jwt);
            debug!("Connecting to aura-network WS...");

            match tokio_tungstenite::connect_async(&url).await {
                Ok((ws_stream, _)) => {
                    info!("Connected to aura-network WebSocket");
                    backoff = Duration::from_secs(2);
                    read_ws_messages(ws_stream, &broadcast_tx).await;
                }
                Err(e) => {
                    warn!(error = %e, "Failed to connect to aura-network WebSocket");
                }
            }

            info!(
                backoff_secs = backoff.as_secs(),
                "Reconnecting to aura-network WS..."
            );
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(max_backoff);
        }
    });
}
