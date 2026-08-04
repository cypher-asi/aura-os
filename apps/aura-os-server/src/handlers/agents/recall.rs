//! Read-only, evidence-backed recall across a user's completed chats.
//!
//! This deliberately does not create a secondary index, call a model, or add
//! recalled text to a live chat.  The caller receives only a short, safe
//! excerpt plus the coordinates needed to open the original session.  Keeping
//! the source as the authority prevents an old or partial message from being
//! silently treated as current-chat context.

use axum::extract::{Query, State};
use axum::Json;
use futures_util::stream;
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::time::Duration;
use tokio::time::{timeout_at, Instant};
use tracing::warn;

use aura_os_core::{
    AgentId, ChatContentBlock, ChatRole, EnrichedSession, SessionEvent, SessionStatus,
};
use aura_os_sessions::storage_enriched_session_to_enriched_session;
use aura_os_storage::StorageSessionEvent;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::agents::chat::is_subagent_session_summary;
use crate::state::{AppState, AuthJwt};

use super::conversions::events_to_session_history;
use super::sessions::storage_session_is_deleted;

/// This cloud-backed MVP performs one authenticated event read per candidate
/// instead of using a storage-side search index. Fifty recent sessions keeps
/// the fan-out useful while the per-read and total deadlines below keep it
/// release-safe on a degraded network. A future storage index can remove this
/// recency/latency tradeoff.
const MAX_SCANNED_SESSIONS: usize = 50;
const DEFAULT_RESULT_LIMIT: usize = 10;
const MAX_RESULT_LIMIT: usize = 20;
const MAX_QUERY_LEN: usize = 160;
const MAX_EVENTS_PER_SESSION: u32 = 120;
const MAX_SEARCHABLE_CONTENT_CHARS: usize = 8_000;
const MAX_SNIPPET_CHARS: usize = 280;
const EVENT_FETCH_CONCURRENCY: usize = 8;
const PER_SESSION_READ_TIMEOUT: Duration = Duration::from_secs(4);
const OVERALL_SEARCH_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Deserialize)]
pub(crate) struct RecallSearchQuery {
    /// The lexical query is deliberately query-string based: this endpoint is
    /// strictly read-only and does not accept source content from the client.
    pub q: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecallSearchResponse {
    pub results: Vec<RecallSearchResult>,
    /// Lets the UI be honest about this no-index MVP without exposing any
    /// session ids or content that did not match the caller's query.
    pub scanned_sessions: usize,
    /// Candidate histories that failed, timed out, or were not processed
    /// before the overall deadline. The UI surfaces this so a partial search
    /// is never presented as complete.
    pub skipped_sessions: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecallSearchResult {
    pub event_id: String,
    pub session_id: String,
    pub project_id: String,
    pub agent_instance_id: String,
    /// Required for source navigation. Orphaned sessions are excluded rather
    /// than risking navigation under a different agent's identity.
    pub agent_id: String,
    pub occurred_at: chrono::DateTime<chrono::Utc>,
    pub role: ChatRole,
    /// A bounded, plain-text excerpt. It never includes attachment payloads
    /// or events that look like credentials.
    pub snippet: String,
}

struct ScoredRecallResult {
    result: RecallSearchResult,
    score: usize,
}

enum CandidateSearchOutcome {
    Searched(Option<ScoredRecallResult>),
    Skipped,
}

struct CandidateSearchCounts {
    searched: usize,
    skipped: usize,
}

/// `GET /api/me/sessions/search?q=<terms>&limit=<n>`
///
/// The storage client derives the session list from the caller's JWT. We use
/// only that list as the candidate set, then use the same JWT for each event
/// read. This avoids accepting agent/project/session ids from the browser and
/// prevents cross-user probing by construction.
pub(crate) async fn search_my_session_history(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<RecallSearchQuery>,
) -> ApiResult<Json<RecallSearchResponse>> {
    let search_deadline = Instant::now() + OVERALL_SEARCH_TIMEOUT;
    let terms = normalize_query(&query.q)?;
    let limit = query
        .limit
        .unwrap_or(DEFAULT_RESULT_LIMIT)
        .clamp(1, MAX_RESULT_LIMIT);
    let storage = state.require_storage_client()?;

    let candidates: Vec<EnrichedSession> =
        timeout_at(search_deadline, storage.list_my_sessions(&jwt))
            .await
            .map_err(|_| ApiError::service_unavailable("Recall session listing timed out"))?
            .map_err(map_storage_error)?
            .into_iter()
            .filter(|entry| !storage_session_is_deleted(&entry.session))
            .filter_map(|entry| storage_enriched_session_to_enriched_session(entry, None).ok())
            .filter(|entry| entry.session.status == SessionStatus::Completed)
            .filter(|entry| entry.agent_id.is_some())
            .filter(|entry| {
                !is_subagent_session_summary(&entry.session.summary_of_previous_context)
            })
            .take(MAX_SCANNED_SESSIONS)
            .collect();
    let scanned_sessions = candidates.len();

    let candidate_outcomes = stream::iter(candidates)
        .map(|candidate| {
            let jwt = jwt.clone();
            let terms = terms.clone();
            async move {
                let session_id = candidate.session.session_id.to_string();
                let events = match await_with_timeout(
                    PER_SESSION_READ_TIMEOUT,
                    storage
                        // This is intentionally a bounded first page. Until
                        // Aura has a storage-side full-text index, a recall
                        // request must not page through an entire long-lived
                        // transcript.
                        .list_events(&session_id, &jwt, Some(MAX_EVENTS_PER_SESSION), None),
                )
                .await
                {
                    Ok(Ok(events)) => events,
                    Ok(Err(error)) => {
                        // A completed session may be deleted between the
                        // JWT-scoped list and event reads. Other per-session
                        // transport failures should not erase safe matches
                        // from unrelated sessions either. Never retry with an
                        // internal token or broader credentials.
                        warn!(%session_id, %error, "Recall skipped an unreadable session");
                        return CandidateSearchOutcome::Skipped;
                    }
                    Err(_) => {
                        warn!(%session_id, "Recall timed out reading a session");
                        return CandidateSearchOutcome::Skipped;
                    }
                };
                CandidateSearchOutcome::Searched(score_session(
                    &candidate,
                    &events_to_session_history(
                        &recall_conversation_events(&events),
                        &candidate.session.agent_instance_id.to_string(),
                        &candidate.session.project_id.to_string(),
                    ),
                    &terms,
                ))
            }
        })
        .buffer_unordered(EVENT_FETCH_CONCURRENCY);
    let outcomes = collect_candidate_outcomes_until(candidate_outcomes, search_deadline).await;
    let counts = candidate_search_counts(scanned_sessions, &outcomes);
    if all_candidate_reads_failed(scanned_sessions, counts.searched) {
        return Err(ApiError::service_unavailable(
            "Recall could not read any completed chat histories",
        ));
    }
    let mut scored: Vec<ScoredRecallResult> = outcomes
        .into_iter()
        .filter_map(|outcome| match outcome {
            CandidateSearchOutcome::Searched(result) => result,
            CandidateSearchOutcome::Skipped => None,
        })
        .collect();

    scored.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.result.occurred_at.cmp(&left.result.occurred_at))
    });
    let results = scored
        .into_iter()
        .take(limit)
        .map(|entry| entry.result)
        .collect();

    Ok(Json(RecallSearchResponse {
        results,
        scanned_sessions,
        skipped_sessions: counts.skipped,
    }))
}

