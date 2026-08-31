//! Session entity (live agent run on a project) types.

use serde::{Deserialize, Serialize};

/// Soft-delete marker used when an aura-storage deployment does not
/// support `DELETE /api/sessions/:id` yet. aura-os-server treats rows
/// with this status as absent from read/list surfaces.
pub const SESSION_STATUS_DELETED: &str = "deleted";

/// User-hidden session marker. Archived sessions remain readable and can be
/// restored; unlike `deleted`, list and detail endpoints continue to return
/// them so clients can render a dedicated archive section.
pub const SESSION_STATUS_ARCHIVED: &str = "archived";

/// Wire shape for the user-scoped session list endpoint
/// (`/api/me/sessions`). Wraps `StorageSession` with the agent
/// metadata aura-os-server needs to render rows in the chat-app
/// left panel without a follow-up `listProjectBindings` fan-out
/// per agent.
///
/// Mirrors `aura_storage_sessions::models::EnrichedSession` on the
/// aura-storage side (see migration 0015). Deliberately omits an
/// `agent_name` field: there is no `name` column on
/// `project_agents` in aura-storage (see migrations 0001 + 0009),
/// so the FE resolves agent names from its existing per-agent
/// cache rather than from a column that would always be `NULL` on
/// the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEnrichedSession {
    #[serde(flatten)]
    pub session: StorageSession,
    /// `project_agents.agent_id` -- the agent identifier the FE
    /// keys avatars and stream lanes by. Distinct from
    /// `StorageSession.project_agent_id` (the per-project instance
    /// binding row id, not the agent definition).
    #[serde(default)]
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSession {
    pub id: String,
    #[serde(default)]
    pub project_agent_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, alias = "contextUsage")]
    pub context_usage_estimate: Option<f64>,
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default, alias = "summary")]
    pub summary_of_previous_context: Option<String>,
    #[serde(default)]
    pub tasks_worked_count: Option<u32>,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    /// Number of `session_events` rows for this session. Maintained by
    /// the `session_events_after_insert` trigger in aura-storage
    /// (migration 0014). aura-os-server uses this on the list path to
    /// decide whether a row is navigable; pre-0014 deployments return
    /// `None` and we treat that as "unknown — keep the row".
    #[serde(default)]
    pub event_count: Option<u32>,
    /// Timestamp of the most recent `session_events` row for this
    /// session. Used as the primary sort key on the chat-app session
    /// list so the most recently-active sessions float to the top.
    #[serde(default)]
    pub last_event_at: Option<String>,
    /// Whether this session is publicly shared (read-only). `None` on
    /// aura-storage deployments predating the share feature; callers
    /// treat the absent value as "private".
    #[serde(default)]
    pub is_public: Option<bool>,
    /// Public share token (`t_<32 hex>`) when the session is shared.
    /// Acts as the capability token in the `https://aura.ai/s/<token>`
    /// public link; `None` when the session was never shared.
    #[serde(default)]
    pub public_share_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_usage_estimate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_of_previous_context: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "contextUsage")]
    pub context_usage_estimate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "summary")]
    pub summary_of_previous_context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks_worked_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    /// Flip the session's public-share flag. Set `Some(true)` by the
    /// create-share path; omitted from the wire payload when `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
    /// Public share token (`t_<32 hex>`) to persist alongside
    /// `is_public`. Omitted from the wire payload when `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_share_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_session_round_trips_share_fields() {
        let json = serde_json::json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "isPublic": true,
            "publicShareId": "t_6a1e3d8f6e548191948c1f0a9c68cbda",
        });
        let session: StorageSession =
            serde_json::from_value(json).expect("deserialize StorageSession");
        assert_eq!(session.is_public, Some(true));
        assert_eq!(
            session.public_share_id.as_deref(),
            Some("t_6a1e3d8f6e548191948c1f0a9c68cbda")
        );

        let reencoded = serde_json::to_value(&session).expect("serialize StorageSession");
        assert_eq!(reencoded["isPublic"], serde_json::json!(true));
        assert_eq!(
            reencoded["publicShareId"],
            serde_json::json!("t_6a1e3d8f6e548191948c1f0a9c68cbda")
        );
    }

    #[test]
    fn storage_session_defaults_share_fields_when_absent() {
        // Pre-share-feature aura-storage rows omit both columns.
        let session: StorageSession = serde_json::from_value(serde_json::json!({
            "id": "22222222-2222-2222-2222-222222222222",
        }))
        .expect("deserialize legacy StorageSession");
        assert_eq!(session.is_public, None);
        assert_eq!(session.public_share_id, None);
    }

    #[test]
    fn update_session_request_omits_none_share_fields() {
        let req = UpdateSessionRequest::default();
        let json = serde_json::to_value(&req).expect("serialize UpdateSessionRequest");
        assert!(json.get("isPublic").is_none());
        assert!(json.get("publicShareId").is_none());

        let req = UpdateSessionRequest {
            is_public: Some(true),
            public_share_id: Some("t_6a1e3d8f6e548191948c1f0a9c68cbda".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_value(&req).expect("serialize UpdateSessionRequest");
        assert_eq!(json["isPublic"], serde_json::json!(true));
        assert_eq!(
            json["publicShareId"],
            serde_json::json!("t_6a1e3d8f6e548191948c1f0a9c68cbda")
        );
    }
}
