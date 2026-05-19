use futures_util::StreamExt;
use tokio::sync::broadcast;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{info, warn};

use crate::runner::automaton_event_kinds::DONE;

use super::event_normalization::normalize_automaton_event;

pub(super) async fn probe_initial_event<R>(
    read: &mut R,
) -> anyhow::Result<Option<serde_json::Value>>
where
    R: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    let probe = tokio::time::timeout(Duration::from_millis(200), read.next()).await;
    match probe {
        Ok(Some(Err(e))) => Err(anyhow::anyhow!(
            "automaton event stream died immediately after connect: {e}"
        )),
        Ok(None) => Err(anyhow::anyhow!(
            "automaton event stream closed immediately after connect"
        )),
        Ok(Some(Ok(WsMessage::Text(text)))) => Ok(parse_automaton_event(&text)),
        Ok(Some(Ok(WsMessage::Close(_)))) => Err(anyhow::anyhow!(
            "automaton event stream sent close frame immediately after connect"
        )),
        Ok(Some(Ok(_))) | Err(_) => Ok(None),
    }
}

pub(super) fn spawn_automaton_reader<W, R>(
    automaton_id: String,
    write: W,
    mut read: R,
    tx: broadcast::Sender<serde_json::Value>,
    buffered_event: Option<serde_json::Value>,
) -> tokio::task::JoinHandle<()>
where
    W: Send + 'static,
    R: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin
        + Send
        + 'static,
{
    tokio::spawn(async move {
        let _keep_write = write;
        if send_buffered_event(&automaton_id, &tx, buffered_event) {
            return;
        }
        while let Some(msg_result) = read.next().await {
            if should_stop_reader(&automaton_id, &tx, msg_result) {
                break;
            }
        }
        info!(automaton_id = %automaton_id, "Automaton event stream ended");
    })
}

fn send_buffered_event(
    automaton_id: &str,
    tx: &broadcast::Sender<serde_json::Value>,
    event: Option<serde_json::Value>,
) -> bool {
    let Some(event) = event else {
        return false;
    };
    let is_done = event.get("type").and_then(|t| t.as_str()) == Some(DONE);
    let _ = tx.send(event);
    if is_done {
        info!(%automaton_id, "Automaton event stream ended");
    }
    is_done
}

fn should_stop_reader(
    automaton_id: &str,
    tx: &broadcast::Sender<serde_json::Value>,
    msg_result: Result<WsMessage, tokio_tungstenite::tungstenite::Error>,
) -> bool {
    match msg_result {
        Ok(WsMessage::Text(text)) => parse_and_send_event(tx, &text),
        Ok(WsMessage::Close(_)) => true,
        Err(e) => {
            warn!(error = %e, %automaton_id, "Automaton event stream error");
            true
        }
        _ => false,
    }
}

fn parse_and_send_event(tx: &broadcast::Sender<serde_json::Value>, text: &str) -> bool {
    let Some(event) = parse_automaton_event(text) else {
        return false;
    };
    let is_done = event.get("type").and_then(|t| t.as_str()) == Some(DONE);
    let _ = tx.send(event);
    is_done
}

fn parse_automaton_event(text: &str) -> Option<serde_json::Value> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(event) => Some(normalize_automaton_event(event)),
        Err(e) => {
            warn!(error = %e, "Failed to parse automaton event");
            None
        }
    }
}