async fn await_with_timeout<F>(
    duration: Duration,
    future: F,
) -> Result<F::Output, tokio::time::error::Elapsed>
where
    F: Future,
{
    tokio::time::timeout(duration, future).await
}

async fn collect_candidate_outcomes_until<S>(
    outcomes: S,
    deadline: Instant,
) -> Vec<CandidateSearchOutcome>
where
    S: Stream<Item = CandidateSearchOutcome>,
{
    futures_util::pin_mut!(outcomes);
    let mut completed = Vec::new();
    loop {
        match timeout_at(deadline, outcomes.next()).await {
            Ok(Some(outcome)) => completed.push(outcome),
            Ok(None) | Err(_) => break,
        }
    }
    completed
}

fn candidate_search_counts(
    candidate_count: usize,
    outcomes: &[CandidateSearchOutcome],
) -> CandidateSearchCounts {
    let searched = outcomes
        .iter()
        .filter(|outcome| matches!(outcome, CandidateSearchOutcome::Searched(_)))
        .count();
    let explicitly_skipped = outcomes.len().saturating_sub(searched);
    let unprocessed = candidate_count.saturating_sub(outcomes.len());
    CandidateSearchCounts {
        searched,
        skipped: explicitly_skipped + unprocessed,
    }
}

fn all_candidate_reads_failed(candidate_count: usize, successful_reads: usize) -> bool {
    candidate_count > 0 && successful_reads == 0
}

