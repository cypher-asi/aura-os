//! Request DTOs and slicing/window helpers shared between the chat
//! HTTP handlers and the storage loaders.

use aura_os_core::SessionEvent;
use serde::{Deserialize, Serialize};

use super::constants::MAX_AGENT_HISTORY_WINDOW_LIMIT;

#[derive(Debug, Clone, Copy, Deserialize, Default)]
pub(crate) struct AgentEventsQuery {
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct PaginatedEventsQuery {
    pub limit: Option<usize>,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PaginatedEventsResponse {
    pub events: Vec<SessionEvent>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

pub(super) fn normalize_agent_history_limit(limit: Option<usize>) -> Option<usize> {
    limit.map(|value| value.min(MAX_AGENT_HISTORY_WINDOW_LIMIT))
}

/// Translate a caller's `(limit, offset)` window into the minimum total
/// number of events the storage loader must return so the final slice is
/// correct. Used as a short-circuit hint for
/// `load_events_oldest_first_bounded`: once we've collected this many
/// events walking sessions newest-first we can stop reading older
/// sessions. Returns `None` when the caller asked for an unbounded load.
pub(super) fn target_window_size(limit: Option<usize>, offset: usize) -> Option<usize> {
    normalize_agent_history_limit(limit).map(|l| l.saturating_add(offset))
}

pub(super) fn slice_recent_agent_events(
    messages: Vec<SessionEvent>,
    limit: Option<usize>,
    offset: usize,
) -> Vec<SessionEvent> {
    let Some(limit) = normalize_agent_history_limit(limit) else {
        return messages;
    };
    if limit == 0 {
        return Vec::new();
    }

    let total = messages.len();
    if offset >= total {
        return Vec::new();
    }

    let end = total.saturating_sub(offset);
    let start = end.saturating_sub(limit);
    messages[start..end].to_vec()
}

pub(super) fn apply_cursor_filter(
    messages: Vec<SessionEvent>,
    before: Option<&str>,
    after: Option<&str>,
) -> Vec<SessionEvent> {
    let mut result = messages;

    if let Some(after_id) = after {
        if let Some(pos) = result
            .iter()
            .position(|m| m.event_id.to_string() == after_id)
        {
            result = result[pos + 1..].to_vec();
        }
    }

    if let Some(before_id) = before {
        if let Some(pos) = result
            .iter()
            .position(|m| m.event_id.to_string() == before_id)
        {
            result = result[..pos].to_vec();
        }
    }

    result
}
