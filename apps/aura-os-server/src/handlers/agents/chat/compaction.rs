//! Conversation-history compaction and rendering — converts persisted
//! `SessionEvent`s into the flat-text shape the harness expects on a
//! cold start, applies size caps to tool blobs, and assembles the
//! optional project-state snapshot appended to the system prompt.

use std::collections::HashSet;

use aura_os_core::{ChatContentBlock, ChatRole, SessionEvent, Spec, Task};
use aura_os_harness::ConversationMessage;
use tracing::warn;

use crate::state::AppState;

use super::constants::{HISTORY_RECENT_TURNS, TOOL_BLOB_MAX_BYTES, TOOL_BLOB_OLD_MAX_BYTES};

/// Truncate a string to at most `max_bytes` bytes on a UTF-8 char
/// boundary and append a marker noting the original length. A no-op
/// when `s.len() <= max_bytes`.
pub(super) fn truncate_for_history(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... [truncated {} bytes]", &s[..end], s.len())
}

pub fn session_events_to_conversation_history(events: &[SessionEvent]) -> Vec<ConversationMessage> {
    // Defensive: a harness crash can leave `tool_use` blocks in storage with
    // no matching `tool_result`. Feeding those back to the LLM trips
    // Anthropic's "tool_use without matching tool_result" 400 error (seen
    // with agent 1f7dabd9... after a 79h session crashed mid-tool-call).
    // We drop any dangling `tool_use` whose id isn't referenced by a
    // subsequent `tool_result` in the same event stream.
    let referenced_tool_use_ids = collect_referenced_tool_use_ids(events);
    let recent_start = recent_window_start(events);

    events
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            build_conversation_message(i, m, recent_start, &referenced_tool_use_ids)
        })
        .collect()
}

fn build_conversation_message(
    idx: usize,
    event: &SessionEvent,
    recent_start: usize,
    referenced_tool_use_ids: &HashSet<String>,
) -> Option<ConversationMessage> {
    let role = match event.role {
        ChatRole::User => "user",
        ChatRole::Assistant => "assistant",
        _ => return None,
    };

    let max_blob = if idx >= recent_start {
        TOOL_BLOB_MAX_BYTES
    } else {
        TOOL_BLOB_OLD_MAX_BYTES
    };

    // The harness `ConversationMessage` shape is flat text, so we need
    // to render tool_use / tool_result blocks textually for the LLM to
    // see them on cold start. Previously a tool-only assistant turn
    // (empty `content`, populated `content_blocks`) was filtered out
    // here, causing the model to lose all prior tool context after the
    // app was reopened.
    let rendered = render_conversation_text(
        &event.content,
        event.content_blocks.as_deref(),
        referenced_tool_use_ids,
        max_blob,
    );
    if rendered.is_empty() {
        return None;
    }

    Some(ConversationMessage {
        role: role.to_string(),
        content: rendered,
    })
}

/// Compute the index of the first *user* event that belongs to the
/// "recent" window. Events at or after this index keep the full
/// per-blob budget; events before it fall back to the older, tighter
/// cap so long histories don't balloon the cold-start prompt.
fn recent_window_start(events: &[SessionEvent]) -> usize {
    let mut user_turns_from_end = 0usize;
    let mut idx = events.len();
    for (i, evt) in events.iter().enumerate().rev() {
        if matches!(evt.role, ChatRole::User) {
            user_turns_from_end += 1;
            if user_turns_from_end >= HISTORY_RECENT_TURNS {
                idx = i;
                break;
            }
        }
    }
    idx
}

/// Collect the set of `tool_use_id` values referenced by any `tool_result`
/// block across the given event stream. Used to detect dangling `tool_use`
/// blocks left behind by a crashed harness — those must be stripped before
/// sending history back to the LLM.
pub(super) fn collect_referenced_tool_use_ids(events: &[SessionEvent]) -> HashSet<String> {
    let mut set = HashSet::new();
    for evt in events {
        if let Some(blocks) = evt.content_blocks.as_deref() {
            for block in blocks {
                if let ChatContentBlock::ToolResult { tool_use_id, .. } = block {
                    set.insert(tool_use_id.clone());
                }
            }
        }
    }
    set
}

/// Render a message into the flat-text shape the harness expects.
///
/// Preserves the plain-text content when present; additionally serializes any
/// `tool_use` / `tool_result` / `thinking` / `image` blocks as compact
/// annotations so the model retains awareness of prior tool activity when
/// loading history on a cold start. Skips `tool_use` blocks whose id isn't
/// referenced by any `tool_result` in the stream (dangling blocks from a
/// crashed tool-call cycle).
pub(super) fn render_conversation_text(
    text: &str,
    blocks: Option<&[ChatContentBlock]>,
    referenced_tool_use_ids: &HashSet<String>,
    max_blob_bytes: usize,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !text.is_empty() {
        parts.push(text.to_string());
    }

    if let Some(blocks) = blocks {
        for block in blocks {
            render_block_into(block, &mut parts, referenced_tool_use_ids, max_blob_bytes);
        }
    }

    parts.join("\n")
}

