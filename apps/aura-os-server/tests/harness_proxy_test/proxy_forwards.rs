use axum::http::StatusCode;
use serde_json::json;
use std::sync::Arc;
use tower::ServiceExt;

#[cfg(unix)]
use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest,
};

use super::common::*;
use super::mocks::start_mock_harness;
use super::HARNESS_URL_ENV_LOCK;

struct EnvVarReset(&'static str);

impl Drop for EnvVarReset {
    fn drop(&mut self) {
        unsafe {
            std::env::remove_var(self.0);
        }
    }
}

#[tokio::test]
async fn proxy_forwards_get_facts() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(
        body["echoed_uri"]
            .as_str()
            .unwrap()
            .contains(&format!("/api/agents/{agent}/memory/facts"))
    );
}

#[cfg(unix)]
#[tokio::test]
async fn project_memory_accepts_an_owned_session_before_project_discovery_is_warm() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
        std::env::set_var("AURA_STORAGE_TEST_USER_ID", "u1");
    }
    let _reset_url = EnvVarReset("LOCAL_HARNESS_URL");
    let _reset_user = EnvVarReset("AURA_STORAGE_TEST_USER_ID");

    let (app, state, storage, db, _dir) = build_test_app_with_storage_db().await;
    let agent_id = super::mocks::persist_test_agent(&state, "Project memory agent");
    let project_id = aura_os_core::ProjectId::new().to_string();
    let project_agent = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Project memory agent".into(),
                org_id: None,
                role: None,
                personality: None,
                system_prompt: None,
                skills: None,
                icon: None,
                harness: None,
                instance_role: None,
                source: Some("ui".into()),
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");
    let session = storage
        .create_session(
            &project_agent.id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project_id.clone(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create project session");
    storage
        .create_event(
            &session.id,
            TEST_JWT,
            &CreateSessionEventRequest {
                event_type: "user_message".into(),
                sender: Some("user".into()),
                project_id: Some(project_id.clone()),
                agent_id: Some(agent_id.to_string()),
                org_id: None,
                user_id: Some("u1".into()),
                content: Some(json!({ "text": "Remember this project context." })),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .expect("create project session event");
    db.lock()
        .await
        .session_users
        .insert(session.id, "u1".into());

    let req = json_request(
        "GET",
        &format!(
            "/api/harness/agents/{agent_id}/memory/facts?project_id={project_id}&user_id=spoofed"
        ),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let echoed_uri = body["echoed_uri"].as_str().unwrap();
    assert!(echoed_uri.contains(&format!("project_id={project_id}")));
    assert!(echoed_uri.contains("user_id=u1"));
    assert!(!echoed_uri.contains("spoofed"));
}

#[tokio::test]
async fn hosted_proxy_without_transport_auth_fails_closed() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    unsafe {
        std::env::set_var(
            "LOCAL_HARNESS_URL",
            "https://aura-harness-latest.onrender.com",
        );
        std::env::remove_var("LOCAL_HARNESS_AUTH_TOKEN");
    }
    let _reset_url = EnvVarReset("LOCAL_HARNESS_URL");
    let _reset_auth = EnvVarReset("LOCAL_HARNESS_AUTH_TOKEN");

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn hosted_direct_harness_path_without_transport_auth_fails_closed() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    unsafe {
        std::env::set_var(
            "LOCAL_HARNESS_URL",
            "https://aura-harness-latest.onrender.com",
        );
        std::env::remove_var("LOCAL_HARNESS_AUTH_TOKEN");
    }
    let _reset_url = EnvVarReset("LOCAL_HARNESS_URL");
    let _reset_auth = EnvVarReset("LOCAL_HARNESS_AUTH_TOKEN");

    let (app, _, _db) = build_test_app_with_mocks().await;
    let req = json_request("GET", "/api/harness/skills", None);
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn proxy_with_transport_auth_rejects_unowned_agent_before_forwarding() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
        std::env::set_var("LOCAL_HARNESS_AUTH_TOKEN", "harness-secret");
    }
    let _reset_url = EnvVarReset("LOCAL_HARNESS_URL");
    let _reset_auth = EnvVarReset("LOCAL_HARNESS_AUTH_TOKEN");

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn proxy_with_transport_auth_allows_network_owned_agent() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let network_url = super::mocks::start_mock_network_serving_agent(agent.to_string()).await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
        std::env::set_var("LOCAL_HARNESS_AUTH_TOKEN", "harness-secret");
    }
    let _reset_url = EnvVarReset("LOCAL_HARNESS_URL");
    let _reset_auth = EnvVarReset("LOCAL_HARNESS_AUTH_TOKEN");

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (app, _) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(aura_os_network::NetworkClient::with_base_url(
            &network_url,
        ))),
        None,
        None,
        None,
    );

    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert_eq!(
        body["echoed_authorization"].as_str(),
        Some("Bearer harness-secret")
    );
    assert!(
        body["echoed_uri"]
            .as_str()
            .unwrap()
            .contains(&format!("/api/agents/{agent}/memory/facts"))
    );
}

