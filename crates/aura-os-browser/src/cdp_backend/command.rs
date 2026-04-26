//! Internal command type forwarded from the public [`BrowserBackend`]
//! trait methods to the per-session task.
//!
//! Kept in its own module so both [`super::backend`] (the sender side)
//! and [`super::session_loop`] (the receiver side) can refer to it
//! without a layering cycle.

use crate::protocol::ClientMsg;

/// Command forwarded from the public trait methods to the per-session
/// task. Variants:
///
/// - `Client`: a wire-protocol message to apply to the page.
/// - `Ack`: client has acknowledged the screencast frame with this seq.
/// - `Stop`: tear the session down on the next loop turn.
pub(super) enum SessionCommand {
    Client(ClientMsg),
    Ack(u32),
    Stop,
}
