use crate::{HarnessAutomatonStartParams, HarnessClient, HarnessClientError};

#[tokio::test]
async fn process_trigger_cannot_start_unrelated_project_tasks() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let params = HarnessAutomatonStartParams {
        kind: "scheduled_process".into(),
        project_id: "project".into(),
        auth_token: None,
        process_id: Some("process".into()),
        model: Some("model".into()),
        input: Some(serde_json::json!({"run_id":"logical-run"})),
        aura_org_id: Some("org".into()),
        aura_session_id: Some("session".into()),
    };
    let result = HarnessClient::new(format!("http://{}", listener.local_addr().unwrap()))
        .start_automaton(&params, None)
        .await;
    assert!(matches!(
        result,
        Err(HarnessClientError::Status { status: 501, .. })
    ));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), listener.accept())
            .await
            .is_err(),
        "a rejected process must not issue POST /v1/run"
    );
}