fn render_block_into(
    block: &ChatContentBlock,
    parts: &mut Vec<String>,
    referenced_tool_use_ids: &HashSet<String>,
    max_blob_bytes: usize,
) {
    match block {
        ChatContentBlock::Text { text } if !text.is_empty() => {
            // Already captured via the top-level `content` string in
            // most cases, but include when `text` was empty there.
            if parts.iter().any(|p| p == text) {
                return;
            }
            parts.push(text.clone());
        }
        ChatContentBlock::ToolUse { id, name, input } => {
            if !referenced_tool_use_ids.contains(id) {
                warn!(tool_use_id = %id, %name, "skipping dangling tool_use (no matching tool_result)");
                return;
            }
            let input_preview = serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string());
            let input_preview = truncate_for_history(&input_preview, max_blob_bytes);
            parts.push(format!("[tool_use {name} input={input_preview}]"));
        }
        ChatContentBlock::ToolResult {
            content, is_error, ..
        } => {
            let label = if is_error.unwrap_or(false) {
                "tool_error"
            } else {
                "tool_result"
            };
            let content = truncate_for_history(content, max_blob_bytes);
            parts.push(format!("[{label} {content}]"));
        }
        ChatContentBlock::TaskRef { title, .. } => {
            parts.push(format!("[task_ref {title}]"));
        }
        ChatContentBlock::SpecRef { title, .. } => {
            parts.push(format!("[spec_ref {title}]"));
        }
        ChatContentBlock::Image { .. } | ChatContentBlock::Text { .. } => {}
    }
}

pub(super) fn format_project_state_snapshot(specs: &[Spec], tasks: &[Task]) -> Option<String> {
    let mut sections: Vec<String> = Vec::new();

    if !specs.is_empty() {
        sections.push(render_recent_specs(specs));
    }

    if !tasks.is_empty() {
        sections.push(render_recent_tasks(specs, tasks));
    }

    if sections.is_empty() {
        None
    } else {
        Some(format!(
            "Current durable project state from persisted Aura records:\n{}",
            sections.join("\n\n")
        ))
    }
}

fn render_recent_specs(specs: &[Spec]) -> String {
    let mut recent_specs = specs.to_vec();
    recent_specs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    recent_specs.truncate(3);

    let spec_lines: Vec<String> = recent_specs
        .iter()
        .map(|spec| format!("- {}", spec.title))
        .collect();
    format!("Recent specs:\n{}", spec_lines.join("\n"))
}

fn render_recent_tasks(specs: &[Spec], tasks: &[Task]) -> String {
    let mut recent_tasks = tasks.to_vec();
    recent_tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    recent_tasks.truncate(6);

    let spec_titles: std::collections::HashMap<_, _> = specs
        .iter()
        .map(|spec| (spec.spec_id, spec.title.as_str()))
        .collect();

    let task_lines: Vec<String> = recent_tasks
        .iter()
        .map(|task| {
            let status = format!("{:?}", task.status).to_lowercase();
            let spec_suffix = spec_titles
                .get(&task.spec_id)
                .map(|title| format!(" (spec: {title})"))
                .unwrap_or_default();
            format!("- [{status}] {}{}", task.title, spec_suffix)
        })
        .collect();
    format!("Recent tasks:\n{}", task_lines.join("\n"))
}

pub(super) fn append_project_state_to_system_prompt(base: &str, snapshot: Option<&str>) -> String {
    match snapshot {
        Some(snapshot) if !snapshot.trim().is_empty() => {
            let prefix = if base.trim().is_empty() {
                String::new()
            } else {
                format!("{base}\n\n")
            };
            format!(
                "{prefix}Use the following persisted project state as continuity context when continuing this conversation after a restart or model switch:\n{snapshot}"
            )
        }
        _ => base.to_string(),
    }
}

pub(super) async fn load_project_state_snapshot(
    state: &AppState,
    project_id: &str,
    jwt: &str,
) -> Option<String> {
    let storage = state.storage_client.as_ref()?;
    let specs = load_project_specs(storage, project_id, jwt).await;
    let tasks = load_project_tasks(storage, project_id, jwt).await;
    format_project_state_snapshot(&specs, &tasks)
}

async fn load_project_specs(
    storage: &aura_os_storage::StorageClient,
    project_id: &str,
    jwt: &str,
) -> Vec<Spec> {
    match storage.list_specs(project_id, jwt).await {
        Ok(storage_specs) => {
            let mut specs: Vec<Spec> = storage_specs
                .into_iter()
                .filter_map(|spec| Spec::try_from(spec).ok())
                .collect();
            specs.sort_by_key(|spec| spec.order_index);
            specs
        }
        Err(err) => {
            warn!(project_id, error = %err, "failed to load specs for project state snapshot");
            Vec::new()
        }
    }
}

