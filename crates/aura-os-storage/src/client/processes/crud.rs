//! Public (JWT-authenticated) CRUD on processes, nodes, connections,
//! and folders. The hot-path CRUD live here; runs/events/artifacts are
//! in `runs.rs` and the executor/scheduler counterparts are in
//! `internal.rs`.

use crate::client::{validate_url_id, StorageClient};
use crate::error::StorageError;
use crate::types::{
    CreateProcessConnectionRequest, CreateProcessFolderRequest, CreateProcessNodeRequest,
    CreateProcessRequest, StorageProcess, StorageProcessFolder, StorageProcessNode,
    StorageProcessNodeConnection, UpdateProcessFolderRequest, UpdateProcessNodeRequest,
    UpdateProcessRequest,
};

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
}
