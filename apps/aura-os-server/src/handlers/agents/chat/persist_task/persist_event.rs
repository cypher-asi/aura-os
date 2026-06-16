//! Storage write of a single chat persistence event. Centralised here
//! so every dispatch arm and the synthesized-end fallbacks share the
//! same error-logging shape.

use serde_json::{json, Value};
use tracing::{error, warn};

use super::super::persist::ChatPersistCtx;

const COMPACT_FIELD_MAX_BYTES: usize = 2048;
const COMPACT_PREVIEW_MAX_BYTES: usize = 512;

pub(crate) async fn persist_event(ctx: &ChatPersistCtx, event_type: &str, content: Value) -> bool {
    // Stringify the typed `SessionId` once at this storage-write
    // boundary: `CreateSessionEventRequest.session_id` is the
    // `aura_os_storage` REST shape (still `Option<String>`), and the
    // `create_event` URL segment is `&str`.
    let session_id_str = ctx.session_id.to_string();
    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(session_id_str.clone()),
        user_id: None,
        agent_id: Some(ctx.project_agent_id.clone()),
        sender: Some("agent".to_string()),
        project_id: Some(ctx.project_id.clone()),
        org_id: None,
        event_type: event_type.to_string(),
        content: Some(content.clone()),
    };
    match ctx
        .storage
        .create_event(&session_id_str, &ctx.jwt, &req)
        .await
    {
        Ok(_) => true,
        Err(first_err) => {
            if should_retry_compacted(&first_err) {
                if let Some(compacted) = compact_event_for_storage_retry(event_type, &content) {
                    let original_content_bytes = serialized_len(&content);
                    let compacted_content_bytes = serialized_len(&compacted);
                    let retry_req = aura_os_storage::CreateSessionEventRequest {
                        session_id: Some(session_id_str.clone()),
                        user_id: None,
                        agent_id: Some(ctx.project_agent_id.clone()),
                        sender: Some("agent".to_string()),
                        project_id: Some(ctx.project_id.clone()),
                        org_id: None,
                        event_type: event_type.to_string(),
                        content: Some(compacted),
                    };
                    match ctx
                        .storage
                        .create_event(&session_id_str, &ctx.jwt, &retry_req)
                        .await
                    {
                        Ok(_) => {
                            warn!(
                                upstream_status = ?upstream_status(&first_err),
                                body_preview = %body_preview(&first_err),
                                session_id = %ctx.session_id,
                                project_agent_id = %ctx.project_agent_id,
                                event_type = %event_type,
                                original_content_bytes,
                                compacted_content_bytes,
                                "Persisted compact chat event after storage rejected full payload"
                            );
                            return true;
                        }
                        Err(retry_err) => {
                            log_persist_failure(ctx, event_type, &retry_err, Some(&first_err));
                            return false;
                        }
                    }
                }
            }
            log_persist_failure(ctx, event_type, &first_err, None);
            false
        }
    }
}

fn should_retry_compacted(err: &aura_os_storage::StorageError) -> bool {
    let aura_os_storage::StorageError::Server { status, body } = err else {
        return false;
    };
    if *status == 413 {
        return true;
    }
    if *status != 403 {
        return false;
    }
    let lowered = body.to_ascii_lowercase();
    lowered.contains("web application firewall")
        || lowered.contains("<title>blocked</title>")
        || lowered.contains("request id:")
}

fn compact_event_for_storage_retry(event_type: &str, content: &Value) -> Option<Value> {
    match event_type {
        "tool_call_snapshot" => Some(compact_tool_call_snapshot(content)),
        "tool_result" => Some(compact_tool_result(content)),
        "assistant_message_end" => Some(compact_assistant_message_end(content)),
        _ => None,
    }
}

fn compact_tool_call_snapshot(content: &Value) -> Value {
    let mut compacted = content.clone();
    let original = content.get("input").cloned().unwrap_or(Value::Null);
    let original_bytes = serialized_len(&original);
    compacted["input"] = json!({
        "_aura_compacted": "storage_retry",
        "original_bytes": original_bytes,
        "preview": compact_json_preview(&original, COMPACT_PREVIEW_MAX_BYTES),
    });
    compacted["storage_compacted"] = json!(true);
    compacted
}

fn compact_tool_result(content: &Value) -> Value {
    let mut compacted = content.clone();
    if let Some(result) = content.get("result").and_then(|v| v.as_str()) {
        compacted["result"] = json!(truncate_with_marker(result, COMPACT_FIELD_MAX_BYTES));
    }
    if let Some(image_data) = content.get("image_data").and_then(|v| v.as_str()) {
        compacted["image_data_omitted_bytes"] = json!(image_data.len());
        if let Some(obj) = compacted.as_object_mut() {
            obj.remove("image_data");
        }
    }
    compacted["storage_compacted"] = json!(true);
    compacted
}

