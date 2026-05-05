//! Shared constants for the chat handler module.

pub(super) const DEFAULT_AGENT_HISTORY_WINDOW_LIMIT: usize = 80;
pub(super) const MAX_AGENT_HISTORY_WINDOW_LIMIT: usize = 400;

/// Maximum bytes of a single `tool_use` input / `tool_result` content
/// blob we embed into the flat-text conversation history replayed to
/// the harness on a cold start. Anything beyond this is replaced with
/// a "... [truncated N bytes]" marker.
///
/// The harness-native `list_agents` tool calls
/// `GET /api/agents?view=slim` (see [`AgentListView`] in
/// `crate::handlers::agents::crud::list` and `AuraServerAgentHook::list_agents`
/// in `../aura-harness/crates/aura-runtime/src/session/cross_agent_hook.rs`)
/// so its tool result stays in the low-kilobyte range. This cap is the
/// defense in depth in case a future caller forgets the slim view —
/// without it, full `Agent` records carrying base64 WebP icons
/// (~15–50 KB each) plus multi-KB `system_prompt` / `personality`
/// fields blew out the context after a single turn.
pub(super) const TOOL_BLOB_MAX_BYTES: usize = 2048;

/// Tighter cap used for tool blobs in turns *outside* the recent
/// window; older tool traffic only needs to leave a breadcrumb of
/// "this happened".
pub(super) const TOOL_BLOB_OLD_MAX_BYTES: usize = 256;

/// How many of the most recent turns keep the full
/// `TOOL_BLOB_MAX_BYTES` budget when replaying history. Turns beyond
/// this fall back to `TOOL_BLOB_OLD_MAX_BYTES`.
pub(super) const HISTORY_RECENT_TURNS: usize = 2;

/// Log-level threshold on the total size of the flat-text
/// `conversation_messages` array shipped to the harness in
/// `SessionConfig`. Anything above this triggers a `warn!` so future
/// context bloat regressions surface without needing user bug reports.
pub(super) const CONVERSATION_HISTORY_WARN_BYTES: usize = 64 * 1024;

/// Minimum time between consecutive `assistant_turn_progress`
/// publishes for a single turn. Tuned to balance UI responsiveness
/// after a refresh against history-API request load — on the order
/// of two refetches per second is enough to feel "live".
pub(super) const ASSISTANT_TURN_PROGRESS_THROTTLE: std::time::Duration =
    std::time::Duration::from_millis(400);

/// Maximum number of per-session `list_events` requests we fan out in a
/// single parallel batch while walking sessions newest-first. Larger
/// batches give more parallelism at the cost of wasted storage traffic
/// when the target window is already filled by the first session or two.
pub(super) const SESSION_FETCH_BATCH: usize = 4;

/// Header names used to surface persistence info alongside the SSE
/// response so fire-and-forget callers (e.g. the CEO's `send_to_agent`
/// tool, which only reads the response head) can tell whether the
/// message will actually be saved and viewable in the target agent's
/// chat history — without having to drain the stream.
pub(crate) const HEADER_CHAT_PERSISTED: &str = "x-aura-chat-persisted";
pub(crate) const HEADER_CHAT_SESSION_ID: &str = "x-aura-chat-session-id";
pub(crate) const HEADER_CHAT_PROJECT_ID: &str = "x-aura-chat-project-id";
