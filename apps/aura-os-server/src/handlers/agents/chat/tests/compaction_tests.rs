//! Tests for `session_events_to_conversation_history`,
//! `truncate_for_history`, and `render_conversation_text`.

use aura_os_core::{
    parse_dt, AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent, SessionEventId,
};

use super::super::compaction::{
    render_conversation_text, session_events_to_agent_history,
    session_events_to_conversation_history, truncate_for_history,
};

fn assistant_event(content: &str, blocks: Option<Vec<ChatContentBlock>>) -> SessionEvent {
    SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::Assistant,
        content: content.to_string(),
        content_blocks: blocks,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    }
}

#[test]
fn conversation_history_renders_tool_only_assistant_turn_to_text() {
    // Regression: on app reopen, a tool-only assistant turn (empty
    // `content`, populated `content_blocks`) used to be filtered out of
    // the harness conversation history, so the model lost all memory of
    // prior tool calls.
    let user = SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: "make a spec".into(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    };
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "tool-1".into(),
                name: "create_spec".into(),
                input: serde_json::json!({ "title": "hello" }),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "tool-1".into(),
                content: "spec-123".into(),
                is_error: Some(false),
            },
        ]),
    );

    let history = session_events_to_conversation_history(&[user, assistant]);

    assert_eq!(history.len(), 2);
    assert_eq!(history[0].role, "user");
    assert_eq!(history[1].role, "assistant");
    assert!(
        history[1].content.contains("tool_use create_spec"),
        "assistant turn must carry tool call into LLM context, got: {}",
        history[1].content
    );
    assert!(
        history[1].content.contains("tool_result spec-123"),
        "assistant turn must carry tool result into LLM context, got: {}",
        history[1].content
    );
}

#[test]
fn conversation_history_preserves_text_plus_tool_turns() {
    // Healthy cycle: assistant emits narration + tool_use, tool result
    // arrives in a subsequent event. Both narration and tool call must
    // survive. (A dangling tool_use with no matching tool_result is
    // stripped as a crash signature — see the
    // `conversation_history_strips_dangling_tool_use_block` integration
    // test in tests/chat_events_test.rs.)
    let assistant = assistant_event(
        "Sure, creating now.",
        Some(vec![ChatContentBlock::ToolUse {
            id: "tool-1".into(),
            name: "create_spec".into(),
            input: serde_json::json!({ "title": "hello" }),
        }]),
    );
    let tool_result = assistant_event(
        "",
        Some(vec![ChatContentBlock::ToolResult {
            tool_use_id: "tool-1".into(),
            content: "spec-123".into(),
            is_error: Some(false),
        }]),
    );

    let history = session_events_to_conversation_history(&[assistant, tool_result]);
    assert!(
        history
            .iter()
            .any(|m| m.content.starts_with("Sure, creating now.")
                && m.content.contains("tool_use create_spec")),
        "narration and tool_use must both survive, got: {history:?}"
    );
}

#[test]
fn conversation_history_drops_fully_empty_assistant_turns() {
    let empty = assistant_event("", None);
    let history = session_events_to_conversation_history(&[empty]);
    assert!(history.is_empty());
}

#[test]
fn truncate_for_history_is_noop_below_cap() {
    let s = "hello world";
    assert_eq!(truncate_for_history(s, 2048), s);
}

#[test]
fn truncate_for_history_keeps_prefix_and_marker() {
    let big = "X".repeat(10_000);
    let truncated = truncate_for_history(&big, 128);
    assert!(truncated.len() < 512);
    assert!(truncated.starts_with("XXXX"));
    assert!(truncated.contains("[truncated 10000 bytes]"));
}

#[test]
fn truncate_for_history_respects_char_boundary() {
    // A 4-byte UTF-8 char right at the cap must not split.
    let s = format!("abc{}", "🦀".repeat(10));
    let truncated = truncate_for_history(&s, 5);
    assert!(truncated.starts_with("abc"));
    assert!(truncated.contains("[truncated"));
}

