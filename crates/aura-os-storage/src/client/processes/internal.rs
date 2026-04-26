//! Internal (`X-Internal-Token`) endpoints used by the executor and
//! scheduler. These bypass JWT auth in favour of a shared secret and
//! return the same shapes as the public routes.

use crate::client::{validate_url_id, StorageClient};
use crate::error::StorageError;
use crate::types::{
    CreateProcessArtifactRequest, CreateProcessEventRequest, CreateProcessRunRequest,
    StorageProcess, StorageProcessArtifact, StorageProcessEvent, StorageProcessNode,
    StorageProcessNodeConnection, StorageProcessRun, UpdateProcessEventRequest,
    UpdateProcessRequest, UpdateProcessRunRequest,
};

impl StorageClient {
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
