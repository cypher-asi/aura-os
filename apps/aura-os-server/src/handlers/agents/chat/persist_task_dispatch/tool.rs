//! Tool-shaped dispatch arms: `ToolUseStart`, `ToolCallSnapshot`, and
//! `ToolResult`. Owns the `wire_tool_use_id` fallback logic that keeps
//! parallel-tool-call replays from collapsing on Anthropic's
//! "one result per use" invariant.

use serde_json::{json, Value};
use tracing::{debug, warn};

use super::super::persist::ChatPersistCtx;
use super::super::persist_task::{flush_text_segment, persist_event, PersistTaskState};
use super::normalize::{coerce_tool_use_input_with_status, normalize_tool_use_input};

pub(super) async fn handle_tool_use_start(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    id: &str,
    name: &str,
) {
    state.tool_use_count += 1;
    flush_text_segment(state);
    state.last_tool_use_id = id.to_string();
    // Seed the placeholder as an empty object, not `Null`. Anthropic's
    // Messages API rejects any persisted history whose `tool_use.input`
    // is not an object with `messages.N.content.M.tool_use.input: Input
    // should be an object`. Normally a later `tool_call_snapshot` or
    // `tool_result` would normalise the placeholder via
    // `normalize_tool_use_input`, but the cancel-mid-tool-use path
    // (`finalize_if_needed`) and the no-snapshot-no-result corruption
    // path can both round-trip this block to the API verbatim. Defaulting
    // to `{}` makes the placeholder Anthropic-valid up front so the
    // worst-case replay is a tool call with empty arguments rather than
    // a hard 400.
    state.content_blocks.push(json!({
        "type": "tool_use",
        "id": id,
        "name": name,
        "input": json!({}),
    }));
    if persist_event(
        ctx,
        "tool_use_start",
        json!({
            "message_id": &state.message_id,
            "id": id,
            "name": name,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

/// Persist a tool_use snapshot (one event per `input_json_delta` cadence
/// from upstream Anthropic streaming).
///
/// **Streaming skip-path.** `aura-protocol::ToolCallSnapshot` ships the
/// `input_json_delta` accumulator as a `Value::String` whose contents
/// grow byte-by-byte until the closing brace lands. Persisting and
/// mutating shared state for every intermediate snapshot would:
/// (1) bloat the SessionEvent stream with throwaway placeholders, and
/// (2) — pre-fix — spam the error log with false "non-object" warnings.
///
/// When `coerce_tool_use_input_with_status` reports the snapshot is still
/// mid-stream (partial JSON that doesn't parse), we return early without
/// updating `content_blocks` or writing a SessionEvent. The next snapshot
/// — or the final one, which arrives as a real `Value::Object` — lands
/// the canonical state. Live UI consumers are unaffected because they
/// read the harness broadcast directly, not via this persist task.
pub(super) async fn handle_tool_call_snapshot(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    id: &str,
    name: &str,
    input: &Value,
) {
    let coerced = coerce_tool_use_input_with_status(id, name, input);
    if coerced.is_streaming {
        return;
    }
    let sanitized = coerced.value;
    update_or_append_tool_use_input(state, id, name, &sanitized);
    if persist_event(
        ctx,
        "tool_call_snapshot",
        json!({
            "message_id": &state.message_id,
            "id": id,
            "name": name,
            "input": &sanitized,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

fn update_or_append_tool_use_input(
    state: &mut PersistTaskState,
    id: &str,
    name: &str,
    input: &Value,
) {
    if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
        b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
            && b.get("id").and_then(|i| i.as_str()) == Some(id)
    }) {
        block["input"] = input.clone();
    } else {
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": input,
        }));
    }
}

/// Persist a `tool_result` and append the matching block to the in-flight
/// assistant turn.
///
/// `wire_tool_use_id` is the id the harness paired to this result on the wire.
/// We **must** prefer it over `state.last_tool_use_id`: the latter tracks the
/// most recent `tool_use_start`, which is wrong whenever the model emits
/// multiple `tool_use` blocks in a single assistant turn (Anthropic's
/// parallel-tool-call pattern). In that case the harness streams:
///
/// ```text
/// tool_use_start(A) tool_use_start(B) ... tool_use_start(N)
/// tool_result(A) tool_result(B) ... tool_result(N)
/// ```
///
/// and if we tagged every result with `state.last_tool_use_id` they would all
/// inherit id `N`. The persisted assistant turn would carry N duplicate
/// `tool_result` blocks pointing at `N`, and the very next replay through
/// `session_events_to_agent_history` would 400 on Anthropic with
/// `messages.K.content.M: each tool_use must have a single result.
/// Found multiple tool_result blocks with id: <N>`.
///
/// `wire_tool_use_id == None` is the back-compat fallback for older harness
/// builds (or test harnesses) that omit `ToolResultMsg.tool_use_id`. In that
/// case we still use `state.last_tool_use_id` — which is correct for the
/// sequential, one-tool-at-a-time pattern those builds emit — and bail out
/// only if it too is empty (no preceding `tool_use_start`).
/// Inbound `tool_result` payload, bundled into one struct so
/// [`handle_tool_result`] stays within the 5-parameter limit while
/// carrying the optional image attachment alongside the text result.
///
/// `image_base64` + `image_media_type` mirror
/// [`aura_protocol::ToolResultMsg`]'s optional image fields. Both must
/// be present for an image to be persisted; either absent leaves the
/// ordinary string-only path untouched.
pub(super) struct ToolResultInput<'a> {
    /// Wire-supplied `tool_use_id` (preferred over
    /// `state.last_tool_use_id`; see the doc-comment below).
    pub wire_tool_use_id: Option<&'a str>,
    pub name: &'a str,
    pub result: &'a str,
    pub is_error: bool,
    /// Base64 PNG/JPEG screenshot payload. Never logged.
    pub image_base64: Option<&'a str>,
    /// IANA media type for [`Self::image_base64`] (e.g. `"image/png"`).
    pub image_media_type: Option<&'a str>,
}

impl ToolResultInput<'_> {
    /// The `(media_type, base64)` pair when both image fields are set;
    /// `None` for the string-only path.
    fn image(&self) -> Option<(&str, &str)> {
        match (self.image_media_type, self.image_base64) {
            (Some(media_type), Some(data)) if !media_type.is_empty() && !data.is_empty() => {
                Some((media_type, data))
            }
            _ => None,
        }
    }
}

/// Stamp the persisted image sibling fields (`image_media_type` /
/// `image_data`) onto a tool_result JSON object when an image is
/// present. Field names match [`aura_os_core::ChatContentBlock::ToolResult`]
/// so the block round-trips through storage and the in-flight snapshot
/// path.
fn attach_image_fields(target: &mut Value, input: &ToolResultInput<'_>) {
    if let (Some((media_type, data)), Some(obj)) = (input.image(), target.as_object_mut()) {
        obj.insert("image_media_type".to_string(), json!(media_type));
        obj.insert("image_data".to_string(), json!(data));
    }
}

pub(super) async fn handle_tool_result(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    input: ToolResultInput<'_>,
) {
    let tool_use_id = input
        .wire_tool_use_id
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| state.last_tool_use_id.clone());

    if tool_use_id.is_empty() {
        // Neither the wire payload nor any prior tool_use_start gave us
        // an id to pair with. Persisting an id-less tool_result would
        // round-trip as a dangling block that 400s Anthropic on replay
        // (`each tool_use must have a single result`). Drop the row and
        // surface a loud warning so the harness regression is visible.
        warn!(
            session_id = %ctx.session_id,
            project_agent_id = %ctx.project_agent_id,
            tool_name = input.name,
            "tool_result arrived without a tool_use_id and no prior tool_use_start; dropping to avoid corrupting replay"
        );
        return;
    }

    if let Some((media_type, data)) = input.image() {
        // Structured logging only — never the base64 payload itself.
        debug!(
            session_id = %ctx.session_id,
            tool_name = input.name,
            tool_use_id = %tool_use_id,
            image_media_type = media_type,
            image_b64_len = data.len(),
            "persisting image tool-result"
        );
    }

    normalize_tool_use_input(state, &tool_use_id, input.name);

    let mut content_block = json!({
        "type": "tool_result",
        "tool_use_id": &tool_use_id,
        "content": input.result,
        "is_error": input.is_error,
    });
    attach_image_fields(&mut content_block, &input);
    state.content_blocks.push(content_block);

    let mut event_payload = json!({
        "message_id": &state.message_id,
        "tool_use_id": &tool_use_id,
        "name": input.name,
        "result": input.result,
        "is_error": input.is_error,
        "seq": state.seq,
    });
    attach_image_fields(&mut event_payload, &input);
    if persist_event(ctx, "tool_result", event_payload).await {
        state.persisted_events += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with_pending_tool_use(id: &str, name: &str, input: Value) -> PersistTaskState {
        let mut state = PersistTaskState::new();
        state.last_tool_use_id = id.to_string();
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": input,
        }));
        state
    }

    #[tokio::test]
    async fn handle_tool_result_prefers_wire_tool_use_id_for_parallel_calls() {
        // The exact crash signature reported by the long 7-spec generation
        // run: 7 `tool_use_start`s buffered before any `tool_result`, then
        // 7 `tool_result`s stream back in order. Each must be tagged with
        // the id the harness paired it with on the wire, not with
        // `state.last_tool_use_id` (which would point at the final
        // `tool_use_start` and produce 7 duplicate `tool_result` blocks
        // for that one id — the precise input that 400s Anthropic with
        // `each tool_use must have a single result. Found multiple
        // tool_result blocks with id: <N>`).
        let mut state = PersistTaskState::new();
        state.message_id = "msg-parallel".to_string();
        let ids = ["A", "B", "C", "D", "E", "F", "G"];
        for id in ids {
            state.last_tool_use_id = id.to_string();
            state.content_blocks.push(json!({
                "type": "tool_use",
                "id": id,
                "name": "create_spec",
                "input": json!({"title": format!("spec-{id}")}),
            }));
        }
        assert_eq!(
            state.last_tool_use_id, "G",
            "the buggy code would tag every tool_result with 'G'"
        );

        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        for id in ids {
            handle_tool_result(
                &mut state,
                &ctx,
                ToolResultInput {
                    wire_tool_use_id: Some(id),
                    name: "create_spec",
                    result: "spec-id-result",
                    is_error: false,
                    image_base64: None,
                    image_media_type: None,
                },
            )
            .await;
        }

        let tool_result_ids: Vec<&str> = state
            .content_blocks
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
            .map(|b| b.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or(""))
            .collect();
        assert_eq!(
            tool_result_ids,
            vec!["A", "B", "C", "D", "E", "F", "G"],
            "every tool_result must be paired with the wire `tool_use_id`, not state.last_tool_use_id"
        );

        let mut counts = std::collections::HashMap::<&str, usize>::new();
        for id in &tool_result_ids {
            *counts.entry(*id).or_insert(0) += 1;
        }
        for (id, count) in &counts {
            assert_eq!(
                *count, 1,
                "tool_use_id `{id}` must have exactly one tool_result block, not {count}"
            );
        }
    }

    #[tokio::test]
    async fn handle_tool_result_falls_back_to_last_tool_use_id_when_wire_id_missing() {
        // Back-compat: older harness builds (or test harnesses) omit
        // `ToolResultMsg.tool_use_id`. For the sequential one-tool-at-a-time
        // pattern those builds emit, `state.last_tool_use_id` still
        // identifies the right tool, so we keep the fallback path
        // working.
        let mut state = state_with_pending_tool_use("tu_legacy", "read_file", Value::Null);
        state.message_id = "msg-legacy".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_result(
            &mut state,
            &ctx,
            ToolResultInput {
                wire_tool_use_id: None,
                name: "read_file",
                result: "ok",
                is_error: false,
                image_base64: None,
                image_media_type: None,
            },
        )
        .await;

        let last = state.content_blocks.last().expect("tool_result appended");
        assert_eq!(last["type"], "tool_result");
        assert_eq!(last["tool_use_id"], "tu_legacy");
    }

    #[tokio::test]
    async fn handle_tool_result_persists_image_sibling_fields() {
        // A computer-use screenshot result must persist the image as
        // sibling `image_media_type` / `image_data` fields on the
        // tool_result content block so it survives reload, while the
        // string-only `content` stays intact.
        let mut state = state_with_pending_tool_use("tu_shot", "computer", Value::Null);
        state.message_id = "msg-image".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_result(
            &mut state,
            &ctx,
            ToolResultInput {
                wire_tool_use_id: Some("tu_shot"),
                name: "computer",
                result: "screenshot taken",
                is_error: false,
                image_base64: Some("aGVsbG8="),
                image_media_type: Some("image/png"),
            },
        )
        .await;

        let block = state.content_blocks.last().expect("tool_result appended");
        assert_eq!(block["type"], "tool_result");
        assert_eq!(block["content"], "screenshot taken");
        assert_eq!(block["image_media_type"], "image/png");
        assert_eq!(block["image_data"], "aGVsbG8=");
    }

    #[tokio::test]
    async fn handle_tool_result_omits_image_fields_when_absent() {
        // The string-only path must not stamp any image keys onto the
        // persisted block.
        let mut state = state_with_pending_tool_use("tu_plain", "read_file", Value::Null);
        state.message_id = "msg-plain".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_result(
            &mut state,
            &ctx,
            ToolResultInput {
                wire_tool_use_id: Some("tu_plain"),
                name: "read_file",
                result: "ok",
                is_error: false,
                image_base64: None,
                image_media_type: None,
            },
        )
        .await;

        let block = state.content_blocks.last().expect("tool_result appended");
        assert!(
            block.get("image_media_type").is_none(),
            "string-only result must not carry an image_media_type key"
        );
        assert!(
            block.get("image_data").is_none(),
            "string-only result must not carry an image_data key"
        );
    }

    #[tokio::test]
    async fn handle_tool_result_drops_event_when_no_id_available() {
        // Defensive: a wire payload missing `tool_use_id` AND no prior
        // `tool_use_start` (so `state.last_tool_use_id` is empty) gives
        // us nothing to pair the result with. Persisting an empty id
        // would round-trip as a dangling tool_result and 400 Anthropic
        // on the next turn. Drop it and warn instead.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-orphan".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_result(
            &mut state,
            &ctx,
            ToolResultInput {
                wire_tool_use_id: None,
                name: "ghost_tool",
                result: "ok",
                is_error: false,
                image_base64: None,
                image_media_type: None,
            },
        )
        .await;

        assert!(
            state.content_blocks.is_empty(),
            "tool_result with no id must not be appended to the assistant turn"
        );
    }

    #[test]
    fn update_or_append_tool_use_appends_when_id_missing() {
        let mut state = PersistTaskState::new();
        update_or_append_tool_use_input(&mut state, "tu_new", "list_files", &json!({}));
        assert_eq!(state.content_blocks.len(), 1);
        assert_eq!(state.content_blocks[0]["id"], "tu_new");
        assert_eq!(state.content_blocks[0]["input"], json!({}));
    }

    #[test]
    fn update_or_append_tool_use_updates_existing_block() {
        let mut state = state_with_pending_tool_use("tu_1", "create_spec", Value::Null);
        update_or_append_tool_use_input(
            &mut state,
            "tu_1",
            "create_spec",
            &json!({"title": "Phase 06", "markdown_contents": "..."}),
        );
        assert_eq!(state.content_blocks.len(), 1);
        assert_eq!(state.content_blocks[0]["input"]["title"], "Phase 06");
    }

    #[tokio::test]
    async fn handle_tool_call_snapshot_skips_mid_stream_partial_string() {
        // Regression for the live-log spam ("tool_use.input arrived as
        // non-object" ERROR repeated ~10× per tool_use). The harness
        // emits one snapshot per Anthropic input_json_delta event with
        // the accumulator as a Value::String. Persisting + mutating
        // state on every partial snapshot is wasteful and was the
        // source of the ERROR-log flood. We must skip those events; a
        // later snapshot (final Value::Object) lands the canonical state.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-stream".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        for partial in [r#"""#, r#"{"path""#, r#"{"path":"s"#, r#"{"path":"src"#] {
            handle_tool_call_snapshot(
                &mut state,
                &ctx,
                "toolu_streaming",
                "list_files",
                &Value::String(partial.to_string()),
            )
            .await;
        }

        assert!(
            state.content_blocks.is_empty(),
            "mid-stream snapshots must not mutate content_blocks"
        );
        assert_eq!(
            state.persisted_events, 0,
            "mid-stream snapshots must not bump the persisted-events counter"
        );

        handle_tool_call_snapshot(
            &mut state,
            &ctx,
            "toolu_streaming",
            "list_files",
            &json!({"path": "src/lib.rs"}),
        )
        .await;

        assert_eq!(state.content_blocks.len(), 1, "final snapshot must land");
        assert_eq!(
            state.content_blocks[0]["input"],
            json!({"path": "src/lib.rs"})
        );
    }

    #[tokio::test]
    async fn handle_tool_use_start_seeds_empty_object_not_null() {
        // Regression for the cancel-mid-tool-call 400. Pre-fix, the
        // placeholder seeded by `handle_tool_use_start` was
        // `Value::Null`. If the user pressed Stop before the first
        // `tool_call_snapshot` or `tool_result` arrived, that null
        // round-tripped through `assistant_message_end` into storage
        // and the very next replay 400'd Anthropic with
        // `messages.N.content.M.tool_use.input: Input should be an
        // object`. Seeding `{}` keeps the worst-case replay valid.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-seed".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_use_start(&mut state, &ctx, "toolu_seed", "create_spec").await;

        assert_eq!(
            state.content_blocks.len(),
            1,
            "tool_use_start must append exactly one block"
        );
        let block = &state.content_blocks[0];
        assert_eq!(block["type"], "tool_use");
        assert_eq!(block["id"], "toolu_seed");
        assert!(
            block["input"].is_object(),
            "input placeholder must be a JSON object, not Null. Got: {}",
            block["input"]
        );
        assert_eq!(
            block["input"],
            json!({}),
            "input placeholder must be `{{}}` so worst-case replay is valid"
        );
    }

    #[tokio::test]
    async fn handle_tool_call_snapshot_accepts_complete_json_object_string() {
        // The accumulator's final state is the closing brace landing,
        // which makes the string a parseable JSON object. We accept
        // that as the canonical input (not as streaming).
        let mut state = PersistTaskState::new();
        state.message_id = "msg-final".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            user_id: None,
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_call_snapshot(
            &mut state,
            &ctx,
            "toolu_complete",
            "read_file",
            &Value::String(r#"{"path":"src/lib.rs"}"#.to_string()),
        )
        .await;

        assert_eq!(state.content_blocks.len(), 1);
        assert_eq!(
            state.content_blocks[0]["input"],
            json!({"path": "src/lib.rs"})
        );
    }
}
