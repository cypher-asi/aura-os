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
        self.post_authed(
            &format!("{}/api/processes", self.base_url),
            jwt,
            req,
        )
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

    pub async fn delete_process(
        &self,
        process_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
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
            &format!("{}/api/processes/{}/nodes/{}", self.base_url, process_id, node_id),
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
            &format!("{}/api/processes/{}/nodes/{}", self.base_url, process_id, node_id),
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
            &format!("{}/api/processes/{}/runs/{}", self.base_url, process_id, run_id),
            jwt,
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

    // -----------------------------------------------------------------------
    // Process Folders — public (JWT auth)
    // -----------------------------------------------------------------------

    pub async fn create_process_folder(
        &self,
        jwt: &str,
        req: &CreateProcessFolderRequest,
    ) -> Result<StorageProcessFolder, StorageError> {
        self.post_authed(
            &format!("{}/api/process-folders", self.base_url),
            jwt,
            req,
        )
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
        self.get_internal(
            &format!("{}/internal/processes/{}", self.base_url, process_id),
        )
        .await
    }

    pub async fn list_process_nodes_internal(
        &self,
        process_id: &str,
    ) -> Result<Vec<StorageProcessNode>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_internal(
            &format!("{}/internal/processes/{}/nodes", self.base_url, process_id),
        )
        .await
    }

    pub async fn list_process_connections_internal(
        &self,
        process_id: &str,
    ) -> Result<Vec<StorageProcessNodeConnection>, StorageError> {
        validate_url_id(process_id, "process_id")?;
        self.get_internal(
            &format!("{}/internal/processes/{}/connections", self.base_url, process_id),
        )
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
        self.get_internal(
            &format!("{}/internal/processes/scheduled", self.base_url),
        )
        .await
    }

    pub async fn create_process_run_internal(
        &self,
        req: &CreateProcessRunRequest,
    ) -> Result<StorageProcessRun, StorageError> {
        self.post_internal(
            &format!("{}/internal/process-runs", self.base_url),
            req,
        )
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
        self.post_internal(
            &format!("{}/internal/process-events", self.base_url),
            req,
        )
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
