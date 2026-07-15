#![cfg(unix)]

use aura_os_core::ProjectId;
use aura_os_storage::{CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest};
use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mocks::{persist_test_agent, start_recording_mock_harness};
use super::HARNESS_URL_ENV_LOCK;

#[tokio::test]
async fn self_improvement_proposal_lifecycle_applies_memory_fact() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, state, _db) = build_test_app_with_mocks().await;
    let agent_id = persist_test_agent(&state, "Learning Agent");

    let req = json_request(
        "GET",
        &format!("/api/agents/{agent_id}/self-improvement"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["mode"], "off");

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/improvements/propose"),
        Some(json!({
            "kind": "memory_fact",
            "title": "Remember package manager",
            "rationale": "The agent should reuse the user's repo convention.",
            "payload": {
                "key": "repo.package_manager",
                "value": "pnpm",
                "confidence": 0.9
            }
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let req = json_request(
        "PUT",
        &format!("/api/agents/{agent_id}/self-improvement"),
        Some(json!({
            "mode": "propose",
            "allow_memory": true,
            "allow_skills": true
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["mode"], "propose");

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/improvements/propose"),
        Some(json!({
            "kind": "memory_fact",
            "title": "Remember package manager",
            "rationale": "The agent should reuse the user's repo convention.",
            "payload": {
                "key": "repo.package_manager",
                "value": "pnpm",
                "confidence": 0.9
            }
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let proposal = response_json(resp).await;
    assert_eq!(proposal["status"], "pending");
    let proposal_id = proposal["id"].as_str().unwrap();

    let req = json_request(
        "GET",
        &format!("/api/agents/{agent_id}/improvements?status=pending"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let pending = response_json(resp).await;
    assert_eq!(pending.as_array().unwrap().len(), 1);

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/improvements/{proposal_id}/apply"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let applied = response_json(resp).await;
    assert_eq!(applied["status"], "applied");

    let captured = calls.lock().unwrap().clone();
    let memory_call = captured
        .iter()
        .find(|(uri, _)| uri.starts_with(&format!("/api/agents/{agent_id}/memory/facts?")))
        .expect("expected memory fact POST");
    assert!(memory_call.0.contains("user_id="));
    let memory_body: serde_json::Value =
        serde_json::from_str(&memory_call.1).expect("memory body is valid JSON");
    assert_eq!(memory_body["key"], "repo.package_manager");
    assert_eq!(memory_body["value"], "pnpm");
    assert_eq!(memory_body["confidence"], 0.9);
}

#[tokio::test]
async fn learning_review_stages_evidence_backed_proposal_from_session_history() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
        std::env::set_var("AURA_STORAGE_TEST_USER_ID", "u1");
    }

    let (app, state, storage, db, _dir) = build_test_app_with_storage_db().await;
    let agent_id = persist_test_agent(&state, "Learning Review Agent");
    let project_id = ProjectId::new().to_string();
    let project_agent = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Learning Review Agent".into(),
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
        .expect("create session");
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
                content: Some(json!({
                    "text": "For future reference, this repo uses pnpm as the package manager."
                })),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .expect("create session event");
    db.lock()
        .await
        .session_users
        .insert(session.id.clone(), "u1".into());

    let req = json_request(
        "PUT",
        &format!("/api/agents/{agent_id}/self-improvement"),
        Some(json!({
            "mode": "propose",
            "allow_memory": true,
            "allow_skills": true,
            "allow_background_review": true
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/improvements/review"),
        Some(json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let review = response_json(resp).await;
    assert_eq!(review["scanned_sessions"], 1);
    assert_eq!(review["created_proposals"], 1);
    let proposal = &review["proposals"][0];
    assert_eq!(proposal["kind"], "memory_fact");
    assert_eq!(proposal["status"], "pending");
    assert_eq!(proposal["provenance"]["source"], "learning_review");
    assert_eq!(
        proposal["evidence"][0]["session_id"].as_str(),
        Some(session.id.as_str())
    );
    assert!(proposal["evidence"][0]["quote"]
        .as_str()
        .unwrap()
        .contains("For future reference"));
    assert!(proposal["dedup_key"]
        .as_str()
        .unwrap()
        .starts_with("learning_review:"));

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/improvements/review"),
        Some(json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let second_review = response_json(resp).await;
    assert_eq!(second_review["created_proposals"], 0);
    assert_eq!(second_review["skipped_existing"], 1);

    let proposal_id = proposal["id"].as_str().unwrap();
    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/improvements/{proposal_id}/apply"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let applied = response_json(resp).await;
    assert_eq!(applied["status"], "applied");

    let captured = calls.lock().unwrap().clone();
    let memory_call = captured
        .iter()
        .find(|(uri, _)| uri.starts_with(&format!("/api/agents/{agent_id}/memory/facts?")))
        .expect("expected memory fact POST");
    assert!(memory_call.0.contains(&format!("project_id={project_id}")));
    assert!(memory_call.0.contains("user_id=u1"));
    let memory_body: serde_json::Value =
        serde_json::from_str(&memory_call.1).expect("memory body is valid JSON");
    assert_eq!(
        memory_body["value"],
        "this repo uses pnpm as the package manager."
    );
}
