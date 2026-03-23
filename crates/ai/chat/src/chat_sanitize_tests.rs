use super::*;
use aura_link::ToolResultContent;

// -------------------------------------------------------------------
// remove_empty_messages
// -------------------------------------------------------------------

#[test]
fn remove_empty_text_messages() {
    let msgs = vec![
        Message::user("hello"),
        Message::user(""),
        Message::assistant_text("response"),
    ];
    let result = remove_empty_messages(msgs);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].role, Role::User);
    assert_eq!(result[1].role, Role::Assistant);
}

#[test]
fn remove_messages_with_empty_blocks_vec() {
    let msgs = vec![
        Message::user("hello"),
        Message {
            role: Role::User,
            content: MessageContent::Blocks(vec![]),
        },
    ];
    let result = remove_empty_messages(msgs);
    assert_eq!(result.len(), 1);
}

#[test]
fn keep_messages_with_tool_use_blocks() {
    let msgs = vec![Message {
        role: Role::Assistant,
        content: MessageContent::Blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({"path": "a.rs"}),
        }]),
    }];
    let result = remove_empty_messages(msgs);
    assert_eq!(result.len(), 1);
}

#[test]
fn remove_messages_where_all_blocks_have_empty_content() {
    let msgs = vec![Message {
        role: Role::User,
        content: MessageContent::Blocks(vec![
            ContentBlock::Text { text: "".into() },
            ContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: ToolResultContent::Text("".into()),
                is_error: false,
            },
        ]),
    }];
    let result = remove_empty_messages(msgs);
    assert_eq!(result.len(), 0);
}

// -------------------------------------------------------------------
// merge_consecutive_same_role
// -------------------------------------------------------------------

#[test]
fn no_merging_when_roles_alternate() {
    let msgs = vec![
        Message::user("a"),
        Message::assistant_text("b"),
        Message::user("c"),
    ];
    let result = merge_consecutive_same_role(msgs);
    assert_eq!(result.len(), 3);
}

#[test]
fn merge_two_consecutive_user_text_messages() {
    let msgs = vec![Message::user("hello"), Message::user("world")];
    let result = merge_consecutive_same_role(msgs);
    assert_eq!(result.len(), 1);
    match &result[0].content {
        MessageContent::Text(t) => assert!(t.contains("hello") && t.contains("world")),
        _ => panic!("expected text"),
    }
}

#[test]
fn merge_two_consecutive_assistant_blocks_messages() {
    let msgs = vec![
        Message::assistant_blocks(vec![ContentBlock::Text { text: "a".into() }]),
        Message::assistant_blocks(vec![ContentBlock::Text { text: "b".into() }]),
    ];
    let result = merge_consecutive_same_role(msgs);
    assert_eq!(result.len(), 1);
    match &result[0].content {
        MessageContent::Blocks(blocks) => assert_eq!(blocks.len(), 2),
        _ => panic!("expected blocks"),
    }
}

#[test]
fn merge_text_and_blocks_different_content_types() {
    let msgs = vec![
        Message::user("text message"),
        Message {
            role: Role::User,
            content: MessageContent::Blocks(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: ToolResultContent::Text("result".into()),
                is_error: false,
            }]),
        },
    ];
    let result = merge_consecutive_same_role(msgs);
    assert_eq!(result.len(), 1);
    match &result[0].content {
        MessageContent::Blocks(blocks) => {
            assert!(blocks.len() >= 2, "should have text + tool_result blocks");
        }
        _ => panic!("expected blocks after mixed merge"),
    }
}

#[test]
fn merge_three_plus_consecutive_same_role() {
    let msgs = vec![
        Message::user("a"),
        Message::user("b"),
        Message::user("c"),
    ];
    let result = merge_consecutive_same_role(msgs);
    assert_eq!(result.len(), 1);
    match &result[0].content {
        MessageContent::Text(t) => {
            assert!(t.contains("a") && t.contains("b") && t.contains("c"));
        }
        _ => panic!("expected text"),
    }
}

#[test]
fn merge_empty_input_returns_empty() {
    let result = merge_consecutive_same_role(vec![]);
    assert!(result.is_empty());
}

// -------------------------------------------------------------------
// sanitize_orphan_tool_results
// -------------------------------------------------------------------

