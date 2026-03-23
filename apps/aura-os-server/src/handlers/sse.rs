use std::convert::Infallible;

use axum::response::sse::Event;
use serde_json::json;

use aura_os_link::HarnessOutbound;

/// Maps a [`HarnessOutbound`] event to an SSE [`Event`] using the
/// event types and content shapes the frontend expects.
pub(crate) fn harness_event_to_sse(evt: &HarnessOutbound) -> Result<Event, Infallible> {
    let (event_type, data) = match evt {
        HarnessOutbound::SessionReady { .. } => {
            return Ok(Event::default().comment("session_ready"));
        }
        HarnessOutbound::AssistantMessageStart { message_id } => (
            "message_start",
            json!({ "message_id": message_id, "role": "assistant" }),
        ),
        HarnessOutbound::TextDelta { text } => (
            "delta",
            json!({ "text": text }),
        ),
        HarnessOutbound::ThinkingDelta { thinking } => (
            "thinking_delta",
            json!({ "text": thinking }),
        ),
        HarnessOutbound::ToolUseStart { id, name } => (
            "tool_call_started",
            json!({ "id": id, "name": name }),
        ),
        HarnessOutbound::ToolResult { name, result, is_error } => (
            "tool_result",
            json!({ "id": "", "name": name, "result": result, "is_error": is_error }),
        ),
        HarnessOutbound::AssistantMessageEnd { message_id, stop_reason, usage, .. } => (
            "message_end",
            json!({
                "message_id": message_id,
                "stop_reason": stop_reason,
                "input_tokens": usage.as_ref().map(|u| u.input_tokens).unwrap_or(0),
                "output_tokens": usage.as_ref().map(|u| u.output_tokens).unwrap_or(0),
            }),
        ),
        HarnessOutbound::Error { code, message, .. } => (
            "error",
            json!({ "code": code, "message": message }),
        ),
        HarnessOutbound::ToolCallbackRequest { .. } => {
            return Ok(Event::default().comment("tool_callback_request"));
        }
    };

    Ok(Event::default()
        .event(event_type)
        .json_data(&data)
        .unwrap_or_else(|_| Event::default().data("{}")))
}