fn compact_assistant_message_end(content: &Value) -> Value {
    let mut compacted = content.clone();
    if let Some(text) = content.get("text").and_then(|v| v.as_str()) {
        compacted["text_preview"] = json!(truncate_with_marker(text, COMPACT_PREVIEW_MAX_BYTES));
    }
    if let Some(thinking) = content.get("thinking").and_then(|v| v.as_str()) {
        compacted["thinking_preview"] =
            json!(truncate_with_marker(thinking, COMPACT_PREVIEW_MAX_BYTES));
    }

    // Keep this terminal row tiny. The read side already reconstructs a
    // completed assistant turn from prior text/thinking deltas when the
    // terminal row has no displayable body, so a compact retry can still
    // close the turn without resending the large block snapshot that WAF
    // rejected.
    compacted["text"] = json!("");
    compacted["thinking"] = Value::Null;
    compacted["content_blocks"] = json!([]);
    compacted["storage_compacted"] = json!(true);
    compacted
}

fn serialized_len(value: &Value) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
}

fn compact_json_preview(value: &Value, max_bytes: usize) -> String {
    match serde_json::to_string(value) {
        Ok(serialized) => truncate_with_marker(&serialized, max_bytes),
        Err(_) => "[unserializable JSON value]".to_string(),
    }
}

fn truncate_with_marker(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... [truncated {} bytes]", &value[..end], value.len())
}

fn log_persist_failure(
    ctx: &ChatPersistCtx,
    event_type: &str,
    err: &aura_os_storage::StorageError,
    first_err: Option<&aura_os_storage::StorageError>,
) {
    error!(
        error = %storage_error_summary(err),
        first_error = first_err.map(storage_error_summary),
        upstream_status = ?upstream_status(err),
        body_preview = %body_preview(err),
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        event_type = %event_type,
        "Failed to persist chat event"
    );
}

fn storage_error_summary(err: &aura_os_storage::StorageError) -> String {
    match err {
        aura_os_storage::StorageError::Server { status, .. } => {
            format!("aura-storage returned {status}")
        }
        other => other.to_string(),
    }
}

fn upstream_status(err: &aura_os_storage::StorageError) -> Option<u16> {
    match err {
        aura_os_storage::StorageError::Server { status, .. } => Some(*status),
        _ => None,
    }
}