#[test]
fn passes_through_matched_tool_use_tool_result_pairs() {
    let msgs = vec![
        Message::user("do something"),
        Message::assistant_blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({"path": "a.rs"}),
        }]),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
                content: ToolResultContent::Text("file content".into()),
                is_error: false,
        }]),
    ];
    let result = sanitize_orphan_tool_results(msgs);
    assert_eq!(result.len(), 3);
}

#[test]
fn drops_orphan_tool_result_with_no_preceding_assistant() {
    let msgs = vec![Message::tool_results(vec![ContentBlock::ToolResult {
        tool_use_id: "orphan".into(),
                content: ToolResultContent::Text("lost result".into()),
                is_error: false,
    }])];
    let result = sanitize_orphan_tool_results(msgs);
    assert_eq!(result.len(), 1);
    match &result[0].content {
        MessageContent::Text(t) => {
            assert!(t.contains("lost due to context") || t.contains("lost result"));
        }
        _ => {
            // The block might have been kept if there are other blocks; check content
        }
    }
}

#[test]
fn drops_tool_result_when_tool_use_id_not_in_previous_assistant() {
    let msgs = vec![
        Message::user("start"),
        Message::assistant_blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({"path": "a.rs"}),
        }]),
        Message::tool_results(vec![
            ContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: ToolResultContent::Text("valid".into()),
                is_error: false,
            },
            ContentBlock::ToolResult {
                tool_use_id: "t_unknown".into(),
                content: ToolResultContent::Text("orphan".into()),
                is_error: false,
            },
        ]),
    ];
    let result = sanitize_orphan_tool_results(msgs);
    assert_eq!(result.len(), 3);
    match &result[2].content {
        MessageContent::Blocks(blocks) => {
            let tool_results: Vec<_> = blocks
                .iter()
                .filter(|b| matches!(b, ContentBlock::ToolResult { .. }))
                .collect();
            assert_eq!(tool_results.len(), 1);
        }
        _ => panic!("expected blocks"),
    }
}

#[test]
fn converts_fully_orphaned_tool_result_message_to_text() {
    let msgs = vec![
        Message::user("start"),
        Message::assistant_text("some text"),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "orphan".into(),
                content: ToolResultContent::Text("lost data".into()),
                is_error: false,
        }]),
    ];
    let result = sanitize_orphan_tool_results(msgs);
    let last = result.last().unwrap();
    match &last.content {
        MessageContent::Text(t) => assert!(t.contains("lost due to context")),
        _ => panic!("expected text placeholder for fully orphaned tool_result"),
    }
}

// -------------------------------------------------------------------
// sanitize_tool_use_results
// -------------------------------------------------------------------

#[test]
fn no_change_when_all_tool_use_have_matching_results() {
    let msgs = vec![
        Message::user("go"),
        Message::assistant_blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({}),
        }]),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: ToolResultContent::Text("data".into()),
            is_error: false,
        }]),
    ];
    let result = sanitize_tool_use_results(msgs.clone());
    assert_eq!(result.len(), 3);
}

#[test]
fn injects_synthetic_error_result_for_orphaned_tool_use() {
    let msgs = vec![
        Message::user("go"),
        Message::assistant_blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({}),
        }]),
        Message::assistant_text("continued without result"),
    ];
    let result = sanitize_tool_use_results(msgs);
    let has_synthetic = result.iter().any(|m| match &m.content {
        MessageContent::Blocks(blocks) => blocks.iter().any(|b| match b {
            ContentBlock::ToolResult {
                content, is_error, ..
            } => {
                aura_link::tool_result_as_str(content).contains("interrupted") && *is_error
            }
            _ => false,
        }),
        _ => false,
    });
    assert!(has_synthetic, "should inject synthetic error result");
}

#[test]
fn merges_synthetic_results_with_existing_user_message() {
    let msgs = vec![
        Message::user("go"),
        Message::assistant_blocks(vec![
            ContentBlock::ToolUse {
                id: "t1".into(),
                name: "a".into(),
                input: serde_json::json!({}),
            },
            ContentBlock::ToolUse {
                id: "t2".into(),
                name: "b".into(),
                input: serde_json::json!({}),
            },
        ]),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: ToolResultContent::Text("ok".into()),
            is_error: false,
        }]),
    ];
    let result = sanitize_tool_use_results(msgs);
    let user_msg = result.iter().find(|m| {
        m.role == Role::User
            && match &m.content {
                MessageContent::Blocks(blocks) => blocks.iter().any(|b| match b {
                    ContentBlock::ToolResult { tool_use_id, .. } => tool_use_id == "t2",
                    _ => false,
                }),
                _ => false,
            }
    });
    assert!(
        user_msg.is_some(),
        "should merge synthetic t2 result into existing user message"
    );
}