#[test]
fn render_conversation_text_truncates_oversized_tool_result() {
    let big = "Z".repeat(10_000);
    let blocks = vec![
        ChatContentBlock::ToolUse {
            id: "tool-1".into(),
            name: "list_agents".into(),
            input: serde_json::json!({}),
        },
        ChatContentBlock::ToolResult {
            tool_use_id: "tool-1".into(),
            content: big.clone(),
            is_error: Some(false),
        },
    ];
    let referenced: std::collections::HashSet<String> =
        std::iter::once("tool-1".to_string()).collect();
    let rendered = render_conversation_text("", Some(&blocks), &referenced, 512);
    assert!(
        rendered.len() < 2_000,
        "rendered still large: {}",
        rendered.len()
    );
    assert!(rendered.contains("[truncated 10000 bytes]"));
    assert!(!rendered.contains(&big));
}

#[test]
fn conversation_history_uses_tight_cap_for_old_tool_results() {
    // Ten assistant tool-result turns followed by two user turns so
    // the first assistant turn sits well outside the recent window.
    let big_old = "OLD".repeat(4_000); // 12_000 bytes
    let big_recent = "NEW".repeat(4_000);

    let old_assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "tool-old".into(),
                name: "list_agents".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "tool-old".into(),
                content: big_old.clone(),
                is_error: Some(false),
            },
        ]),
    );
    let user_a = SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: "first turn".into(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    };
    let recent_assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "tool-new".into(),
                name: "list_agents".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "tool-new".into(),
                content: big_recent.clone(),
                is_error: Some(false),
            },
        ]),
    );
    let user_b = SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: "second turn".into(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    };

    let history =
        session_events_to_conversation_history(&[old_assistant, user_a, recent_assistant, user_b]);

    // Old turn: capped at TOOL_BLOB_OLD_MAX_BYTES (256).
    let old_rendered = &history[0].content;
    assert!(
        old_rendered.len() < 1_000,
        "old assistant turn should be tightly capped, got {} bytes",
        old_rendered.len()
    );
    assert!(old_rendered.contains("[truncated 12000 bytes]"));

    // Recent turn: capped at TOOL_BLOB_MAX_BYTES (2048), so bigger
    // than old but still well under the raw 12KB.
    let recent_rendered = &history[2].content;
    assert!(
        recent_rendered.len() > old_rendered.len(),
        "recent window must keep more context than old window"
    );
    assert!(recent_rendered.contains("[truncated 12000 bytes]"));
    assert!(recent_rendered.len() < 4_000);
}

fn user_event(content: &str) -> SessionEvent {
    SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: content.to_string(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    }
}

/// Locate the most recent user message whose content is a JSON array of
/// blocks (i.e. the synthesized tool-result message) and return that array.
fn extract_tool_result_blocks(history: &[serde_json::Value]) -> Vec<serde_json::Value> {
    history
        .iter()
        .rev()
        .find_map(|msg| {
            if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
                return None;
            }
            msg.get("content")
                .and_then(|c| c.as_array())
                .filter(|arr| {
                    arr.iter()
                        .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
                })
                .cloned()
        })
        .unwrap_or_default()
}

#[test]
fn agent_history_dedupes_duplicate_tool_results_by_tool_use_id() {
    // Regression for the long 7-spec generation 400: a historically
    // persisted assistant turn carried 7 `tool_result` blocks that all
    // shared a single `tool_use_id` (the bug in `handle_tool_result`
    // tagged every parallel result with `state.last_tool_use_id`).
    // Replaying that turn through `session_events_to_agent_history`
    // used to emit a single user message with 7 duplicate tool_result
    // blocks, which Anthropic rejects with:
    //   `messages.K.content.M: each tool_use must have a single
    //    result. Found multiple tool_result blocks with id: <toolu_…>`.
    // The dedupe pass collapses them to one entry per id so historical
    // sessions remain loadable.
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_dup".into(),
                name: "create_spec".into(),
                input: serde_json::json!({"title": "spec-1"}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_dup".into(),
                content: "spec-1-result".into(),
                is_error: Some(false),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_dup".into(),
                content: "spec-2-result".into(),
                is_error: Some(false),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_dup".into(),
                content: "spec-3-result".into(),
                is_error: Some(false),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("generate 3 specs"), assistant]);

    let tool_results = extract_tool_result_blocks(&history);
    let dup_count = tool_results
        .iter()
        .filter(|b| b.get("tool_use_id").and_then(|v| v.as_str()) == Some("toolu_dup"))
        .count();
    assert_eq!(
        dup_count, 1,
        "exactly one tool_result block must survive per tool_use_id; the rest are dropped to keep Anthropic from 400ing on `each tool_use must have a single result`"
    );

    // Last-write-wins keeps the most recent body, mirroring what a
    // retry would mean. We assert this only loosely so the
    // ordering rules in the helper can evolve without forcing churn
    // on every test.
    let surviving = tool_results
        .iter()
        .find(|b| b.get("tool_use_id").and_then(|v| v.as_str()) == Some("toolu_dup"))
        .expect("dup id must survive once");
    let body = surviving
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        body.contains("spec-3-result"),
        "last-write-wins: most recent result body must be kept, got {body}"
    );
}