async fn load_project_tasks(
    storage: &aura_os_storage::StorageClient,
    project_id: &str,
    jwt: &str,
) -> Vec<Task> {
    match storage.list_tasks(project_id, jwt).await {
        Ok(storage_tasks) => {
            let mut tasks: Vec<Task> = storage_tasks
                .into_iter()
                .filter_map(|task| Task::try_from(task).ok())
                .collect();
            tasks.sort_by_key(|task| task.order_index);
            tasks
        }
        Err(err) => {
            warn!(project_id, error = %err, "failed to load tasks for project state snapshot");
            Vec::new()
        }
    }
}

/// Reconstruct conversation history in Claude API format from stored
/// `SessionEvent`s. Unlike `session_events_to_conversation_history` (which
/// only keeps text), this preserves tool_use / tool_result content blocks so
/// the agent can resume multi-turn tool conversations after a cold start.
///
/// Dangling `tool_use` blocks (ones whose id has no matching `tool_result`
/// in the event stream — typically left behind by a crashed harness) are
/// stripped here. Feeding them back into context would trigger Anthropic's
/// "tool_use without matching tool_result" 400 error on every subsequent
/// prompt — which is exactly the class of bug that motivated this
/// regression guard.
pub fn session_events_to_agent_history(events: &[SessionEvent]) -> Vec<serde_json::Value> {
    let referenced_tool_use_ids = collect_referenced_tool_use_ids(events);

    let mut messages: Vec<serde_json::Value> = Vec::new();
    let mut pending_tool_results: Vec<serde_json::Value> = Vec::new();

    for evt in events {
        match evt.role {
            ChatRole::User => append_user_event(evt, &mut messages, &mut pending_tool_results),
            ChatRole::Assistant => append_assistant_event(
                evt,
                &mut messages,
                &mut pending_tool_results,
                &referenced_tool_use_ids,
            ),
            _ => {}
        }
    }

    if !pending_tool_results.is_empty() {
        messages.push(serde_json::json!({
            "role": "user",
            "content": pending_tool_results,
        }));
    }

    messages
}

fn append_user_event(
    evt: &SessionEvent,
    messages: &mut Vec<serde_json::Value>,
    pending_tool_results: &mut Vec<serde_json::Value>,
) {
    if !pending_tool_results.is_empty() {
        messages.push(serde_json::json!({
            "role": "user",
            "content": std::mem::take(pending_tool_results),
        }));
    }
    if let Some(ref blocks) = evt.content_blocks {
        let api_blocks: Vec<serde_json::Value> = blocks
            .iter()
            .filter_map(|b| match b {
                ChatContentBlock::Text { text } => {
                    Some(serde_json::json!({ "type": "text", "text": text }))
                }
                ChatContentBlock::Image { media_type, data } => Some(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data,
                    }
                })),
                _ => None,
            })
            .collect();
        if !api_blocks.is_empty() {
            messages.push(serde_json::json!({
                "role": "user",
                "content": api_blocks,
            }));
        }
    } else if !evt.content.is_empty() {
        messages.push(serde_json::json!({
            "role": "user",
            "content": evt.content,
        }));
    }
}

fn append_assistant_event(
    evt: &SessionEvent,
    messages: &mut Vec<serde_json::Value>,
    pending_tool_results: &mut Vec<serde_json::Value>,
    referenced_tool_use_ids: &HashSet<String>,
) {
    if let Some(ref blocks) = evt.content_blocks {
        let api_blocks =
            assistant_blocks_to_api(blocks, pending_tool_results, referenced_tool_use_ids);
        if !api_blocks.is_empty() {
            messages.push(serde_json::json!({
                "role": "assistant",
                "content": api_blocks,
            }));
        }
    } else if !evt.content.is_empty() {
        messages.push(serde_json::json!({
            "role": "assistant",
            "content": evt.content,
        }));
    }
}

fn assistant_blocks_to_api(
    blocks: &[ChatContentBlock],
    pending_tool_results: &mut Vec<serde_json::Value>,
    referenced_tool_use_ids: &HashSet<String>,
) -> Vec<serde_json::Value> {
    let mut api_blocks: Vec<serde_json::Value> = Vec::new();
    for block in blocks {
        match block {
            ChatContentBlock::Text { text } => {
                api_blocks.push(serde_json::json!({
                    "type": "text",
                    "text": text,
                }));
            }
            ChatContentBlock::ToolUse { id, name, input } => {
                if !referenced_tool_use_ids.contains(id) {
                    warn!(
                        tool_use_id = %id,
                        %name,
                        "skipping dangling tool_use (no matching tool_result) from agent history"
                    );
                    continue;
                }
                api_blocks.push(serde_json::json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input,
                }));
            }
            ChatContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                pending_tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": content,
                    "is_error": is_error.unwrap_or(false),
                }));
            }
            _ => {}
        }
    }
    api_blocks
}
