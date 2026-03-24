use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{debug, warn};

use aura_protocol::{InboundMessage, OutboundMessage};

pub(crate) fn spawn_ws_bridge<S>(
    ws_stream: S,
) -> (
    broadcast::Sender<OutboundMessage>,
    broadcast::Sender<serde_json::Value>,
    mpsc::UnboundedSender<InboundMessage>,
)
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    let (outbound_tx, _) = broadcast::channel::<OutboundMessage>(256);
    let (raw_tx, _) = broadcast::channel::<serde_json::Value>(256);
    let (inbound_tx, mut inbound_rx) = mpsc::unbounded_channel::<InboundMessage>();

    let (mut ws_sink, mut ws_stream_read) = ws_stream.split();

    let reader_tx = outbound_tx.clone();
    let reader_raw_tx = raw_tx.clone();
    tokio::spawn(async move {
        while let Some(msg_result) = ws_stream_read.next().await {
            match msg_result {
                Ok(WsMessage::Text(text)) => {
                    debug!(raw = %text, "WS frame received");
                    match serde_json::from_str::<OutboundMessage>(&text) {
                        Ok(event) => {
                            debug!(?event, "Parsed harness event");
                            let _ = reader_tx.send(event);
                        }
                        Err(_) => {
                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                debug!(raw = %text, "Forwarding untyped harness event");
                                let _ = reader_raw_tx.send(value);
                            } else {
                                warn!(raw = %text, "Non-JSON harness message, dropping");
                            }
                        }
                    }
                }
                Ok(WsMessage::Close(_)) => break,
                Err(e) => {
                    debug!("WebSocket read error: {e}");
                    break;
                }
                _ => {}
            }
        }
    });

    tokio::spawn(async move {
        while let Some(cmd) = inbound_rx.recv().await {
            match serde_json::to_string(&cmd) {
                Ok(json) => {
                    if ws_sink.send(WsMessage::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    warn!("Failed to serialize harness command: {e}");
                }
            }
        }
        let _ = ws_sink.close().await;
    });

    (outbound_tx, raw_tx, inbound_tx)
}