#[test]
fn agent_history_preserves_distinct_tool_use_ids_in_order() {
    // Sibling test to the dedupe regression: when every tool_result
    // already has a distinct `tool_use_id` (the post-fix happy path),
    // the dedupe pass must leave them all intact and preserve the
    // order the harness reported them in.
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "A".into(),
                name: "create_spec".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolUse {
                id: "B".into(),
                name: "create_spec".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolUse {
                id: "C".into(),
                name: "create_spec".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "A".into(),
                content: "a-result".into(),
                is_error: Some(false),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "B".into(),
                content: "b-result".into(),
                is_error: Some(false),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "C".into(),
                content: "c-result".into(),
                is_error: Some(false),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("go"), assistant]);
    let tool_results = extract_tool_result_blocks(&history);

    let ids: Vec<&str> = tool_results
        .iter()
        .map(|b| b.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or(""))
        .collect();
    assert_eq!(ids, vec!["A", "B", "C"]);
}

/// Anthropic Messages API invariant checker: panics if the constructed
/// history would 400 with `each tool_use must have a single result. Found
/// multiple tool_result blocks with id: …`.
///
/// We check the two conditions that produce that exact error class:
///
/// 1. No user message may contain two `tool_result` blocks sharing a
///    `tool_use_id`. (This is the literal 400 message.)
/// 2. Every `tool_result.tool_use_id` must reference a `tool_use.id` that
///    appears earlier in the same conversation. A `tool_result` with no
///    matching `tool_use` 400s with a different — but equally fatal —
///    `tool_result block(s) provided when previous message does not contain
///    any tool_use blocks` error.
///
/// The checker walks every assistant message to build the set of valid
/// `tool_use` ids, then verifies every `tool_result` it sees against
/// both rules.
fn assert_anthropic_messages_valid(history: &[serde_json::Value]) {
    use std::collections::HashSet;

    let mut known_tool_use_ids: HashSet<String> = HashSet::new();

    for (msg_idx, msg) in history.iter().enumerate() {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or_default();
        let content = match msg.get("content") {
            Some(c) => c,
            None => panic!("message {msg_idx} has no `content` field"),
        };

        let blocks: Vec<&serde_json::Value> = match content {
            serde_json::Value::Array(arr) => arr.iter().collect(),
            serde_json::Value::String(_) => continue,
            other => panic!("message {msg_idx} has non-string/non-array content: {other}"),
        };

        if role == "assistant" {
            for block in &blocks {
                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                    if let Some(id) = block.get("id").and_then(|v| v.as_str()) {
                        known_tool_use_ids.insert(id.to_string());
                    }
                }
            }
        }

        if role == "user" {
            let mut seen_tool_result_ids: HashSet<String> = HashSet::new();
            for (block_idx, block) in blocks.iter().enumerate() {
                if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                    continue;
                }
                let id = block
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                assert!(
                    !id.is_empty(),
                    "messages.{msg_idx}.content.{block_idx}: tool_result missing tool_use_id"
                );
                assert!(
                    seen_tool_result_ids.insert(id.clone()),
                    "messages.{msg_idx}.content.{block_idx}: duplicate tool_result for tool_use_id `{id}` — Anthropic 400 `each tool_use must have a single result`"
                );
                assert!(
                    known_tool_use_ids.contains(&id),
                    "messages.{msg_idx}.content.{block_idx}: tool_result references tool_use_id `{id}` that has no matching tool_use earlier in the conversation"
                );
            }
        }
    }
}