#[cfg(unix)]
#[tokio::test]
async fn proxy_with_transport_auth_allows_local_shadow_agent() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
        std::env::set_var("LOCAL_HARNESS_AUTH_TOKEN", "harness-secret");
    }
    let _reset_url = EnvVarReset("LOCAL_HARNESS_URL");
    let _reset_auth = EnvVarReset("LOCAL_HARNESS_AUTH_TOKEN");

    let (app, state, _db) = build_test_app();
    let agent = super::mocks::persist_test_agent(&state, "local proxy");
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(
        body["echoed_uri"]
            .as_str()
            .unwrap()
            .contains(&format!("/api/agents/{agent}/memory/facts"))
    );
}

#[cfg(unix)]
#[tokio::test]
async fn proxy_with_transport_auth_rejects_unowned_local_shadow_agent() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
        std::env::set_var("LOCAL_HARNESS_AUTH_TOKEN", "harness-secret");
    }
    let _reset_url = EnvVarReset("LOCAL_HARNESS_URL");
    let _reset_auth = EnvVarReset("LOCAL_HARNESS_AUTH_TOKEN");

    let (app, state, _db) = build_test_app();
    let agent =
        super::mocks::persist_test_agent_for_user(&state, "someone else's proxy", "other-user");
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn proxy_forwards_post_with_body() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let payload = json!({"key": "lang", "value": "Rust", "confidence": 0.9});
    let req = json_request(
        "POST",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        Some(payload.clone()),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
    let echoed_body: serde_json::Value =
        serde_json::from_str(body["echoed_body"].as_str().unwrap()).unwrap();
    assert_eq!(echoed_body["key"], "lang");
}

#[tokio::test]
async fn proxy_forwards_continuity_config_and_retrieval_evidence() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let config = json!({
        "use_memory": true,
        "generate_memory": true,
        "write_policy": "approval",
        "retrieval_mode": "query_aware",
        "allow_user_scope": false,
        "allow_workspace_scope": false
    });
    let req = json_request(
        "PUT",
        &format!("/api/harness/agents/{agent}/memory/continuity"),
        Some(config.clone()),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "PUT");
    assert!(body["echoed_uri"]
        .as_str()
        .unwrap()
        .contains(&format!("/api/agents/{agent}/memory/continuity")));
    let echoed_config: serde_json::Value =
        serde_json::from_str(body["echoed_body"].as_str().unwrap()).unwrap();
    assert_eq!(echoed_config, config);

    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/retrieval/latest"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    let echoed_uri = body["echoed_uri"].as_str().unwrap();
    assert!(echoed_uri.contains(&format!("/api/agents/{agent}/memory/retrieval/latest")));
    assert!(echoed_uri.contains("user_id=u1"));
}

#[tokio::test]
async fn proxy_forwards_delete() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "DELETE",
        &format!("/api/harness/agents/{agent}/memory/facts/f1"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "DELETE");
    assert!(
        body["echoed_uri"]
            .as_str()
            .unwrap()
            .contains(&format!("/api/agents/{agent}/memory/facts/f1"))
    );
}

#[tokio::test]
async fn proxy_forwards_skills_list() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let req = json_request("GET", "/api/harness/skills", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(body["echoed_uri"].as_str().unwrap().contains("/api/skills"));
}

#[tokio::test]
async fn proxy_forwards_skill_activate() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let payload = json!({"arguments": "production us-east-1"});
    let req = json_request("POST", "/api/harness/skills/deploy/activate", Some(payload));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
    assert!(
        body["echoed_uri"]
            .as_str()
            .unwrap()
            .contains("/api/skills/deploy/activate")
    );
}

#[tokio::test]
async fn proxy_forwards_agent_skills_list() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("GET", &format!("/api/harness/agents/{agent}/skills"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(
        body["echoed_uri"]
            .as_str()
            .unwrap()
            .contains(&format!("/api/agents/{agent}/skills"))
    );
}

#[tokio::test]
async fn proxy_forwards_agent_skill_install() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let payload = json!({"name": "deploy", "source_url": null});
    let req = json_request(
        "POST",
        &format!("/api/harness/agents/{agent}/skills"),
        Some(payload),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
}

#[tokio::test]
async fn proxy_forwards_agent_skill_uninstall() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "DELETE",
        &format!("/api/harness/agents/{agent}/skills/deploy"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "DELETE");
    assert!(
        body["echoed_uri"]
            .as_str()
            .unwrap()
            .contains(&format!("/api/agents/{agent}/skills/deploy"))
    );
}

#[tokio::test]
async fn proxy_forwards_procedures_by_skill() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/procedures/by-skill/deploy"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    let uri = body["echoed_uri"].as_str().unwrap();
    assert!(uri.contains("/api/agents/"));
    assert!(uri.contains("/memory/procedures"));
    assert!(uri.contains("skill=deploy"));
}
