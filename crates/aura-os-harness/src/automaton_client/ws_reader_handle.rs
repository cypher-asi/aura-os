use std::sync::Arc;

use tokio::task::AbortHandle;

/// Handle that keeps the harness WebSocket connection opened by
/// [`AutomatonClient::connect_event_stream`] alive for as long as it is
/// held, and closes it when cancelled or dropped.
///
/// The WebSocket reader spawned by `connect_event_stream` is a detached
/// `tokio::spawn` that owns both halves of the WS stream. Without an
/// explicit handle callers had no way to shut it down on restart or
/// stop, so every re-subscribe (infra retry, adopt-on-conflict, stop
/// loop) leaked one socket. The harness's per-node WS semaphore
/// (capped at 128 in `aura-node`) therefore filled up, causing
/// `503 Service Unavailable` on every subsequent `/stream/automaton/:id`
/// upgrade.
///
/// `WsReaderHandle` closes the loop by:
/// * [`cancel`](Self::cancel): explicit abort for call sites that know
///   the reader is no longer wanted (e.g. the `stop_loop` path).
/// * [`Drop`](Drop): safety net so a handle dropped on the floor still
///   tears down its reader task, letting the harness release its
///   permit. Aborting an already-finished task is a no-op.
///
/// Cloning is cheap (`Arc` on the inner state) and all clones share the
/// same underlying reader; the reader is only aborted when the last
/// clone is dropped or any clone explicitly calls `cancel`. Every
/// `cancel` is idempotent.
///
/// [`AutomatonClient::connect_event_stream`]: super::AutomatonClient::connect_event_stream
#[derive(Clone)]
pub struct WsReaderHandle {
    inner: Arc<WsReaderInner>,
}

struct WsReaderInner {
    abort: AbortHandle,
}

impl WsReaderHandle {
    pub(super) fn new(abort: AbortHandle) -> Self {
        Self {
            inner: Arc::new(WsReaderInner { abort }),
        }
    }

    /// Abort the spawned WebSocket reader task, dropping its owned
    /// stream halves so TCP closes and the harness releases the
    /// corresponding `ws_slots` permit.
    pub fn cancel(&self) {
        self.inner.abort.abort();
    }
}

impl Drop for WsReaderInner {
    fn drop(&mut self) {
        // Safety net: if every `WsReaderHandle` clone is dropped
        // without an explicit `cancel`, still abort so we don't leak
        // the harness-side permit for the lifetime of the automaton.
        self.abort.abort();
    }
}

impl std::fmt::Debug for WsReaderHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsReaderHandle").finish_non_exhaustive()
    }
}