/// Preserve raw event provenance before the normal conversion path projects
/// task output as an assistant display row. Only user messages and terminal
/// assistant text (plus the text deltas required to reconstruct an older
/// terminal assistant turn) may become Recall candidates.
fn recall_conversation_events(events: &[StorageSessionEvent]) -> Vec<StorageSessionEvent> {
    events
        .iter()
        .filter(|event| {
            matches!(
                event.event_type.as_deref(),
                Some("user_message" | "assistant_message_end" | "text_delta")
            )
        })
        .cloned()
        .collect()
}

fn normalize_query(raw: &str) -> ApiResult<Vec<String>> {
    let trimmed = raw.trim();
    if trimmed.len() < 2 {
        return Err(ApiError::bad_request(
            "recall query must be at least 2 characters",
        ));
    }
    if trimmed.len() > MAX_QUERY_LEN {
        return Err(ApiError::bad_request("recall query is too long"));
    }

    let mut terms = Vec::new();
    for term in trimmed.split_whitespace().map(|term| term.to_lowercase()) {
        if !terms.contains(&term) {
            terms.push(term);
        }
    }
    if terms.is_empty() {
        return Err(ApiError::bad_request(
            "recall query must contain a search term",
        ));
    }
    Ok(terms)
}

fn score_session(
    session: &EnrichedSession,
    events: &[SessionEvent],
    terms: &[String],
) -> Option<ScoredRecallResult> {
    events
        .iter()
        // Tool output often includes opaque payloads and files. Recall is a
        // conversation aid, so only human/assistant messages are candidates.
        .filter(|event| matches!(event.role, ChatRole::User | ChatRole::Assistant))
        // Image blocks can contain base64 attachment data or a user-provided
        // image. Attachments remain out of Recall until there is an explicit,
        // separately-reviewed attachment policy.
        .filter(|event| !event_has_attachment(event))
        .filter(|event| !looks_sensitive(&event.content))
        .filter_map(|event| score_event(event, terms))
        .max_by(|left, right| {
            left.score
                .cmp(&right.score)
                .then_with(|| left.event.created_at.cmp(&right.event.created_at))
        })
        .map(|match_result| ScoredRecallResult {
            score: match_result.score,
            result: RecallSearchResult {
                session_id: session.session.session_id.to_string(),
                event_id: match_result.event.event_id.to_string(),
                project_id: session.session.project_id.to_string(),
                agent_instance_id: session.session.agent_instance_id.to_string(),
                agent_id: session
                    .agent_id
                    .as_ref()
                    .map(AgentId::to_string)
                    .expect("Recall candidates are filtered to a navigable agent id"),
                occurred_at: match_result.event.created_at,
                role: match_result.event.role,
                snippet: match_result.snippet,
            },
        })
}

struct EventMatch<'a> {
    event: &'a SessionEvent,
    score: usize,
    snippet: String,
}

fn score_event<'a>(event: &'a SessionEvent, terms: &[String]) -> Option<EventMatch<'a>> {
    // Bound the raw scan, normalize visible whitespace once, then lowercase.
    // Search and snippet generation therefore operate on the same bounded
    // human-visible text, never on raw storage JSON.
    let flattened = bounded_visible_text(&event.content);
    let searchable = flattened.to_lowercase();
    let mut score = 0;
    let mut first_match_char_offset = usize::MAX;
    for term in terms {
        let mut matches = searchable.match_indices(term);
        let Some((first_match_byte_offset, _)) = matches.next() else {
            // All terms must be present. This keeps lexical results precise
            // and avoids a model deciding that merely-related text matches.
            return None;
        };
        score += 1 + matches.count();
        first_match_char_offset =
            first_match_char_offset.min(searchable[..first_match_byte_offset].chars().count());
    }
    Some(EventMatch {
        event,
        score,
        snippet: bounded_snippet(&flattened, first_match_char_offset),
    })
}

