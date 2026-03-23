use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{debug, warn};

use crate::harness_protocol::{HarnessInbound, HarnessOutbound};

pub(crate) fn spawn_ws_bridge<S>(
    ws_stream: S,
) -> (
    mpsc::UnboundedReceiver<HarnessOutbound>,
    mpsc::UnboundedSender<HarnessInbound>,
)
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    let (outbound_tx, outbound_rx) = mpsc::unbounded_channel::<HarnessOutbound>();
    let (inbound_tx, mut inbound_rx) = mpsc::unbounded_channel::<HarnessInbound>();

    let (mut ws_sink, mut ws_stream_read) = ws_stream.split();

    // Reader: WS frames -> outbound channel
    let reader_tx = outbound_tx.clone();
    tokio::spawn(async move {
        while let Some(msg_result) = ws_stream_read.next().await {
            match msg_result {
                Ok(WsMessage::Text(text)) => {
                    debug!(raw = %text, "WS frame received");
                    match serde_json::from_str::<HarnessOutbound>(&text) {
                        Ok(event) => {
                            debug!(?event, "Parsed harness event");
                            if reader_tx.send(event).is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            warn!(raw = %text, "Failed to deserialize harness message: {e}");
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

    // Writer: inbound channel -> WS frames
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

    (outbound_rx, inbound_tx)
}
