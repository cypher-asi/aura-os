mod file_handlers;
mod shell_handlers;
mod spec_handlers;
mod task_handlers;

#[cfg(test)]
mod handler_tests;

use std::path::Path;

use serde_json::{json, Value};

use aura_core::*;
use aura_projects::UpdateProjectInput;

use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};

// ---------------------------------------------------------------------------
// Shared utility helpers
// ---------------------------------------------------------------------------

pub(crate) fn str_field(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

pub(crate) fn parse_id<T: std::str::FromStr>(input: &Value, key: &str) -> Result<T, ToolExecResult>
where
    T::Err: std::fmt::Display,
{
    let s = str_field(input, key)
        .ok_or_else(|| ToolExecResult::err(format!("Missing required field: {key}")))?;
    s.parse::<T>()
        .map_err(|e| ToolExecResult::err(format!("Invalid {key}: {e}")))
}

pub(crate) fn lexical_normalize(path: &Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// ChatToolExecutor shared helpers
// ---------------------------------------------------------------------------

impl ChatToolExecutor {
    pub(crate) fn get_jwt(&self) -> Result<String, ToolExecResult> {
        self.store
            .get_jwt()
            .ok_or_else(|| ToolExecResult::err("no active session"))
    }

    pub(crate) fn require_storage(
        &self,
    ) -> Result<&std::sync::Arc<aura_storage::StorageClient>, ToolExecResult> {
        self.storage_client
            .as_ref()
            .ok_or_else(|| ToolExecResult::err("aura-storage is not configured"))
    }

    /// Combined accessor: returns both a storage client reference and a JWT
    /// token, short-circuiting with a `ToolExecResult` error on failure.
    pub(crate) fn storage_and_jwt(
        &self,
    ) -> Result<(&std::sync::Arc<aura_storage::StorageClient>, String), ToolExecResult> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        Ok((storage, jwt))
    }

    pub(crate) async fn resolve_project_path(
        &self,
        project_id: &ProjectId,
        rel: &str,
    ) -> Result<std::path::PathBuf, ToolExecResult> {
        let project = self
            .project_service
            .get_project_async(project_id)
            .await
            .map_err(|e| ToolExecResult::err(format!("Project not found: {e:?}")))?;
        let base = Path::new(&project.linked_folder_path);
        let target = base.join(rel);

        let norm_base = lexical_normalize(base);
        let norm_target = lexical_normalize(&target);
        if !norm_target.starts_with(&norm_base) {
            return Err(ToolExecResult::err(format!(
                "Path escape: {rel} resolves outside the project folder"
            )));
        }
        Ok(norm_target)
    }

    // -------------------------------------------------------------------
    // Project operations (small, kept here)
    // -------------------------------------------------------------------

    pub(crate) async fn get_project(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.project_service.get_project_async(project_id).await {
            Ok(p) => ToolExecResult::ok(json!(p)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }

    pub(crate) async fn update_project(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
        let update = UpdateProjectInput {
            name: str_field(input, "name"),
            description: str_field(input, "description"),
            linked_folder_path: None,
            workspace_source: None,
            workspace_display_path: None,
            build_command: str_field(input, "build_command"),
            test_command: str_field(input, "test_command"),
        };
        match self
            .project_service
            .update_project_async(project_id, update)
            .await
        {
            Ok(p) => ToolExecResult::ok(json!(p)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }
}
