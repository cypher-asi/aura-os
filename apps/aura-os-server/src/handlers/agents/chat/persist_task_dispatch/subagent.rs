//! Dispatch arms for the live-subagent-thread protocol:
//! `SubagentSpawned` and `SubagentStatus`. These flow on the PARENT
//! chat stream and record the parent→child linkage so the persisted
//! assistant turn can later surface (and re-attach to) the child
//! subagent thread spawned by a `task` tool call.
//!
//! Linkage is carried entirely inside the event `content` JSON — the
//! `StorageSessionEvent` content column is arbitrary JSON, so no DB
//! migration is needed. We also stamp `child_run_id` onto the matching
//! `tool_use` content block of the in-flight assistant turn so a replay
//! of the persisted history can render the live thread under the
//! originating tool card.

use serde_json::{json, Value};

use super::super::persist::ChatPersistCtx;
use super::super::persist_task::{persist_event, PersistTaskState};

/// Append (or update by `child_run_id`) one AURA Council member on the
/// shared parent `tool_use` block's `council_members` array, ordered by
/// `council_index`. All members of a council turn share ONE
/// `parent_tool_use_id`, so accumulating the full set here — rather than
/// overwriting a single scalar `child_run_id` / `model` / `council_index`
/// — is what lets a reloaded turn rebuild the N-column council panel from
/// `content_blocks` alone. The array round-trips to the client through
/// the `ChatContentBlock::ToolUse` flattened `extra` map (no
/// `session_history` change required).
fn upsert_council_member(
    block: &mut Value,
    child_run_id: &str,
    model: Option<&str>,
    council_index: u32,
) {
    let Some(obj) = block.as_object_mut() else {
        return;
    };
    let members = obj
        .entry("council_members")
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(arr) = members.as_array_mut() else {
        return;
    };
    if let Some(existing) = arr
        .iter_mut()
        .find(|m| m.get("child_run_id").and_then(|v| v.as_str()) == Some(child_run_id))
    {
        // Re-delivered spawn for the same child run: refresh in place so
        // we never duplicate a member column.
        existing["council_index"] = json!(council_index);
        if let Some(model) = model {
            existing["model"] = json!(model);
        }
    } else {
        let mut member = serde_json::Map::new();
        member.insert("child_run_id".to_string(), json!(child_run_id));
        member.insert("council_index".to_string(), json!(council_index));
        if let Some(model) = model {
            member.insert("model".to_string(), json!(model));
        }
        arr.push(Value::Object(member));
    }
    arr.sort_by(|a, b| {
        let ia = a.get("council_index").and_then(Value::as_u64).unwrap_or(0);
        let ib = b.get("council_index").and_then(Value::as_u64).unwrap_or(0);
        ia.cmp(&ib)
    });
}

/// True when the block carries a council member for `child_run_id` in its
/// `council_members` array.
fn block_has_council_member(block: &Value, child_run_id: &str) -> bool {
    block
        .get("council_members")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .any(|m| m.get("child_run_id").and_then(|v| v.as_str()) == Some(child_run_id))
        })
        .unwrap_or(false)
}

