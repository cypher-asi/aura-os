//! Storage-side `StorageClient` HTTP wrappers for the Process / Run /
//! Event / Artifact / Folder graph. Split by concern:
//!
//! * [`crud`] — public (JWT) CRUD on processes, nodes, connections and
//!   folders.
//! * [`runs`] — public (JWT) CRUD on runs, events, and artifacts.
//! * [`internal`] — `X-Internal-Token` scoped endpoints used by the
//!   executor / scheduler.

mod crud;
mod internal;
mod runs;

#[cfg(test)]
mod tests {
    use crate::client::StorageClient;
    use crate::types::{
        CreateProcessArtifactRequest, CreateProcessEventRequest, CreateProcessRunRequest,
        UpdateProcessEventRequest, UpdateProcessRunRequest,
    };
    use axum::extract::Path;
    use axum::http::{header, HeaderMap, StatusCode};
    use axum::routing::{post, put};
    use axum::{Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    fn assert_bearer(headers: &HeaderMap) {
        assert_eq!(
            headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer jwt-123")
        );
    }

    async fn start_mock_server() -> String {
        let app = Router::new()
            .route(
                "/api/processes/:process_id/runs",
                post(
                    |Path(process_id): Path<String>,
                     headers: HeaderMap,
                     Json(body): Json<CreateProcessRunRequest>| async move {
                        assert_bearer(&headers);
                        (
                            StatusCode::OK,
                            Json(json!({
                                "id": body.id.unwrap_or_else(|| "run-1".to_string()),
                                "processId": process_id,
                                "status": "pending"
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/processes/:process_id/runs/:run_id",
                put(
                    |Path((process_id, run_id)): Path<(String, String)>,
                     headers: HeaderMap,
                     Json(_body): Json<UpdateProcessRunRequest>| async move {
                        assert_bearer(&headers);
                        (
                            StatusCode::OK,
                            Json(json!({
                                "id": run_id,
                                "processId": process_id,
                                "status": "running"
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/processes/:process_id/runs/:run_id/events",
                post(
                    |Path((process_id, run_id)): Path<(String, String)>,
                     headers: HeaderMap,
                     Json(body): Json<CreateProcessEventRequest>| async move {
                        assert_bearer(&headers);
                        (
                            StatusCode::OK,
                            Json(json!({
                                "id": body.id.unwrap_or_else(|| "event-1".to_string()),
                                "processId": process_id,
                                "runId": run_id,
                                "status": "running"
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/process-events/:event_id",
                put(
                    |Path(event_id): Path<String>,
                     headers: HeaderMap,
                     Json(_body): Json<UpdateProcessEventRequest>| async move {
                        assert_bearer(&headers);
                        (
                            StatusCode::OK,
                            Json(json!({
                                "id": event_id,
                                "status": "completed"
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/processes/:process_id/runs/:run_id/artifacts",
                post(
                    |Path((process_id, run_id)): Path<(String, String)>,
                     headers: HeaderMap,
                     Json(body): Json<CreateProcessArtifactRequest>| async move {
                        assert_bearer(&headers);
                        (
                            StatusCode::OK,
                            Json(json!({
                                "id": body.id.unwrap_or_else(|| "artifact-1".to_string()),
                                "processId": process_id,
                                "runId": run_id,
                                "name": body.name,
                                "artifactType": body.artifact_type
                            })),
                        )
                    },
                ),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn public_process_sync_methods_use_bearer_routes() {
        let base_url = start_mock_server().await;
        let client = StorageClient::with_base_url(&base_url);

        let run = client
            .create_process_run(
                "process-1",
                "jwt-123",
                &CreateProcessRunRequest {
                    id: Some("run-1".to_string()),
                    process_id: "process-1".to_string(),
                    trigger: Some("manual".to_string()),
                    parent_run_id: None,
                    input_override: None,
                },
            )
            .await
            .expect("create run");
        assert_eq!(run.id.as_str(), "run-1");

        let updated_run = client
            .update_process_run(
                "process-1",
                "run-1",
                "jwt-123",
                &UpdateProcessRunRequest {
                    status: Some("running".to_string()),
                    ..Default::default()
                },
            )
            .await
            .expect("update run");
        assert_eq!(updated_run.status.as_deref(), Some("running"));

        let event = client
            .create_process_event(
                "process-1",
                "run-1",
                "jwt-123",
                &CreateProcessEventRequest {
                    id: Some("event-1".to_string()),
                    run_id: "run-1".to_string(),
                    node_id: "node-1".to_string(),
                    process_id: "process-1".to_string(),
                    status: Some("running".to_string()),
                    input_snapshot: None,
                    output: None,
                },
            )
            .await
            .expect("create event");
        assert_eq!(event.id.as_str(), "event-1");

        let updated_event = client
            .update_process_event(
                "event-1",
                "jwt-123",
                &UpdateProcessEventRequest {
                    status: Some("completed".to_string()),
                    ..Default::default()
                },
            )
            .await
            .expect("update event");
        assert_eq!(updated_event.status.as_deref(), Some("completed"));

        let artifact = client
            .create_process_artifact(
                "process-1",
                "run-1",
                "jwt-123",
                &CreateProcessArtifactRequest {
                    id: Some("artifact-1".to_string()),
                    process_id: "process-1".to_string(),
                    run_id: "run-1".to_string(),
                    node_id: "node-1".to_string(),
                    artifact_type: "report".to_string(),
                    name: "output.md".to_string(),
                    file_path: "process/output.md".to_string(),
                    size_bytes: Some(128),
                    metadata: None,
                },
            )
            .await
            .expect("create artifact");
        assert_eq!(artifact.id.as_str(), "artifact-1");
        assert_eq!(artifact.name.as_deref(), Some("output.md"));
    }
}
