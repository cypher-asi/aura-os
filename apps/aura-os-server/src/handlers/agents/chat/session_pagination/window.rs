//! Pure windowing/cursor helpers for the cursor-paginated chat-history
//! endpoints. Everything here operates on an ascending (oldest-first)
//! reconstructed message list and is side-effect free, so the paging
//! semantics are unit-testable without storage.

use aura_os_core::SessionEvent;

use super::super::constants::MAX_AGENT_HISTORY_WINDOW_LIMIT;
use super::super::request::{apply_cursor_filter, PaginatedEventsResponse};

/// Page size when the caller omits `limit` on the per-session
/// paginated endpoints.
const SESSION_PAGE_DEFAULT_LIMIT: usize = 100;

/// Resolve the caller's `limit` for a per-session page: default 100,
/// clamped to `1..=MAX_AGENT_HISTORY_WINDOW_LIMIT` (400).
pub(super) fn normalize_session_page_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(SESSION_PAGE_DEFAULT_LIMIT)
        .clamp(1, MAX_AGENT_HISTORY_WINDOW_LIMIT)
}

/// Build the response page from the tail of `messages` (ascending).
///
/// `older_remain` signals that the caller knows messages older than
/// `messages` exist but were not loaded (tail-window fetch); it forces
/// `has_more` even when the in-memory list fits in `limit`.
/// `next_cursor` is the `event_id` of the oldest returned message when
/// `has_more`, else `None`.
pub(crate) fn tail_page(
    messages: Vec<SessionEvent>,
    limit: usize,
    older_remain: bool,
) -> PaginatedEventsResponse {
    let has_more = older_remain || messages.len() > limit;
    let skip = messages.len().saturating_sub(limit);
    let events: Vec<SessionEvent> = messages.into_iter().skip(skip).collect();
    let next_cursor = if has_more {
        events.first().map(|m| m.event_id.to_string())
    } else {
        None
    };
    PaginatedEventsResponse {
        events,
        has_more,
        next_cursor,
    }
}

/// Page of up to `limit` messages immediately preceding the `before`
/// cursor (still ascending). Shares [`apply_cursor_filter`] with the
/// aggregated endpoint, so an unknown cursor degrades the same way
/// there: the filter is skipped and the most recent page is returned.
pub(super) fn page_before_cursor(
    messages: Vec<SessionEvent>,
    before: Option<&str>,
    limit: usize,
) -> PaginatedEventsResponse {
    let filtered = apply_cursor_filter(messages, before, None);
    tail_page(filtered, limit, false)
}

/// True when `messages` — a bounded *suffix* of the full history —
/// already provably contains the entire page for a cursor query: every
/// supplied cursor is present, and more than `limit` messages survive
/// the filter (so the page is full and `has_more = true` is correct
/// without seeing older history).
pub(crate) fn cursor_page_available(
    messages: &[SessionEvent],
    before: Option<&str>,
    after: Option<&str>,
    limit: usize,
) -> bool {
    let position_of = |id: &str| messages.iter().position(|m| m.event_id.to_string() == id);
    let lower = match after {
        Some(id) => match position_of(id) {
            Some(pos) => pos + 1,
            None => return false,
        },
        None => 0,
    };
    let upper = match before {
        Some(id) => match position_of(id) {
            Some(pos) => pos,
            None => return false,
        },
        None => messages.len(),
    };
    upper.saturating_sub(lower) > limit
}

#[cfg(test)]
mod tests {
    use aura_os_core::{AgentInstanceId, ChatRole, ProjectId, SessionEventId};
    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    use super::*;

    /// Deterministic message fixture; `n` becomes both the id and the
    /// chronological order (ascending).
    fn message(n: u32) -> SessionEvent {
        SessionEvent {
            event_id: SessionEventId::from_uuid(Uuid::from_u128(u128::from(n) + 1)),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::User,
            content: format!("message {n}"),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: Utc
                .timestamp_opt(1_700_000_000 + i64::from(n), 0)
                .single()
                .unwrap_or_default(),
            in_flight: None,
            from_agent_id: None,
        }
    }

    fn messages(count: u32) -> Vec<SessionEvent> {
        (0..count).map(message).collect()
    }

    fn id_of(n: u32) -> String {
        message(n).event_id.to_string()
    }