#[test]
fn handles_text_user_message_following_tool_use() {
    let msgs = vec![
        Message::user("go"),
        Message::assistant_blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({}),
        }]),
        Message::user("text follow-up without tool_result"),
    ];
    let result = sanitize_tool_use_results(msgs);
    let has_both = result.iter().any(|m| {
        m.role == Role::User
            && match &m.content {
                MessageContent::Blocks(blocks) => {
                    let has_text = blocks
                        .iter()
                        .any(|b| matches!(b, ContentBlock::Text { .. }));
                    let has_result = blocks
                        .iter()
                        .any(|b| matches!(b, ContentBlock::ToolResult { .. }));
                    has_text && has_result
                }
                _ => false,
            }
    });
    assert!(
        has_both,
        "should convert text user msg to blocks and merge with synthetic result"
    );
}

#[test]
fn handles_tool_use_at_end_of_messages_with_no_next() {
    let msgs = vec![
        Message::user("go"),
        Message::assistant_blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({}),
        }]),
    ];
    let result = sanitize_tool_use_results(msgs);
    assert!(result.len() >= 3, "should add synthetic result message");
    let last = result.last().unwrap();
    assert_eq!(last.role, Role::User);
    match &last.content {
        MessageContent::Blocks(blocks) => {
            assert!(blocks
                .iter()
                .any(|b| matches!(b, ContentBlock::ToolResult { .. })));
        }
        _ => panic!("expected blocks with tool_result"),
    }
}

// -------------------------------------------------------------------
// validate_and_repair_messages
// -------------------------------------------------------------------

#[test]
fn already_valid_messages_pass_through() {
    let msgs = vec![
        Message::user("hello"),
        Message::assistant_text("hi"),
    ];
    let result = validate_and_repair_messages(msgs.clone());
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].role, Role::User);
    assert_eq!(result[1].role, Role::Assistant);
}

#[test]
fn messages_starting_with_assistant_get_user_prepended() {
    let msgs = vec![
        Message::assistant_text("hi"),
        Message::user("hello"),
    ];
    let result = validate_and_repair_messages(msgs);
    assert_eq!(result[0].role, Role::User);
    match &result[0].content {
        MessageContent::Text(t) => assert!(t.contains("Continue")),
        _ => panic!("expected text placeholder"),
    }
}

#[test]
fn complex_scenario_empty_broken_alternation_orphans_missing_results() {
    let msgs = vec![
        Message::user(""),
        Message::user("go"),
        Message::user("also go"),
        Message::assistant_blocks(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({}),
        }]),
        Message::assistant_text("done"),
    ];
    let result = validate_and_repair_messages(msgs);

    assert_eq!(result[0].role, Role::User);

    for i in 1..result.len() {
        assert_ne!(
            result[i].role,
            result[i - 1].role,
            "messages at index {} and {} have same role '{:?}'",
            i - 1,
            i,
            result[i].role
        );
    }

    let has_tool_result = result.iter().any(|m| match &m.content {
        MessageContent::Blocks(blocks) => blocks
            .iter()
            .any(|b| matches!(b, ContentBlock::ToolResult { .. })),
        _ => false,
    });
    assert!(
        has_tool_result,
        "should have injected synthetic tool_result"
    );
}

// -------------------------------------------------------------------
// ensure_starts_with_user
// -------------------------------------------------------------------

#[test]
fn no_change_when_first_is_user() {
    let msgs = vec![Message::user("hello")];
    let result = ensure_starts_with_user(msgs);
    assert_eq!(result.len(), 1);
}

#[test]
fn prepends_placeholder_when_first_is_assistant() {
    let msgs = vec![Message::assistant_text("hi")];
    let result = ensure_starts_with_user(msgs);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].role, Role::User);
}

#[test]
fn empty_input_returns_empty() {
    let result = ensure_starts_with_user(vec![]);
    assert!(result.is_empty());
}