#[test]
fn assert_anthropic_messages_valid_catches_the_known_400() {
    // Pin the validator itself: a payload with two `tool_result` blocks
    // sharing a `tool_use_id` is exactly the input that Anthropic 400s
    // on, and our checker must flag it. Without this we couldn't trust
    // the multi-turn recovery test below to actually exercise the bug.
    let bad = vec![
        serde_json::json!({"role": "user", "content": "go"}),
        serde_json::json!({
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": "X", "name": "do_thing", "input": {}},
            ],
        }),
        serde_json::json!({
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "X", "content": "first"},
                {"type": "tool_result", "tool_use_id": "X", "content": "second"},
            ],
        }),
    ];

    let result = std::panic::catch_unwind(|| assert_anthropic_messages_valid(&bad));
    assert!(
        result.is_err(),
        "validator must reject duplicate tool_result blocks for the same tool_use_id"
    );
}

#[test]
fn corrupted_session_recovers_across_subsequent_user_sends() {
    // End-to-end recovery test mirroring the screenshot:
    //   * Turn 1 produced a corrupted `assistant_message_end` whose
    //     `content_blocks` carry 7 `tool_use` blocks (A..G) and 7
    //     `tool_result` blocks ALL tagged with id `G` — the exact
    //     output of the pre-fix `handle_tool_result` bug when a
    //     parallel-tool-call turn streamed `tool_use_start(A..G)`
    //     before any results.
    //   * The user then sends three follow-up messages ("what is
    //     context?", "test", "test"), and each turn loads the entire
    //     transcript to date through `session_events_to_agent_history`.
    //
    // Pre-fix the duplicated `tool_result(G)` blocks survived into
    // every replay payload, so every subsequent send 400'd with
    // `each tool_use must have a single result. Found multiple
    // tool_result blocks with id: <G>` — the screenshot's failure
    // loop. Post-fix `dedupe_tool_results_by_id` collapses them to a
    // single entry per id and every replay must validate cleanly.
    let parallel_ids = ["A", "B", "C", "D", "E", "F", "G"];
    let last_id = *parallel_ids.last().expect("non-empty");

    let mut corrupted_blocks: Vec<ChatContentBlock> = parallel_ids
        .iter()
        .map(|id| ChatContentBlock::ToolUse {
            id: (*id).to_string(),
            name: "create_spec".into(),
            input: serde_json::json!({"title": format!("spec-{id}")}),
        })
        .collect();
    for id in parallel_ids {
        corrupted_blocks.push(ChatContentBlock::ToolResult {
            tool_use_id: last_id.to_string(),
            content: format!("result-for-{id}-mislabeled-as-{last_id}"),
            is_error: Some(false),
        });
    }
    let corrupted_assistant = assistant_event("", Some(corrupted_blocks));

    let mut events = vec![user_event("generate 7 specs"), corrupted_assistant];
    let follow_ups = ["what is context?", "test", "test"];

    for (turn, prompt) in follow_ups.iter().enumerate() {
        events.push(user_event(prompt));

        let history = session_events_to_agent_history(&events);

        assert_anthropic_messages_valid(&history);

        let synthesized_tool_results = extract_tool_result_blocks(&history);
        let dup_count = synthesized_tool_results
            .iter()
            .filter(|b| b.get("tool_use_id").and_then(|v| v.as_str()) == Some(last_id))
            .count();
        assert_eq!(
            dup_count, 1,
            "turn {turn} (prompt {prompt:?}): exactly one tool_result must survive per tool_use_id; the dedupe must run on every subsequent replay, not just the first one"
        );

        let last_msg = history.last().expect("history is non-empty");
        assert_eq!(
            last_msg.get("role").and_then(|v| v.as_str()),
            Some("user"),
            "turn {turn}: the trailing message must be the user's new prompt"
        );
        assert_eq!(
            last_msg.get("content").and_then(|v| v.as_str()),
            Some(*prompt),
            "turn {turn}: the trailing user message must carry the new prompt verbatim"
        );
    }
}

