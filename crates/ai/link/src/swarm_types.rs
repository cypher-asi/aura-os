//! Request and response types for the Swarm automaton API.

use serde::{Deserialize, Serialize};

/// Request body for installing a new automaton.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallRequest {
    /// The kind of automaton to install (e.g. "file-watcher", "scheduler").
    pub kind: String,
    /// Automaton-specific configuration.
    pub config: serde_json::Value,
}

/// Response returned after successfully installing an automaton.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResponse {
    /// Unique identifier for the newly created automaton.
    pub automaton_id: String,
    /// Initial status (e.g. "running").
    pub status: String,
}

/// Current status of a single automaton.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomatonStatus {
    /// Automaton identifier.
    pub id: String,
    /// Automaton kind.
    pub kind: String,
    /// Current lifecycle status.
    pub status: String,
}

/// Summary info for an automaton in a listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomatonInfo {
    /// Automaton identifier.
    pub id: String,
    /// Automaton kind.
    pub kind: String,
    /// Current lifecycle status.
    pub status: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

/// A single server-sent event from an automaton's event stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomatonEvent {
    /// Event type tag.
    #[serde(rename = "type")]
    pub event_type: String,
    /// Event payload.
    pub data: serde_json::Value,
}
