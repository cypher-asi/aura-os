//! Per-session identifiers and opaque handles.

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
/// The real event-channel + cancel token live inside the manager registry.
/// The handle is a lightweight value containing only data the caller needs
/// to return to the client; dropping it does **not** cancel the session.
/// Use [`crate::BrowserManager::kill`] to end the session.
#[derive(Debug, Clone)]
pub struct SessionHandle {
    /// The session's unique id.
    pub id: SessionId,
    /// The initial URL the session was navigated to (empty when resolver
    /// chose `about:blank`).
    pub initial_url: Option<url::Url>,
    /// Whether the client should focus the address bar on open.
    pub focus_address_bar: bool,
}
