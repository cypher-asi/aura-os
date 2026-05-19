//! Anthropic Messages API invariant tests: pins the
//! `assert_anthropic_messages_valid` helper against the known
//! `multiple tool_result blocks with id` 400.

use super::assert_anthropic_messages_valid;

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
