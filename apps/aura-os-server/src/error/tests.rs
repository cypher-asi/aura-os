use super::*;

#[test]
fn upstream_context_parses_nested_code_and_message() {
    let body = r#"{"error":{"code":"DATABASE","message":"An internal error occurred"}}"#;
    let ctx = UpstreamErrorContext::parse(body);
    assert_eq!(ctx.upstream_code.as_deref(), Some("DATABASE"));
    assert_eq!(
        ctx.upstream_message.as_deref(),
        Some("An internal error occurred")
    );
}

#[test]
fn upstream_context_tolerates_non_json_bodies() {
    let ctx = UpstreamErrorContext::parse("not json");
    assert!(ctx.upstream_code.is_none());
    assert!(ctx.upstream_message.is_none());
}

#[test]
fn upstream_context_tolerates_missing_error_object() {
    let ctx = UpstreamErrorContext::parse(r#"{"other":"value"}"#);
    assert!(ctx.upstream_code.is_none());
    assert!(ctx.upstream_message.is_none());
}

#[test]
fn map_network_error_surfaces_upstream_code_in_details() {
    let err = aura_os_network::NetworkError::Server {
        status: 500,
        body: r#"{"error":{"code":"DATABASE","message":"boom"}}"#.to_string(),
    };
    let (status, Json(api_err)) = map_network_error(err);
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(api_err.code, "network_error");
    assert_eq!(api_err.details.as_deref(), Some("upstream_code=DATABASE"));
}

#[test]
fn map_network_error_leaves_details_empty_when_body_is_opaque() {
    let err = aura_os_network::NetworkError::Server {
        status: 500,
        body: "totally not json".to_string(),
    };
    let (_, Json(api_err)) = map_network_error(err);
    assert!(api_err.details.is_none());
}

#[test]
fn chat_persist_unavailable_returns_424_with_structured_data() {
    let ctx = ChatPersistErrorCtx {
        session_id: None,
        project_id: None,
        project_agent_id: None,
    };
    let (status, Json(api_err)) = ApiError::chat_persist_unavailable("no project binding", ctx);
    assert_eq!(status, StatusCode::FAILED_DEPENDENCY);
    assert_eq!(api_err.code, "chat_persist_unavailable");
    let data = api_err.data.expect("data must be populated");
    assert_eq!(data["code"], "chat_persist_unavailable");
    assert_eq!(data["reason"], "no project binding");
    assert!(data["upstream_status"].is_null());
    assert!(data["session_id"].is_null());
    assert!(data["project_id"].is_null());
    assert!(data["project_agent_id"].is_null());
}

#[test]
fn chat_persist_failed_returns_502_with_upstream_status_and_ids() {
    let ctx = ChatPersistErrorCtx {
        session_id: Some("sess-1".into()),
        project_id: Some("proj-1".into()),
        project_agent_id: Some("pa-1".into()),
    };
    let (status, Json(api_err)) =
        ApiError::chat_persist_failed("storage returned 503: upstream down", Some(503), ctx);
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(api_err.code, "chat_persist_failed");
    let data = api_err.data.expect("data must be populated");
    assert_eq!(data["code"], "chat_persist_failed");
    assert_eq!(
        data["reason"],
        serde_json::Value::String("storage returned 503: upstream down".into())
    );
    assert_eq!(data["upstream_status"], 503);
    assert_eq!(data["session_id"], "sess-1");
    assert_eq!(data["project_id"], "proj-1");
    assert_eq!(data["project_agent_id"], "pa-1");
}

#[test]
fn agent_busy_returns_409_with_structured_data() {
    let (status, Json(api_err)) = ApiError::agent_busy(
        "Agent is currently running an automation task.",
        Some("automaton-xyz".into()),
    );
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(api_err.code, "agent_busy");
    let data = api_err.data.expect("data must be populated");
    assert_eq!(data["code"], "agent_busy");
    assert_eq!(data["automaton_id"], "automaton-xyz");
    assert!(data["reason"].as_str().unwrap().contains("automation task"));
}

#[test]
fn agent_busy_accepts_missing_automaton_id() {
    let (_, Json(api_err)) = ApiError::agent_busy("busy", None);
    assert_eq!(api_err.code, "agent_busy");
    let data = api_err.data.expect("data populated");
    assert!(data["automaton_id"].is_null());
}

#[test]
fn harness_capacity_exhausted_returns_503_with_structured_data() {
    let (status, Json(api_err)) = ApiError::harness_capacity_exhausted(96);
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(api_err.code, "harness_capacity_exhausted");
    let data = api_err.data.expect("data must be populated");
    assert_eq!(data["code"], "harness_capacity_exhausted");
    assert_eq!(data["configured_cap"], 96);
    assert_eq!(data["retry_after_seconds"], 5);
    let body = api_err.error;
    assert!(
        body.contains("96"),
        "user-visible message must include the configured cap, got: {body}"
    );
}

#[test]
fn session_identity_missing_returns_422_with_stable_field_code() {
    let (status, Json(api_err)) =
        ApiError::session_identity_missing("aura_org_id", "chat_session");
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(api_err.code, "missing_aura_org_id");
    let data = api_err.data.expect("data must be populated");
    assert_eq!(data["code"], "session_identity_missing");
    assert_eq!(data["field"], "aura_org_id");
    assert_eq!(data["context"], "chat_session");
    assert!(
        api_err.error.contains("aura_org_id"),
        "user-visible message must mention the missing field, got: {}",
        api_err.error
    );
    assert!(
        api_err.error.contains("chat_session"),
        "user-visible message must mention the call-site context, got: {}",
        api_err.error
    );
}

#[test]
fn session_identity_missing_codes_are_field_specific() {
    for field in [
        "aura_session_id",
        "template_agent_id",
        "user_id",
        "auth_token",
    ] {
        let (_, Json(api_err)) = ApiError::session_identity_missing(field, "dev_loop_automaton");
        assert_eq!(api_err.code, format!("missing_{field}"));
        assert_eq!(api_err.data.unwrap()["field"], field);
    }
}

#[test]
fn chat_persist_error_body_skips_data_when_none_in_legacy_paths() {
    // Legacy ApiError constructors (not_found, etc.) must still emit
    // bodies without a `data` key so existing clients that assert on
    // the older shape don't break.
    let (_, Json(api_err)) = ApiError::not_found("missing");
    let serialized = serde_json::to_value(&api_err).unwrap();
    assert!(
        serialized.get("data").is_none(),
        "non-chat errors must omit the `data` field entirely, got: {serialized}"
    );
}

#[test]
fn map_chat_persist_storage_error_preserves_upstream_status() {
    let err = aura_os_storage::StorageError::Server {
        status: 503,
        body: r#"{"error":"upstream down"}"#.to_string(),
    };
    let ctx = ChatPersistErrorCtx {
        session_id: Some("sess-2".into()),
        project_id: Some("proj-2".into()),
        project_agent_id: Some("pa-2".into()),
    };
    let (status, Json(api_err)) = map_chat_persist_storage_error(err, ctx);
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(api_err.code, "chat_persist_failed");
    let data = api_err.data.expect("data must be populated");
    assert_eq!(data["upstream_status"], 503);
    let reason = data["reason"].as_str().unwrap();
    assert!(
        reason.starts_with("storage returned 503"),
        "reason should embed upstream status, got: {reason}"
    );
    assert_eq!(data["session_id"], "sess-2");
}

#[test]
fn map_chat_persist_storage_error_non_server_has_no_upstream_status() {
    let err = aura_os_storage::StorageError::NotConfigured;
    let (_, Json(api_err)) = map_chat_persist_storage_error(err, ChatPersistErrorCtx::default());
    assert_eq!(api_err.code, "chat_persist_failed");
    let data = api_err.data.expect("data populated");
    assert!(
        data["upstream_status"].is_null(),
        "no upstream HTTP status for non-Server storage errors"
    );
}