#[test]
fn dedupe_collapses_duplicate_tool_results_for_same_tool_use_id_from_live_trace() {
    // Live-trace regression for the dev-loop Anthropic 400 documented in
    // the F1 fix:
    //   `messages.K.content.M: each tool_use must have a single result.
    //    Found multiple tool_result blocks with id:
    //    toolu_01KgtvbuPxnZjYs9HFbjwQRi`
    //
    // The shape we observed at `00:26:54` of the 107-task run:
    //   1. assistant emits a `submit_plan` tool_use, paired with its
    //      own tool_result (sequential, healthy).
    //   2. assistant then emits an `edit_file` tool_use with id
    //      `toolu_01KgtvbuPxnZjYs9HFbjwQRi`.
    //   3. the harness persists TWO `tool_result` blocks for that id:
    //      the edit_file's own result PLUS a duplicate emitted by the
    //      auto-build verification path (the same id is reused because
    //      auto-build piggy-backs on the triggering tool's id).
    //
    // Replaying that turn through `session_events_to_agent_history`
    // used to forward both tool_result blocks unchanged, producing
    // the 400 above on the next prompt. The dedupe pass inside
    // `session_events_to_agent_history` must now collapse them to
    // exactly one entry (last-write-wins) so the loop survives.
    const LIVE_TRACE_TOOL_USE_ID: &str = "toolu_01KgtvbuPxnZjYs9HFbjwQRi";

    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_plan_001".into(),
                name: "submit_plan".into(),
                input: serde_json::json!({"summary": "edit src/lib.rs"}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_plan_001".into(),
                content: "plan accepted".into(),
                is_error: Some(false),
            },
            ChatContentBlock::ToolUse {
                id: LIVE_TRACE_TOOL_USE_ID.into(),
                name: "edit_file".into(),
                input: serde_json::json!({
                    "path": "src/lib.rs",
                    "patch": "<elided>",
                }),
            },
            // The edit_file tool's own result.
            ChatContentBlock::ToolResult {
                tool_use_id: LIVE_TRACE_TOOL_USE_ID.into(),
                content: "edit_file: wrote 14 lines to src/lib.rs".into(),
                is_error: Some(false),
            },
            // The auto-build verification block the harness emits
            // against the same id — this is the duplicate that 400s
            // Anthropic on replay.
            ChatContentBlock::ToolResult {
                tool_use_id: LIVE_TRACE_TOOL_USE_ID.into(),
                content: "[auto-build: cargo check --workspace --tests] ok".into(),
                is_error: Some(false),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[
        user_event("apply the planned edit to src/lib.rs"),
        assistant,
    ]);

    // The dedupe must run at every `pending_tool_results` flush, so the
    // Anthropic-shaped invariant checker has to be clean on the whole
    // payload — no duplicate tool_result blocks anywhere, no dangling
    // tool_result with no matching tool_use.
    assert_anthropic_messages_valid(&history);

    let tool_results = extract_tool_result_blocks(&history);
    let live_trace_count = tool_results
        .iter()
        .filter(|b| b.get("tool_use_id").and_then(|v| v.as_str()) == Some(LIVE_TRACE_TOOL_USE_ID))
        .count();
    assert_eq!(
        live_trace_count, 1,
        "exactly one tool_result block must survive for tool_use_id `{LIVE_TRACE_TOOL_USE_ID}`; the auto-build duplicate that caused the 400 must be collapsed"
    );

    // Last-write-wins: the auto-build block was pushed after the
    // edit_file result, so its body is the one we expect to see.
    let surviving = tool_results
        .iter()
        .find(|b| b.get("tool_use_id").and_then(|v| v.as_str()) == Some(LIVE_TRACE_TOOL_USE_ID))
        .expect("the live-trace id must survive exactly once");
    let body = surviving
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        body.contains("auto-build"),
        "last-write-wins: the most recently flushed tool_result body for `{LIVE_TRACE_TOOL_USE_ID}` must be the one kept, got `{body}`"
    );

    // The submit_plan / edit_file ordering must be preserved — dedupe
    // only collapses duplicates, it does not reorder distinct ids.
    let ordered_ids: Vec<&str> = tool_results
        .iter()
        .map(|b| b.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or(""))
        .collect();
    assert_eq!(
        ordered_ids,
        vec!["toolu_plan_001", LIVE_TRACE_TOOL_USE_ID],
        "tool_result ordering across distinct ids must follow first-seen order"
    );
}
