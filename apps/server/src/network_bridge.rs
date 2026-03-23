use std::sync::Arc;

use tokio::sync::broadcast;
use tokio::time::Duration;
use tracing::{debug, info, warn};

use futures_util::StreamExt;
use tokio_tungstenite::tungstenite;

use aura_os_network::NetworkClient;
use aura_os_store::RocksStore;

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

/// Connects to the aura-network WebSocket and rebroadcasts social events
/// (feed activity, follows, usage updates) on the local event_broadcast channel.
pub(crate) fn spawn_network_ws_bridge(
    client: Arc<NetworkClient>,
    store: Arc<RocksStore>,
    broadcast_tx: broadcast::Sender<serde_json::Value>,
) {
    tokio::spawn(async move {
        let mut backoff = Duration::from_secs(2);
        let max_backoff = Duration::from_secs(60);

        loop {
            let jwt = match store.get_jwt() {
                Some(jwt) => jwt,
                None => {
                    debug!("No session available for network WS bridge, retrying...");
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
