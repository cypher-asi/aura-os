//! Per-session identifiers and opaque handles.

use std::fmt;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::protocol::ServerEvent;

/// Opaque session id. A session is a live browser page target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(Uuid);

impl SessionId {
    /// Generate a fresh, random session id.
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Build from an existing [`Uuid`].
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::str::FromStr for SessionId {
    type Err = uuid::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

/// Handle returned by [`crate::BrowserManager::spawn`].
///
/// Dropping the handle cancels the session. Owners should keep it alive for
/// the duration of the WebSocket connection and call
/// [`crate::BrowserManager::kill`] explicitly when finished.
pub struct SessionHandle {
    /// The session's unique id.
    pub id: SessionId,
    /// The initial URL the session was navigated to (empty when resolver
    /// chose `about:blank`).
    pub initial_url: Option<url::Url>,
    /// Whether the client should focus the address bar on open.
    pub focus_address_bar: bool,
    /// Receiver for [`ServerEvent`]s produced by the backend. The server
    /// handler drains this and serializes to the WebSocket.
    pub events: mpsc::Receiver<ServerEvent>,
    /// Cancellation token; cancelled on kill / drop.
    pub cancel: CancellationToken,
}

impl fmt::Debug for SessionHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionHandle")
            .field("id", &self.id)
            .field("initial_url", &self.initial_url)
            .field("focus_address_bar", &self.focus_address_bar)
            .field("cancelled", &self.cancel.is_cancelled())
            .finish()
    }
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