fn bounded_visible_text(content: &str) -> String {
    let mut flattened = String::with_capacity(MAX_SEARCHABLE_CONTENT_CHARS);
    let mut pending_space = false;

    // Bound the raw scan itself. Normalizing an unbounded run of whitespace
    // before truncating would still let a pathological event consume
    // unbounded CPU even though it could not contribute a result.
    for character in content.chars().take(MAX_SEARCHABLE_CONTENT_CHARS) {
        if character.is_whitespace() {
            pending_space = !flattened.is_empty();
            continue;
        }

        if pending_space {
            flattened.push(' ');
            pending_space = false;
        }
        flattened.push(character);
    }

    flattened
}

fn event_has_attachment(event: &SessionEvent) -> bool {
    event.content_blocks.as_ref().is_some_and(|blocks| {
        blocks
            .iter()
            .any(|block| matches!(block, ChatContentBlock::Image { .. }))
    })
}

/// Conservative redaction guard. It does not attempt to classify every
/// private sentence; it skips the common credential-bearing forms entirely
/// before a snippet can be constructed or returned to the browser.
fn looks_sensitive(content: &str) -> bool {
    // Recall cannot match or return text beyond this same bound. Apply it
    // before allocating the lowercase copy so a pathological multi-megabyte
    // event cannot turn the credential guard into an unbounded scan.
    let lower = bounded_visible_text(content).to_lowercase();
    [
        "api_key",
        "api-key",
        "api key",
        "password",
        "secret",
        "access_token",
        "access-token",
    ]
    .iter()
    .any(|label| contains_assigned_value(&lower, label))
        || lower.contains("authorization: bearer ")
        || lower.contains("bearer ") && lower.split_whitespace().any(|word| word.len() > 24)
        || contains_credential_prefix(&lower, "sk-", 20)
        || contains_credential_prefix(&lower, "sk_live_", 20)
        || contains_credential_prefix(&lower, "ghp_", 20)
        || contains_credential_prefix(&lower, "github_pat_", 20)
        || contains_credential_prefix(&lower, "akia", 20)
        || lower.contains("-----begin private key-----")
        || lower.contains("-----begin rsa private key-----")
}

fn contains_credential_prefix(content: &str, prefix: &str, minimum_length: usize) -> bool {
    content.match_indices(prefix).any(|(start, _)| {
        content[start..]
            .chars()
            .take_while(|character| {
                character.is_ascii_alphanumeric() || *character == '_' || *character == '-'
            })
            .count()
            >= minimum_length
    })
}

fn contains_assigned_value(content: &str, label: &str) -> bool {
    content.find(label).is_some_and(|start| {
        let suffix = &content[start + label.len()..];
        let value = suffix.trim_start_matches(|character: char| {
            character.is_whitespace()
                || character == ':'
                || character == '='
                || character == '"'
                || character == '\''
        });
        value
            .split_whitespace()
            .next()
            .is_some_and(|word| word.len() >= 8)
    })
}

fn bounded_snippet(flattened: &str, match_char_offset: usize) -> String {
    let total_chars = flattened.chars().count();
    if total_chars <= MAX_SNIPPET_CHARS {
        return flattened.to_owned();
    }

    // Reserve room for both possible ellipses. Keeping roughly one third of
    // the window before the first match makes the evidence easy to scan while
    // guaranteeing that a late match is not replaced by the message prefix.
    let window_chars = MAX_SNIPPET_CHARS.saturating_sub(2);
    let desired_start = match_char_offset.saturating_sub(MAX_SNIPPET_CHARS / 3);
    let start = desired_start.min(total_chars.saturating_sub(window_chars));
    let end = (start + window_chars).min(total_chars);
    let window: String = flattened.chars().skip(start).take(end - start).collect();

    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        window,
        if end < total_chars { "…" } else { "" },
    )
}

#[cfg(test)]
#[path = "recall_tests.rs"]
mod tests;
