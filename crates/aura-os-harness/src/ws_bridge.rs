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
    let (outbound_tx, _) = broadcast::channel::<OutboundMessage>(4096);
    let (raw_tx, _) = broadcast::channel::<serde_json::Value>(4096);
    let (inbound_tx, inbound_rx) = mpsc::unbounded_channel::<InboundMessage>();

    let (ws_sink, ws_stream_read) = ws_stream.split();
    spawn_bridge_reader(ws_stream_read, outbound_tx.clone(), raw_tx.clone());
    spawn_bridge_writer(ws_sink, inbound_rx);

    (outbound_tx, raw_tx, inbound_tx)
}

fn spawn_bridge_reader<R>(
    mut ws_stream_read: R,
    reader_tx: broadcast::Sender<OutboundMessage>,
    reader_raw_tx: broadcast::Sender<serde_json::Value>,
) where
    R: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin
        + Send
        + 'static,
{
    tokio::spawn(async move {
        while let Some(msg_result) = ws_stream_read.next().await {
            if handle_ws_message(msg_result, &reader_tx, &reader_raw_tx) {
                break;
            }
        }
    });
}

fn handle_ws_message(
    msg_result: Result<WsMessage, tokio_tungstenite::tungstenite::Error>,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
) -> bool {
    match msg_result {
        Ok(WsMessage::Text(text)) => {
            debug!(raw = %text, "WS frame received");
            forward_ws_text(&text, reader_tx, reader_raw_tx);
            false
        }
        Ok(WsMessage::Close(_)) => true,
        Err(e) => {
            debug!("WebSocket read error: {e}");
            true
        }
        _ => false,
    }
}

fn forward_ws_text(
    text: &str,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
) {
    match serde_json::from_str::<OutboundMessage>(text) {
        Ok(event) => {
            debug!(?event, "Parsed harness event");
            let _ = reader_tx.send(event);
        }
        Err(_) => forward_raw_ws_text(text, reader_raw_tx),
    }
}

fn forward_raw_ws_text(text: &str, reader_raw_tx: &broadcast::Sender<serde_json::Value>) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        debug!(raw = %text, "Forwarding untyped harness event");
        let _ = reader_raw_tx.send(value);
    } else {
        warn!(raw = %text, "Non-JSON harness message, dropping");
    }
}

fn spawn_bridge_writer<W>(mut ws_sink: W, mut inbound_rx: mpsc::UnboundedReceiver<InboundMessage>)
where
    W: SinkExt<WsMessage> + Unpin + Send + 'static,
    <W as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    tokio::spawn(async move {
        while let Some(cmd) = inbound_rx.recv().await {
            if send_ws_command(&mut ws_sink, cmd).await {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });
}

async fn send_ws_command<W>(ws_sink: &mut W, cmd: InboundMessage) -> bool
where
    W: SinkExt<WsMessage> + Unpin,
    <W as futures_util::Sink<WsMessage>>::Error: std::fmt::Display,
{
    match serde_json::to_string(&cmd) {
        Ok(json) => ws_sink.send(WsMessage::Text(json.into())).await.is_err(),
        Err(e) => {
            warn!("Failed to serialize harness command: {e}");
            false
        }
    }
}
