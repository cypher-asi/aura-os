use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    // -----------------------------------------------------------------------
    // Processes — public (JWT auth)
    // -----------------------------------------------------------------------

    pub async fn create_process(
        &self,
        jwt: &str,
        req: &CreateProcessRequest,
    ) -> Result<StorageProcess, StorageError> {
        self.post_authed(&format!("{}/api/processes", self.base_url), jwt, req)
            .await
    }

    pub async fn list_processes(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProcess>, StorageError> {
        validate_url_id(org_id, "org_id")?;
        self.get_authed(
            &format!("{}/api/processes?orgId={}", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn get_process(
        &self,
        process_id: &str,
        jwt: &str,
    ) -> Result<StorageProcess, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_authed(
            &format!("{}/api/processes/{}", self.base_url, process_id),
            jwt,
        )
        .await
    }

    pub async fn update_process(
        &self,
        process_id: &str,
        jwt: &str,
        req: &UpdateProcessRequest,
    ) -> Result<StorageProcess, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.put_authed(
            &format!("{}/api/processes/{}", self.base_url, process_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_process(&self, process_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.delete_authed(
            &format!("{}/api/processes/{}", self.base_url, process_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Process Nodes — public (JWT auth)
    // -----------------------------------------------------------------------

    pub async fn create_process_node(
        &self,
        process_id: &str,
        jwt: &str,
        req: &CreateProcessNodeRequest,
    ) -> Result<StorageProcessNode, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.post_authed(
            &format!("{}/api/processes/{}/nodes", self.base_url, process_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_process_nodes(
        &self,
        process_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProcessNode>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_authed(
            &format!("{}/api/processes/{}/nodes", self.base_url, process_id),
            jwt,
        )
        .await
    }

    pub async fn update_process_node(
        &self,
        process_id: &str,
        node_id: &str,
        jwt: &str,
        req: &UpdateProcessNodeRequest,
    ) -> Result<StorageProcessNode, StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(node_id, "node_id")?;
        self.put_authed(
            &format!(
                "{}/api/processes/{}/nodes/{}",
                self.base_url, process_id, node_id
            ),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_process_node(
        &self,
        process_id: &str,
        node_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(node_id, "node_id")?;
        self.delete_authed(
            &format!(
                "{}/api/processes/{}/nodes/{}",
                self.base_url, process_id, node_id
            ),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Process Connections — public (JWT auth)
    // -----------------------------------------------------------------------

    pub async fn create_process_connection(
        &self,
        process_id: &str,
        jwt: &str,
        req: &CreateProcessConnectionRequest,
    ) -> Result<StorageProcessNodeConnection, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.post_authed(
            &format!("{}/api/processes/{}/connections", self.base_url, process_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_process_connections(
        &self,
        process_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProcessNodeConnection>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_authed(
            &format!("{}/api/processes/{}/connections", self.base_url, process_id),
            jwt,
        )
        .await
    }

    pub async fn delete_process_connection(
        &self,
        process_id: &str,
        connection_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(connection_id, "connection_id")?;
        self.delete_authed(
            &format!(
                "{}/api/processes/{}/connections/{}",
                self.base_url, process_id, connection_id
            ),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Process Runs — public (JWT auth, read-only)
    // -----------------------------------------------------------------------

    pub async fn list_process_runs(
        &self,
        process_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProcessRun>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_authed(
            &format!("{}/api/processes/{}/runs", self.base_url, process_id),
            jwt,
        )
        .await
    }

    pub async fn get_process_run(
        &self,
        process_id: &str,
        run_id: &str,
        jwt: &str,
    ) -> Result<StorageProcessRun, StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(run_id, "run_id")?;
        self.get_authed(
            &format!(
                "{}/api/processes/{}/runs/{}",
                self.base_url, process_id, run_id
            ),
            jwt,
        )
        .await
    }

    pub async fn create_process_run(
        &self,
        process_id: &str,
        jwt: &str,
        req: &CreateProcessRunRequest,
    ) -> Result<StorageProcessRun, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.post_authed(
            &format!("{}/api/processes/{}/runs", self.base_url, process_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn update_process_run(
        &self,
        process_id: &str,
        run_id: &str,
        jwt: &str,
        req: &UpdateProcessRunRequest,
    ) -> Result<StorageProcessRun, StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(run_id, "run_id")?;
        self.put_authed(
            &format!(
                "{}/api/processes/{}/runs/{}",
                self.base_url, process_id, run_id
            ),
            jwt,
            req,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Process Run Events — public (JWT auth, read-only)
    // -----------------------------------------------------------------------

    pub async fn list_process_run_events(
        &self,
        process_id: &str,
        run_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProcessEvent>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(run_id, "run_id")?;
        self.get_authed(
            &format!(
                "{}/api/processes/{}/runs/{}/events",
                self.base_url, process_id, run_id
            ),
            jwt,
        )
        .await
    }

    pub async fn create_process_event(
        &self,
        process_id: &str,
        run_id: &str,
        jwt: &str,
        req: &CreateProcessEventRequest,
    ) -> Result<StorageProcessEvent, StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(run_id, "run_id")?;
        self.post_authed(
            &format!(
                "{}/api/processes/{}/runs/{}/events",
                self.base_url, process_id, run_id
            ),
            jwt,
            req,
        )
        .await
    }

    pub async fn update_process_event(
        &self,
        event_id: &str,
        jwt: &str,
        req: &UpdateProcessEventRequest,
    ) -> Result<StorageProcessEvent, StorageError> {
        validate_url_id(event_id, "event_id")?;
        self.put_authed(
            &format!("{}/api/process-events/{}", self.base_url, event_id),
            jwt,
            req,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Process Run Artifacts — public (JWT auth, read-only)
    // -----------------------------------------------------------------------

    pub async fn list_process_run_artifacts(
        &self,
        process_id: &str,
        run_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProcessArtifact>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(run_id, "run_id")?;
        self.get_authed(
            &format!(
                "{}/api/processes/{}/runs/{}/artifacts",
                self.base_url, process_id, run_id
            ),
            jwt,
        )
        .await
    }

    pub async fn get_process_artifact(
        &self,
        artifact_id: &str,
        jwt: &str,
    ) -> Result<StorageProcessArtifact, StorageError> {
        validate_url_id(artifact_id, "artifact_id")?;
        self.get_authed(
            &format!("{}/api/process-artifacts/{}", self.base_url, artifact_id),
            jwt,
        )
        .await
    }

    pub async fn create_process_artifact(
        &self,
        process_id: &str,
        run_id: &str,
        jwt: &str,
        req: &CreateProcessArtifactRequest,
    ) -> Result<StorageProcessArtifact, StorageError> {
        validate_url_id(process_id, "process_id")?;
        validate_url_id(run_id, "run_id")?;
        self.post_authed(
            &format!(
                "{}/api/processes/{}/runs/{}/artifacts",
                self.base_url, process_id, run_id
            ),
            jwt,
            req,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Process Folders — public (JWT auth)
    // -----------------------------------------------------------------------

    pub async fn create_process_folder(
        &self,
        jwt: &str,
        req: &CreateProcessFolderRequest,
    ) -> Result<StorageProcessFolder, StorageError> {
        self.post_authed(&format!("{}/api/process-folders", self.base_url), jwt, req)
            .await
    }

    pub async fn list_process_folders(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProcessFolder>, StorageError> {
        validate_url_id(org_id, "org_id")?;
        self.get_authed(
            &format!("{}/api/process-folders?orgId={}", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn update_process_folder(
        &self,
        folder_id: &str,
        jwt: &str,
        req: &UpdateProcessFolderRequest,
    ) -> Result<StorageProcessFolder, StorageError> {
        validate_url_id(folder_id, "folder_id")?;
        self.put_authed(
            &format!("{}/api/process-folders/{}", self.base_url, folder_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_process_folder(
        &self,
        folder_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(folder_id, "folder_id")?;
        self.delete_authed(
            &format!("{}/api/process-folders/{}", self.base_url, folder_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Processes — internal (X-Internal-Token auth, for executor/scheduler)
    // -----------------------------------------------------------------------

    pub async fn get_process_internal(
        &self,
        process_id: &str,
    ) -> Result<StorageProcess, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_internal(&format!(
            "{}/internal/processes/{}",
            self.base_url, process_id
        ))
        .await
    }

    pub async fn list_process_nodes_internal(
        &self,
        process_id: &str,
    ) -> Result<Vec<StorageProcessNode>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_internal(&format!(
            "{}/internal/processes/{}/nodes",
            self.base_url, process_id
        ))
        .await
    }

    pub async fn list_process_connections_internal(
        &self,
        process_id: &str,
    ) -> Result<Vec<StorageProcessNodeConnection>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_internal(&format!(
            "{}/internal/processes/{}/connections",
            self.base_url, process_id
        ))
        .await
    }

    pub async fn update_process_internal(
        &self,
        process_id: &str,
        req: &UpdateProcessRequest,
    ) -> Result<StorageProcess, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.put_internal(
            &format!("{}/internal/processes/{}", self.base_url, process_id),
            req,
        )
        .await
    }

    pub async fn list_scheduled_processes_internal(
        &self,
    ) -> Result<Vec<StorageProcess>, StorageError> {
        self.get_internal(&format!("{}/internal/processes/scheduled", self.base_url))
            .await
    }

    pub async fn create_process_run_internal(
        &self,
        req: &CreateProcessRunRequest,
    ) -> Result<StorageProcessRun, StorageError> {
        self.post_internal(&format!("{}/internal/process-runs", self.base_url), req)
            .await
    }

    pub async fn update_process_run_internal(
        &self,
        run_id: &str,
        req: &UpdateProcessRunRequest,
    ) -> Result<StorageProcessRun, StorageError> {
        validate_url_id(run_id, "run_id")?;
        self.put_internal(
            &format!("{}/internal/process-runs/{}", self.base_url, run_id),
            req,
        )
        .await
    }

    pub async fn create_process_event_internal(
        &self,
        req: &CreateProcessEventRequest,
    ) -> Result<StorageProcessEvent, StorageError> {
        self.post_internal(&format!("{}/internal/process-events", self.base_url), req)
            .await
    }

    pub async fn update_process_event_internal(
        &self,
        event_id: &str,
        req: &UpdateProcessEventRequest,
    ) -> Result<StorageProcessEvent, StorageError> {
        validate_url_id(event_id, "event_id")?;
        self.put_internal(
            &format!("{}/internal/process-events/{}", self.base_url, event_id),
            req,
        )
        .await
    }

    pub async fn create_process_artifact_internal(
        &self,
        req: &CreateProcessArtifactRequest,
    ) -> Result<StorageProcessArtifact, StorageError> {
        self.post_internal(
            &format!("{}/internal/process-artifacts", self.base_url),
            req,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use axum::extract::Path;
    use axum::http::{header, HeaderMap, StatusCode};
    use axum::routing::{post, put};
    use axum::{Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    use super::*;

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