    #[test]
    fn normalize_limit_defaults_and_clamps() {
        assert_eq!(normalize_session_page_limit(None), 100);
        assert_eq!(normalize_session_page_limit(Some(0)), 1);
        assert_eq!(normalize_session_page_limit(Some(7)), 7);
        assert_eq!(normalize_session_page_limit(Some(400)), 400);
        assert_eq!(normalize_session_page_limit(Some(100_000)), 400);
    }

    #[test]
    fn tail_page_empty_list() {
        let page = tail_page(Vec::new(), 10, false);
        assert!(page.events.is_empty());
        assert!(!page.has_more);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn tail_page_exact_boundary_has_no_more() {
        // Exactly `limit` messages: everything fits, no older page.
        let page = tail_page(messages(5), 5, false);
        assert_eq!(page.events.len(), 5);
        assert!(!page.has_more);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn tail_page_one_past_boundary_sets_cursor_to_oldest_returned() {
        let page = tail_page(messages(6), 5, false);
        assert_eq!(page.events.len(), 5);
        assert!(page.has_more);
        // Messages 1..=5 returned; oldest returned is message 1.
        assert_eq!(
            page.events.first().map(|m| m.content.clone()),
            Some("message 1".into())
        );
        assert_eq!(page.next_cursor, Some(id_of(1)));
    }

    #[test]
    fn tail_page_older_remain_forces_has_more() {
        // Tail-window fetch knows older raw events exist even though the
        // reconstructed list fits in `limit`.
        let page = tail_page(messages(3), 5, true);
        assert_eq!(page.events.len(), 3);
        assert!(page.has_more);
        assert_eq!(page.next_cursor, Some(id_of(0)));
    }

    #[test]
    fn page_before_cursor_returns_window_immediately_preceding() {
        let page = page_before_cursor(messages(10), Some(&id_of(7)), 3);
        let contents: Vec<&str> = page.events.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["message 4", "message 5", "message 6"]);
        assert!(page.has_more);
        assert_eq!(page.next_cursor, Some(id_of(4)));
    }

    #[test]
    fn page_before_cursor_at_oldest_message_is_empty_terminal_page() {
        let page = page_before_cursor(messages(10), Some(&id_of(0)), 3);
        assert!(page.events.is_empty());
        assert!(!page.has_more);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn page_before_cursor_exact_boundary() {
        // Exactly `limit` messages precede the cursor: page is full but
        // nothing older remains.
        let page = page_before_cursor(messages(10), Some(&id_of(3)), 3);
        let contents: Vec<&str> = page.events.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["message 0", "message 1", "message 2"]);
        assert!(!page.has_more);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn page_before_cursor_unknown_cursor_falls_back_to_latest_page() {
        // Mirrors `apply_cursor_filter`: an unknown cursor skips the
        // filter rather than erroring, so a stale client still gets the
        // most recent page.
        let page = page_before_cursor(messages(10), Some("not-a-real-id"), 3);
        let contents: Vec<&str> = page.events.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["message 7", "message 8", "message 9"]);
        assert!(page.has_more);
        assert_eq!(page.next_cursor, Some(id_of(7)));
    }

    #[test]
    fn cursor_page_available_requires_cursor_presence() {
        let history = messages(10);
        assert!(!cursor_page_available(&history, Some("missing"), None, 2));
        assert!(!cursor_page_available(&history, None, Some("missing"), 2));
    }

    #[test]
    fn cursor_page_available_requires_full_page_plus_margin() {
        let history = messages(10);
        // 7 messages precede message 7: enough for limit 6, not limit 7.
        assert!(cursor_page_available(&history, Some(&id_of(7)), None, 6));
        assert!(!cursor_page_available(&history, Some(&id_of(7)), None, 7));
        // 2 messages follow message 7: enough for limit 1, not limit 2.
        assert!(cursor_page_available(&history, None, Some(&id_of(7)), 1));
        assert!(!cursor_page_available(&history, None, Some(&id_of(7)), 2));
        // Span between cursors: messages 3..=6 → 4 messages.
        assert!(cursor_page_available(
            &history,
            Some(&id_of(7)),
            Some(&id_of(2)),
            3
        ));
        assert!(!cursor_page_available(
            &history,
            Some(&id_of(7)),
            Some(&id_of(2)),
            4
        ));
    }

    #[test]
    fn cursor_page_available_empty_history() {
        assert!(!cursor_page_available(&[], None, None, 0));
        assert!(!cursor_page_available(&[], Some("x"), None, 0));
    }
}