/// Handle a `subagent_spawned` event: stamp `child_run_id` onto the
/// originating `task` tool_use block (when `parent_tool_use_id` is
/// known) and persist a `subagent_spawned` linkage event carrying the
/// parent session id, parent tool-use id, child run id, subagent type,
/// and spawn prompt.
///
/// `model` / `council_index` / `council_mechanism` are set only for AURA
/// Council members (`None` for ordinary `task` spawns). They are stamped
/// additively so a reloaded turn can group council member threads into a
/// council panel and label it with the active combine mechanism.
// The parameters mirror the flat `SubagentSpawned` wire fields one-for-one;
// bundling them into a struct here would only add an indirection that the
// single caller has to unpack again, so the wide signature is intentional.
#[allow(clippy::too_many_arguments)]
pub(super) async fn handle_subagent_spawned(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    child_run_id: &str,
    parent_tool_use_id: Option<&str>,
    subagent_type: &str,
    prompt: &str,
    model: Option<&str>,
    council_index: Option<u32>,
    council_mechanism: Option<&str>,
) {
    if let Some(parent_id) = parent_tool_use_id.filter(|s| !s.is_empty()) {
        // AURA Council members are fanned out directly with no preceding
        // `task` tool call, so the shared parent `tool_use` block the
        // members fold onto never gets created the way an ordinary `task`
        // spawn's does. Synthesize it the first time a council member is
        // announced so a reloaded turn can rebuild the N-column panel from
        // `content_blocks` alone (mirrors the live UI's
        // `ensureCouncilParentEntry`).
        let has_block = state.content_blocks.iter().any(|b| {
            b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                && b.get("id").and_then(|i| i.as_str()) == Some(parent_id)
        });
        if !has_block && council_index.is_some() {
            state.content_blocks.push(json!({
                "type": "tool_use",
                "id": parent_id,
                "name": "Task",
                "input": json!({}),
            }));
        }

        if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
            b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                && b.get("id").and_then(|i| i.as_str()) == Some(parent_id)
        }) {
            match council_index {
                // AURA Council member: all members of a council turn share
                // ONE `parent_tool_use_id`, so accumulate the full ordered
                // set in a `council_members` array on the parent block
                // (keyed by `child_run_id`) instead of overwriting a single
                // scalar. `subagent_type` / `prompt` still label the shared
                // parent card.
                Some(council_index) => {
                    upsert_council_member(block, child_run_id, model, council_index);
                    block["parent_tool_use_id"] = json!(parent_id);
                    block["subagent_type"] = json!(subagent_type);
                    block["prompt"] = json!(prompt);
                    // Council-wide property (same for every member), so
                    // stamp it once on the block root rather than per
                    // member. Lets a reloaded turn label the panel.
                    if let Some(mechanism) = council_mechanism {
                        block["council_mechanism"] = json!(mechanism);
                    }
                }
                // Ordinary `task` spawn (unchanged): stamp the single child
                // linkage onto the originating block so a replay can both
                // re-attach to the child thread (`child_run_id`) and label
                // the card (`subagent_type` / `prompt`) without consulting
                // the separate `subagent_spawned` linkage event.
                None => {
                    block["child_run_id"] = json!(child_run_id);
                    block["parent_tool_use_id"] = json!(parent_id);
                    block["subagent_type"] = json!(subagent_type);
                    block["prompt"] = json!(prompt);
                    if let Some(model) = model {
                        block["model"] = json!(model);
                    }
                }
            }
        }
    }

    if persist_event(
        ctx,
        "subagent_spawned",
        json!({
            "message_id": &state.message_id,
            "parent_session_id": ctx.session_id.to_string(),
            "parent_tool_use_id": parent_tool_use_id,
            "child_run_id": child_run_id,
            "subagent_type": subagent_type,
            "prompt": prompt,
            "model": model,
            "council_index": council_index,
            "council_mechanism": council_mechanism,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

/// Handle a `subagent_status` event: persist the transitional/terminal
/// state for a previously announced child run so the persisted thread
/// card reflects running/completed/failed/etc.
pub(super) async fn handle_subagent_status(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    child_run_id: &str,
    child_state: &str,
    reason: Option<&str>,
) {
    // Fold the latest lifecycle state onto the originating `task` block
    // (located by the `child_run_id` stamped at spawn time) so a history
    // reopen renders the terminal status (completed / failed / rejected)
    // instead of inferring it from the tool result. For an AURA Council
    // turn the child run lives inside the parent block's
    // `council_members` array, so fold the status onto the matching
    // member there instead of the single scalar.
    if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
        b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
            && (b.get("child_run_id").and_then(|c| c.as_str()) == Some(child_run_id)
                || block_has_council_member(b, child_run_id))
    }) {
        if let Some(member) = block
            .get_mut("council_members")
            .and_then(|v| v.as_array_mut())
            .and_then(|arr| {
                arr.iter_mut()
                    .find(|m| m.get("child_run_id").and_then(|v| v.as_str()) == Some(child_run_id))
            })
        {
            member["subagent_status"] = json!(child_state);
            match reason {
                Some(reason) => member["subagent_reason"] = json!(reason),
                None => {
                    if let Some(map) = member.as_object_mut() {
                        map.remove("subagent_reason");
                    }
                }
            }
        } else {
            block["subagent_status"] = json!(child_state);
            match reason {
                Some(reason) => block["subagent_reason"] = json!(reason),
                None => {
                    if let Some(map) = block.as_object_mut() {
                        map.remove("subagent_reason");
                    }
                }
            }
        }
    }

    if persist_event(
        ctx,
        "subagent_status",
        json!({
            "message_id": &state.message_id,
            "child_run_id": child_run_id,
            "state": child_state,
            "reason": reason,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ctx() -> ChatPersistCtx {
        ChatPersistCtx {
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
        }
    }

    #[tokio::test]
    async fn subagent_spawned_stamps_child_run_id_on_parent_tool_use_block() {
        // A `task` tool_use block is already in the assistant turn; the
        // spawn event must stamp the child run id onto it so a replay of
        // the persisted history can attach to the live child thread.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-task".to_string();
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": "toolu_task_1",
            "name": "Task",
            "input": json!({"prompt": "explore"}),
        }));

        let ctx = test_ctx();
        handle_subagent_spawned(
            &mut state,
            &ctx,
            "child-run-123",
            Some("toolu_task_1"),
            "explore",
            "explore the repo",
            None,
            None,
            None,
        )
        .await;

        let block = state
            .content_blocks
            .iter()
            .find(|b| b.get("id").and_then(Value::as_str) == Some("toolu_task_1"))
            .expect("task tool_use block present");
        assert_eq!(
            block.get("child_run_id").and_then(Value::as_str),
            Some("child-run-123"),
            "spawn must link the child run id onto the originating tool_use block",
        );
        assert_eq!(
            block.get("subagent_type").and_then(Value::as_str),
            Some("explore"),
            "spawn must label the originating tool_use block with the subagent type",
        );
        assert_eq!(
            block.get("prompt").and_then(Value::as_str),
            Some("explore the repo"),
        );
        assert_eq!(
            block.get("parent_tool_use_id").and_then(Value::as_str),
            Some("toolu_task_1"),
        );
    }

    #[tokio::test]
    async fn subagent_status_stamps_state_on_linked_tool_use_block() {
        // A prior spawn stamped `child_run_id` onto the `task` block; a
        // terminal status must fold its state (+ reason) onto the same
        // block so a history reopen renders the terminal pill.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-task".to_string();
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": "toolu_task_1",
            "name": "Task",
            "input": json!({"prompt": "explore"}),
            "child_run_id": "child-run-123",
        }));

        let ctx = test_ctx();
        handle_subagent_status(
            &mut state,
            &ctx,
            "child-run-123",
            "failed",
            Some("depth limit exceeded"),
        )
        .await;

        let block = state
            .content_blocks
            .iter()
            .find(|b| b.get("id").and_then(Value::as_str) == Some("toolu_task_1"))
            .expect("task tool_use block present");
        assert_eq!(
            block.get("subagent_status").and_then(Value::as_str),
            Some("failed"),
        );
        assert_eq!(
            block.get("subagent_reason").and_then(Value::as_str),
            Some("depth limit exceeded"),
        );
    }

    #[tokio::test]
    async fn subagent_spawned_without_parent_id_does_not_panic() {
        // Missing/empty parent_tool_use_id must be tolerated: we simply
        // skip the tool_use block stamping and still persist the event.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-task".to_string();
        let ctx = test_ctx();
        handle_subagent_spawned(
            &mut state,
            &ctx,
            "child-run-x",
            None,
            "explore",
            "go",
            None,
            None,
            None,
        )
        .await;
        assert!(
            state.content_blocks.is_empty(),
            "no tool_use block to stamp when parent id is absent",
        );
    }

    #[tokio::test]
    async fn subagent_spawned_appends_ordered_council_members_on_parent_tool_use_block() {
        // AURA Council members share ONE `parent_tool_use_id`, so each
        // spawn must APPEND (keyed by child_run_id, ordered by
        // council_index) into the parent block's `council_members` array
        // — preserving the full ordered set for a reloaded N-column
        // council panel — rather than overwriting a single scalar.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-council".to_string();
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": "toolu_council_1",
            "name": "Task",
            "input": json!({"prompt": "deliberate"}),
        }));

        let ctx = test_ctx();
        // Spawn slot 1 first, then slot 0, to prove the array ends up
        // ordered by council_index regardless of arrival order.
        handle_subagent_spawned(
            &mut state,
            &ctx,
            "child-run-b",
            Some("toolu_council_1"),
            "council-member",
            "deliberate on the answer",
            Some("anthropic/claude"),
            Some(1),
            Some("contrast"),
        )
        .await;
        handle_subagent_spawned(
            &mut state,
            &ctx,
            "child-run-a",
            Some("toolu_council_1"),
            "council-member",
            "deliberate on the answer",
            Some("openai/gpt"),
            Some(0),
            Some("contrast"),
        )
        .await;

        let block = state
            .content_blocks
            .iter()
            .find(|b| b.get("id").and_then(Value::as_str) == Some("toolu_council_1"))
            .expect("council tool_use block present");
        let members = block
            .get("council_members")
            .and_then(Value::as_array)
            .expect("council_members array present");
        assert_eq!(
            members.len(),
            2,
            "both members accumulate, none overwritten"
        );
        assert_eq!(
            members[0].get("council_index").and_then(Value::as_u64),
            Some(0),
        );
        assert_eq!(
            members[0].get("child_run_id").and_then(Value::as_str),
            Some("child-run-a"),
        );
        assert_eq!(
            members[0].get("model").and_then(Value::as_str),
            Some("openai/gpt"),
        );
        assert_eq!(
            members[1].get("council_index").and_then(Value::as_u64),
            Some(1),
        );
        assert_eq!(
            members[1].get("child_run_id").and_then(Value::as_str),
            Some("child-run-b"),
        );
        // Council members must NOT collapse onto the single scalar
        // `child_run_id` (that's the non-council `task` shape).
        assert!(block.get("child_run_id").is_none());
        // The council-wide combine mechanism is stamped once on the block
        // root so a reloaded turn can label the panel.
        assert_eq!(
            block.get("council_mechanism").and_then(Value::as_str),
            Some("contrast"),
        );
    }

    #[tokio::test]
    async fn subagent_spawned_synthesizes_parent_block_for_council_when_absent() {
        // Council members are fanned out with no preceding `task` tool
        // call, so the parent `tool_use` block does NOT pre-exist. The
        // first council spawn must synthesize it and accumulate members so
        // a reloaded turn can rebuild the N-column panel from
        // `content_blocks` alone.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-council".to_string();

        let ctx = test_ctx();
        handle_subagent_spawned(
            &mut state,
            &ctx,
            "child-run-b",
            Some("toolu_council_1"),
            "council-member",
            "deliberate on the answer",
            Some("anthropic/claude"),
            Some(1),
            Some("contrast"),
        )
        .await;
        handle_subagent_spawned(
            &mut state,
            &ctx,
            "child-run-a",
            Some("toolu_council_1"),
            "council-member",
            "deliberate on the answer",
            Some("openai/gpt"),
            Some(0),
            Some("contrast"),
        )
        .await;

        let council_blocks: Vec<&Value> = state
            .content_blocks
            .iter()
            .filter(|b| b.get("id").and_then(Value::as_str) == Some("toolu_council_1"))
            .collect();
        assert_eq!(
            council_blocks.len(),
            1,
            "exactly one synthetic parent block is created and reused",
        );
        let block = council_blocks[0];
        assert_eq!(block.get("type").and_then(Value::as_str), Some("tool_use"),);
        let members = block
            .get("council_members")
            .and_then(Value::as_array)
            .expect("council_members array present");
        assert_eq!(
            members.len(),
            2,
            "both members accumulate on the synthetic block"
        );
        assert_eq!(
            members[0].get("child_run_id").and_then(Value::as_str),
            Some("child-run-a"),
        );
        assert_eq!(
            members[1].get("child_run_id").and_then(Value::as_str),
            Some("child-run-b"),
        );
        assert!(block.get("child_run_id").is_none());
    }

    #[tokio::test]
    async fn subagent_status_folds_state_onto_matching_council_member() {
        // A council turn's terminal status must land on the matching entry
        // inside `council_members` (not the scalar block status) so a
        // reloaded column shows its persisted state.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-council".to_string();
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": "toolu_council_1",
            "name": "Task",
            "input": json!({"prompt": "deliberate"}),
            "council_members": [
                {"child_run_id": "child-a", "council_index": 0, "model": "m0"},
                {"child_run_id": "child-b", "council_index": 1, "model": "m1"},
            ],
        }));

        let ctx = test_ctx();
        handle_subagent_status(&mut state, &ctx, "child-b", "completed", None).await;

        let block = &state.content_blocks[0];
        let members = block
            .get("council_members")
            .and_then(Value::as_array)
            .expect("council_members array present");
        assert_eq!(
            members[0].get("subagent_status").and_then(Value::as_str),
            None,
            "non-matching member is untouched",
        );
        assert_eq!(
            members[1].get("subagent_status").and_then(Value::as_str),
            Some("completed"),
        );
        // The scalar block status must not be set for a council update.
        assert!(block.get("subagent_status").is_none());
    }
}
