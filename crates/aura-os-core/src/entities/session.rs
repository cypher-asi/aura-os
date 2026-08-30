use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::{ChatRole, SessionStatus};
use crate::ids::{AgentId, AgentInstanceId, ProjectId, SessionEventId, SessionId, TaskId};

/// `Session` enriched with cross-binding agent metadata.
///
/// Returned by the user-scoped session list endpoint
/// (`/api/me/sessions`) which the chat-app left panel uses to
/// render rows for every session the current user owns -- across
/// every agent + project -- in a single HTTP call. The previous
/// implementation in `apps/chat-app/components/ChatAppLeftPanel/ChatAppLeftPanel.tsx`
/// fanned out one `loadAgentSessions` call per agent (each of
/// which fanned out further per project binding), so the panel's
/// first paint cost `A x (1 + B)` HTTP calls for `A` agents and
/// `B` average bindings. With this shape it's `1`.
///
/// We deliberately do NOT include an `agent_name` field here:
/// `project_agents` in aura-storage has no `name` column, and
/// agent definitions live in aura-os (not aura-storage). The FE
/// resolves the name from its existing per-agent cache keyed by
/// `agent_id` rather than from a column that would always be
/// `NULL` on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnrichedSession {
    #[serde(flatten)]
    pub session: Session,
    /// `project_agents.agent_id` from aura-storage. Distinct from
    /// `Session.agent_instance_id` (which is the per-project
    /// instance binding row id). May be `None` if the binding row
    /// was deleted or migrated away from underneath the session,
    /// matching the LEFT JOIN tolerance on the storage side.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<AgentId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub session_id: SessionId,
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    /// Ephemeral: set by caller from in-memory engine state; not persisted.
    pub active_task_id: Option<TaskId>,
    /// Persisted as `tasks_worked_count` (length only); individual IDs are
    /// ephemeral. Used for the 8-task session rollover limit.
    #[serde(default)]
    pub tasks_worked: Vec<TaskId>,
    pub context_usage_estimate: f64,
    /// Ephemeral: accumulates per engine run; resets on reload from storage.
    #[serde(default)]
    pub total_input_tokens: u64,
    /// Ephemeral: accumulates per engine run; resets on reload from storage.
    #[serde(default)]
    pub total_output_tokens: u64,
    pub summary_of_previous_context: String,
    /// Durable user pin. `None` means the conversation follows ordinary
    /// recency ordering; pinned rows are grouped separately by clients.
    #[serde(default)]
    pub pinned_at: Option<DateTime<Utc>>,
    pub status: SessionStatus,
    /// Ephemeral: populated from auth context by the caller; not persisted.
    #[serde(default)]
    pub user_id: Option<String>,
    /// Ephemeral: populated from auth context by the caller; not persisted.
    #[serde(default)]
    pub model: Option<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