fn body_preview(err: &aura_os_storage::StorageError) -> String {
    match err {
        aura_os_storage::StorageError::Server { body, .. } => {
            truncate_with_marker(body, COMPACT_PREVIEW_MAX_BYTES)
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use axum::{
        extract::{Path, State},
        http::StatusCode,
        response::{Html, IntoResponse},
        routing::post,
        Json, Router,
    };
    use tokio::net::TcpListener;

    #[test]
    fn retries_only_waf_or_payload_storage_rejections() {
        let waf = aura_os_storage::StorageError::Server {
            status: 403,
            body: "403 - Forbidden. Your request was blocked by this site's web application firewall. Request ID: abc".into(),
        };
        assert!(should_retry_compacted(&waf));

        let too_large = aura_os_storage::StorageError::Server {
            status: 413,
            body: "payload too large".into(),
        };
        assert!(should_retry_compacted(&too_large));

        let auth = aura_os_storage::StorageError::Server {
            status: 403,
            body: r#"{"error":"Forbidden"}"#.into(),
        };
        assert!(!should_retry_compacted(&auth));
    }

    #[test]
    fn compacts_tool_call_snapshot_input_but_preserves_identity() {
        let content = json!({
            "message_id": "msg-1",
            "id": "toolu_1",
            "name": "write_file",
            "input": {
                "path": "src/App.jsx",
                "content": "x".repeat(10_000),
            },
            "seq": 7,
        });

        let compacted =
            compact_event_for_storage_retry("tool_call_snapshot", &content).expect("compactable");

        assert_eq!(compacted["message_id"], "msg-1");
        assert_eq!(compacted["id"], "toolu_1");
        assert_eq!(compacted["name"], "write_file");
        assert_eq!(compacted["seq"], 7);
        assert_eq!(compacted["storage_compacted"], true);
        assert_eq!(compacted["input"]["_aura_compacted"], "storage_retry");
        assert!(
            serialized_len(&compacted) < serialized_len(&content),
            "compacted snapshot must be meaningfully smaller"
        );
        assert!(
            compacted["input"]["preview"]
                .as_str()
                .expect("preview")
                .contains("truncated"),
            "preview should carry a truncation marker"
        );
    }

    #[test]
    fn compacts_assistant_message_end_to_reconstructable_terminal_marker() {
        let content = json!({
            "message_id": "msg-1",
            "text": "final answer ".repeat(1000),
            "thinking": "private reasoning ".repeat(1000),
            "content_blocks": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "content": "x".repeat(10_000),
                    "is_error": false,
                }
            ],
            "usage": { "input_tokens": 10, "output_tokens": 20 },
            "files_changed": { "created": [], "modified": ["src/App.jsx"], "deleted": [] },
            "stop_reason": "end_turn",
            "seq": 42,
        });

        let compacted = compact_event_for_storage_retry("assistant_message_end", &content)
            .expect("compactable");

        assert_eq!(compacted["message_id"], "msg-1");
        assert_eq!(compacted["usage"], content["usage"]);
        assert_eq!(compacted["files_changed"], content["files_changed"]);
        assert_eq!(compacted["stop_reason"], "end_turn");
        assert_eq!(compacted["seq"], 42);
        assert_eq!(compacted["text"], "");
        assert_eq!(compacted["thinking"], Value::Null);
        assert_eq!(compacted["content_blocks"], json!([]));
        assert_eq!(compacted["storage_compacted"], true);
        assert!(
            compacted["text_preview"]
                .as_str()
                .unwrap()
                .contains("truncated"),
            "operator preview should explain the omitted text"
        );
        assert!(
            serialized_len(&compacted) < serialized_len(&content),
            "terminal marker must be smaller than the rejected snapshot"
        );
    }

    #[test]
    fn compacts_tool_result_without_logging_or_storing_base64() {
        let content = json!({
            "message_id": "msg-1",
            "tool_use_id": "toolu_1",
            "name": "computer_use_screenshot",
            "result": "x".repeat(10_000),
            "is_error": false,
            "image_media_type": "image/png",
            "image_data": "a".repeat(10_000),
            "seq": 3,
        });

        let compacted =
            compact_event_for_storage_retry("tool_result", &content).expect("compactable");

        assert_eq!(compacted["tool_use_id"], "toolu_1");
        assert_eq!(compacted["image_media_type"], "image/png");
        assert!(compacted.get("image_data").is_none());
        assert_eq!(compacted["image_data_omitted_bytes"], 10_000);
        assert!(
            compacted["result"].as_str().unwrap().contains("truncated"),
            "large tool text should become a bounded preview"
        );
        assert!(serialized_len(&compacted) < serialized_len(&content));
    }

    #[tokio::test]
    async fn persist_event_retries_compacted_payload_after_waf_rejection() {
        type Requests = Arc<Mutex<Vec<aura_os_storage::CreateSessionEventRequest>>>;

        async fn create_event(
            Path(session_id): Path<String>,
            State(requests): State<Requests>,
            Json(req): Json<aura_os_storage::CreateSessionEventRequest>,
        ) -> axum::response::Response {
            let mut seen = requests.lock().expect("requests lock");
            seen.push(req.clone());
            if seen.len() == 1 {
                return (
                    StatusCode::FORBIDDEN,
                    Html(
                        "<title>Blocked</title>Your request was blocked by this site's web application firewall. Request ID: abc",
                    ),
                )
                    .into_response();
            }

            Json(aura_os_storage::StorageSessionEvent {
                id: format!("evt-{session_id}"),
                session_id: req.session_id,
                user_id: req.user_id,
                agent_id: req.agent_id,
                sender: req.sender,
                project_id: req.project_id,
                org_id: req.org_id,
                event_type: Some(req.event_type),
                content: req.content,
                created_at: Some("2026-06-16T00:00:00Z".to_string()),
            })
            .into_response()
        }

        let requests: Requests = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .route("/api/sessions/:session_id/events", post(create_event))
            .with_state(requests.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });

        let base_url = format!("http://{addr}");
        let ctx = ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(&base_url)),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };
        let content = json!({
            "message_id": "msg-1",
            "id": "toolu_1",
            "name": "write_file",
            "input": {
                "path": "src/App.jsx",
                "content": "x".repeat(10_000),
            },
            "seq": 11,
        });

        assert!(
            persist_event(&ctx, "tool_call_snapshot", content).await,
            "compacted retry should make the persist operation durable"
        );

        let seen = requests.lock().expect("requests lock");
        assert_eq!(seen.len(), 2, "first exact write plus one compact retry");
        assert_eq!(seen[0].event_type, "tool_call_snapshot");
        assert_eq!(seen[1].event_type, "tool_call_snapshot");
        let first_content = seen[0].content.as_ref().expect("first content");
        let retry_content = seen[1].content.as_ref().expect("retry content");
        assert_eq!(retry_content["message_id"], "msg-1");
        assert_eq!(retry_content["id"], "toolu_1");
        assert_eq!(retry_content["name"], "write_file");
        assert_eq!(retry_content["storage_compacted"], true);
        assert_eq!(retry_content["input"]["_aura_compacted"], "storage_retry");
        assert!(serialized_len(retry_content) < serialized_len(first_content));
    }
}
