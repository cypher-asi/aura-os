//! Public (JWT-authenticated) CRUD on process runs, run events, and
//! run artifacts.

use crate::client::{validate_url_id, StorageClient};
use crate::error::StorageError;
use crate::types::{
    CreateProcessArtifactRequest, CreateProcessEventRequest, CreateProcessRunRequest,
    StorageProcessArtifact, StorageProcessEvent, StorageProcessRun, UpdateProcessEventRequest,
    UpdateProcessRunRequest,
};

impl StorageClient {
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
}