impl Session {
    pub fn dummy(project_id: ProjectId) -> Self {
        Self {
            session_id: SessionId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id,
            active_task_id: None,
            tasks_worked: vec![],
            context_usage_estimate: 0.0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            summary_of_previous_context: String::new(),
            pinned_at: None,
            status: SessionStatus::Active,
            user_id: None,
            model: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEvent {
    pub event_id: SessionEventId,
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_blocks: Option<Vec<ChatContentBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_duration_ms: Option<u64>,
    pub created_at: DateTime<Utc>,
    /// `Some(true)` when this row is a synthesized snapshot of an
    /// assistant turn that has been started (we have an
    /// `assistant_message_start` row) but not yet terminated by an
    /// `assistant_message_end`. Used by the UI to keep rendering the
    /// partial response (text + tool cards) and to flip the streaming
    /// state flag back on after a mid-turn page refresh, so chat and
    /// sidekick pending artifacts survive across reloads instead of
    /// disappearing until the turn finally completes.
    ///
    /// `None` (the default) on terminal turns reconstructed from
    /// `assistant_message_end` and on `user_message` / `task_output`
    /// rows so existing wire/storage payloads round-trip unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_flight: Option<bool>,
    /// Set on `user_message` rows that were *injected by another agent*
    /// rather than typed by the human user. Two paths populate it:
    ///
    /// 1. **A → B inbound** — when agent A invokes the harness
    ///    `send_to_agent` tool against agent B, the harness's
    ///    `cross_agent_hook::deliver_message` POSTs a `user_message`
    ///    into B's session carrying `from_agent_id: A's UUID` so B's
    ///    chat panel can label the inbound row "from <A>" instead of
    ///    rendering it indistinguishably from a real user prompt.
    ///
    /// 2. **B → A async reply** — when B's turn finishes, the
    ///    server-side `spawn_cross_agent_reply_callback` POSTs B's
    ///    reply back into A's session as another `user_message` (so
    ///    A's loop wakes and reacts), this time stamped with
    ///    `from_agent_id: B's UUID`. Without this field A's UI showed
    ///    Barret's "Hello back!" reply as a duplicate user message
    ///    above the real prompt.
    ///
    /// `None` on regular human-typed user messages and on every
    /// assistant / task-output row so the existing wire shape is
    /// unchanged for the common case (`skip_serializing_if`
    /// elides the field entirely).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_agent_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatContentBlock {
    Text {
        text: String,
    },
    Image {
        media_type: String,
        data: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_url: Option<String>,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
        /// Additive metadata that producers may stamp onto a `tool_use`
        /// block without a storage migration or a new variant. The
        /// live-subagent-thread path stamps `child_run_id`,
        /// `parent_tool_use_id`, `subagent_type`, `prompt`,
        /// `subagent_status`, and `subagent_reason` here onto the
        /// originating `task` block so a history reopen can re-attach to
        /// (and label) the spawned child thread. Captured generically
        /// with `flatten` so the field set stays forward-compatible and
        /// round-trips unknown keys instead of dropping them on read.
        #[serde(flatten, default, skip_serializing_if = "serde_json::Map::is_empty")]
        extra: serde_json::Map<String, serde_json::Value>,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
        /// IANA media type of an optional attached image result (e.g.
        /// `"image/png"`), mirroring the [`ChatContentBlock::Image`]
        /// `media_type` field. Set by computer-use / vision tools that
        /// return a rendered frame alongside (or instead of) text.
        /// Strictly additive: `#[serde(default)]` keeps existing
        /// persisted tool-result rows deserializing, and the
        /// skip-if-none pair keeps the stored JSON byte-identical when
        /// no image is present.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image_media_type: Option<String>,
        /// Base64-encoded PNG/JPEG payload paired with
        /// [`Self::ToolResult::image_media_type`]. Never logged. `None`
        /// for the ordinary string-only tool-result path.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image_data: Option<String>,
    },
    TaskRef {
        task_id: String,
        title: String,
    },
    SpecRef {
        spec_id: String,
        title: String,
    },
}

#[cfg(test)]
mod chat_content_block_tests {
    use super::ChatContentBlock;
    use serde_json::json;

    #[test]
    fn tool_use_round_trips_extra_subagent_fields() {
        // A `task` tool_use block stamped by the subagent dispatch must
        // round-trip its extra linkage fields (e.g. `child_run_id`)
        // through (de)serialization so a history reopen can re-attach.
        let raw = json!({
            "type": "tool_use",
            "id": "toolu_task_1",
            "name": "Task",
            "input": {"prompt": "explore"},
            "child_run_id": "child-run-123",
            "subagent_type": "explore",
            "subagent_status": "completed",
        });
        let block: ChatContentBlock =
            serde_json::from_value(raw).expect("tool_use with extras deserializes");
        let back = serde_json::to_value(&block).expect("serializes");
        assert_eq!(
            back.get("child_run_id").and_then(|v| v.as_str()),
            Some("child-run-123"),
            "child_run_id must survive the round-trip",
        );
        assert_eq!(
            back.get("subagent_type").and_then(|v| v.as_str()),
            Some("explore"),
        );
        assert_eq!(back.get("type").and_then(|v| v.as_str()), Some("tool_use"));
        assert_eq!(
            back.get("id").and_then(|v| v.as_str()),
            Some("toolu_task_1")
        );
        // The internal tag must not leak into the flattened extras.
        assert!(
            !back.get("input").is_none(),
            "core tool_use fields remain intact alongside extras",
        );
    }

    #[test]
    fn tool_use_without_extras_serializes_without_empty_keys() {
        let raw = json!({
            "type": "tool_use",
            "id": "toolu_1",
            "name": "read_file",
            "input": {"path": "src/lib.rs"},
        });
        let block: ChatContentBlock = serde_json::from_value(raw).expect("deserializes");
        let back = serde_json::to_value(&block).expect("serializes");
        let obj = back.as_object().expect("object");
        assert_eq!(obj.len(), 4, "no stray extra keys when nothing was stamped");
    }
}
