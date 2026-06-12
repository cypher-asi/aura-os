//! Owning handle for a live automaton [`HarnessSession`].
//!
//! Relocated out of the (now-removed) `automaton_client` transport in
//! the harness-unification refactor. The legacy handle wrapped a bare
//! `tokio::task::AbortHandle` over the `connect_event_stream` reader
//! task; the canonical [`crate::HarnessLink`] transport instead returns
//! a fully-wired [`HarnessSession`] (typed + raw broadcast senders plus
//! the `commands_tx` mpsc into the WS writer), so this handle simply
//! *owns* that session.
//!
//! Dropping the session drops its `commands_tx`, which ends the
//! ws-bridge writer task, which closes the WebSocket sink, which ends
//! the reader task and releases the harness's per-process WS-slot
//! permit. (See `crate::ws_bridge::spawn_ws_bridge`.) That is the exact
//! teardown the old `AbortHandle::abort()` achieved, expressed through
//! ownership instead of a detached task abort.
//!
//! Behaviour preserved from the legacy handle:
//! * [`cancel`](Self::cancel): explicit teardown for call sites that
//!   know the stream is no longer wanted (e.g. the `stop_loop` path).
//!   Takes the session out of the shared cell even when other clones
//!   are still alive, so the WS slot is released immediately.
//! * [`Drop`]: safety net so a handle dropped on the floor still tears
//!   down its session once the last clone goes away.
//! * Cloning is cheap (`Arc` over the inner cell); all clones share the
//!   same underlying session and it is only torn down when the last
//!   clone drops or any clone calls `cancel`. Every `cancel` is
//!   idempotent.

use std::sync::{Arc, Mutex};

use crate::harness::HarnessSession;

/// Handle that owns a live automaton [`HarnessSession`] and tears it
/// down (releasing the upstream WS slot) on [`cancel`](Self::cancel)
/// or last-clone drop.
#[derive(Clone)]
pub struct WsReaderHandle {
    inner: Arc<WsReaderInner>,
}

struct WsReaderInner {
    session: Mutex<Option<HarnessSession>>,
}

impl WsReaderHandle {
    /// Wrap a live [`HarnessSession`], taking ownership of its
    /// `commands_tx` (and the typed/raw broadcast senders). Callers
    /// that want to keep consuming events should clone
    /// [`HarnessSession::raw_events_tx`] (or `events_tx`) *before*
    /// handing the session to this constructor.
    #[must_use]
    pub fn from_session(session: HarnessSession) -> Self {
        Self {
            inner: Arc::new(WsReaderInner {
                session: Mutex::new(Some(session)),
            }),
        }
    }

    /// Drop the owned session now, closing the harness WebSocket and
    /// releasing its `ws_slots` permit. Idempotent and safe to call
    /// from any clone — the session lives in a shared cell, so this
    /// tears it down even when other clones are still held.
    pub fn cancel(&self) {
        take_session(&self.inner.session);
    }
}

impl Drop for WsReaderInner {
    fn drop(&mut self) {
        // Safety net: if every `WsReaderHandle` clone is dropped without
        // an explicit `cancel`, still drop the session so the harness
        // releases its WS-slot permit instead of leaking it for the
        // lifetime of the automaton.
        if let Ok(mut guard) = self.session.lock() {
            let _ = guard.take();
        }
    }
}

/// Take the session out of a shared cell, tolerating a poisoned lock
/// (the only thing the guard ever protects is an `Option` we `take`,
/// so a panic elsewhere can never leave it in an inconsistent state).
fn take_session(cell: &Mutex<Option<HarnessSession>>) {
    match cell.lock() {
        Ok(mut guard) => {
            let _ = guard.take();
        }
        Err(poisoned) => {
            let _ = poisoned.into_inner().take();
        }
    }
}

impl std::fmt::Debug for WsReaderHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsReaderHandle").finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::{broadcast, mpsc};

    /// Build a [`HarnessSession`] backed by real channels, returning it
    /// alongside the `commands_tx` receiver. The receiver observing
    /// `None`/closed is our proxy for "the WS writer task would now
    /// shut down and release the slot", since dropping the session is
    /// what drops the only `commands_tx` sender.
    fn fake_session() -> (
        HarnessSession,
        mpsc::Receiver<aura_protocol::InboundMessage>,
    ) {
        let (events_tx, _) = broadcast::channel(8);
        let (raw_events_tx, _) = broadcast::channel(8);
        let (commands_tx, commands_rx) = mpsc::channel(8);
        let session = HarnessSession {
            session_id: "run-1".to_string(),
            run_id: "run-1".to_string(),
            events_tx,
            raw_events_tx,
            commands_tx,
            pending_events: Vec::new(),
            events_rx: None,
        };
        (session, commands_rx)
    }

    #[tokio::test]
    async fn cancel_drops_session_and_closes_command_channel() {
        let (session, mut commands_rx) = fake_session();
        let handle = WsReaderHandle::from_session(session);
        // The writer would still be live: the command channel is open.
        assert!(commands_rx.try_recv().is_err());
        handle.cancel();
        // Dropping the session dropped the sole `commands_tx`, so the
        // receiver now observes a closed channel — the signal that the
        // ws-bridge writer ends and the slot is released.
        assert!(commands_rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn drop_releases_session() {
        let (session, mut commands_rx) = fake_session();
        let handle = WsReaderHandle::from_session(session);
        drop(handle);
        assert!(commands_rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn clone_keeps_session_alive_until_last_drop() {
        let (session, mut commands_rx) = fake_session();
        let handle = WsReaderHandle::from_session(session);
        let clone = handle.clone();
        drop(handle);
        // The clone still holds the Arc, so the session — and its
        // `commands_tx` — must still be alive.
        assert!(commands_rx.try_recv().is_err());
        drop(clone);
        assert!(commands_rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn cancel_is_idempotent() {
        let (session, _commands_rx) = fake_session();
        let handle = WsReaderHandle::from_session(session);
        handle.cancel();
        handle.cancel();
        let clone = handle.clone();
        clone.cancel();
    }
}
