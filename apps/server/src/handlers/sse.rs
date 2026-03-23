use axum::response::sse::Event;

use aura_chat::ChatStreamEvent;

/// Maps a `ChatStreamEvent` to an SSE `Event`.
///
/// This is the shared, pure mapping used by both `send_agent_message_stream`
/// and `send_message_stream`. Call-site-specific side effects (e.g. emitting
/// engine events on `SpecSaved`) are handled by the caller before/after
/// invoking this function.
pub fn chat_stream_event_to_sse(evt: &ChatStreamEvent) -> Event {
    match evt {
        ChatStreamEvent::Delta(text) => Event::default()
            .event("delta")
            .json_data(serde_json::json!({ "text": text }))
            .unwrap(),
        ChatStreamEvent::ThinkingDelta(text) => Event::default()
            .event("thinking_delta")
            .json_data(serde_json::json!({ "text": text }))
            .unwrap(),
        ChatStreamEvent::Progress(stage) => Event::default()
            .event("progress")
            .json_data(serde_json::json!({ "stage": stage }))
            .unwrap(),
        ChatStreamEvent::ToolCallStarted { id, name } => Event::default()
            .event("tool_call_started")
            .json_data(serde_json::json!({ "id": id, "name": name }))
            .unwrap(),
        ChatStreamEvent::ToolCallSnapshot { id, name, input } => Event::default()
            .event("tool_call_snapshot")
            .json_data(serde_json::json!({ "id": id, "name": name, "input": input }))
            .unwrap(),
        ChatStreamEvent::ToolCall { id, name, input } => Event::default()
            .event("tool_call")
            .json_data(serde_json::json!({ "id": id, "name": name, "input": input }))
            .unwrap(),
        ChatStreamEvent::ToolResult {
            id,
            name,
            result,
            is_error,
        } => Event::default()
            .event("tool_result")
            .json_data(serde_json::json!({
                "id": id, "name": name, "result": result, "is_error": is_error
            }))
            .unwrap(),
        ChatStreamEvent::SpecSaved(spec) => Event::default()
            .event("spec_saved")
            .json_data(serde_json::json!({ "spec": spec }))
            .unwrap(),
        ChatStreamEvent::SpecsTitle(title) => Event::default()
            .event("specs_title")
            .json_data(serde_json::json!({ "title": title }))
            .unwrap(),
        ChatStreamEvent::SpecsSummary(summary) => Event::default()
            .event("specs_summary")
            .json_data(serde_json::json!({ "summary": summary }))
            .unwrap(),
        ChatStreamEvent::TaskSaved(task) => Event::default()
            .event("task_saved")
            .json_data(serde_json::json!({ "task": task }))
            .unwrap(),
        ChatStreamEvent::MessageSaved(msg) => Event::default()
            .event("message_saved")
            .json_data(serde_json::json!({ "message": msg }))
            .unwrap(),
        ChatStreamEvent::AgentInstanceUpdated(instance) => Event::default()
            .event("agent_instance_updated")
            .json_data(serde_json::json!({ "agent_instance": instance }))
            .unwrap(),
        ChatStreamEvent::TokenUsage {
            input_tokens,
            output_tokens,
        } => Event::default()
            .event("token_usage")
            .json_data(
                serde_json::json!({ "input_tokens": input_tokens, "output_tokens": output_tokens }),
            )
            .unwrap(),
        ChatStreamEvent::Error(msg) => Event::default()
            .event("error")
            .json_data(serde_json::json!({ "message": msg }))
            .unwrap(),
        ChatStreamEvent::Done => Event::default()
            .event("done")
            .json_data(serde_json::json!({}))
            .unwrap(),
    }
}
