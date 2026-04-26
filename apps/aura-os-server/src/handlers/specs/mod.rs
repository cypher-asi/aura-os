//! HTTP handlers for the spec resource. Specs live in aura-storage; this
//! module mirrors them onto disk for the dev-loop / harness sessions and
//! exposes both project-scoped and flat (`/api/specs/:id`) routes plus
//! the streaming spec-generation flow.

use std::collections::HashMap;
use std::path::Path as StdPath;
use std::time::Duration;

use serde::Deserialize;
use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, Spec};

use super::projects_helpers::resolve_project_tool_workspace_path;
use super::spec_disk::mirror_spec_to_disk;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

mod crud;
mod gen;

pub(crate) use crud::{
    create_spec, delete_spec, delete_spec_flat, get_spec, get_spec_flat, list_specs, update_spec,
    update_spec_flat,
};
pub(crate) use gen::{generate_specs, generate_specs_stream, generate_specs_summary};

const SPEC_RESULT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SPEC_RESULT_POLL_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SpecQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateSpecBody {
    pub title: String,
    #[serde(alias = "markdown_contents")]
    pub markdown_contents: Option<String>,
    #[serde(alias = "order_index")]
    pub order_index: Option<i32>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateSpecBody {
    pub title: Option<String>,
    #[serde(alias = "order_index")]
    pub order_index: Option<i32>,
    #[serde(alias = "markdown_contents")]
    pub markdown_contents: Option<String>,
}

/// Resolve a local filesystem workspace root for disk-mirroring a spec.
/// Scopes to a specific agent instance when one is supplied, otherwise falls
/// back to the project's `local` machine workspace so aura-os-server-driven
/// calls still land on disk.
pub(super) async fn resolve_spec_workspace(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> Option<String> {
    resolve_project_tool_workspace_path(state, project_id, HarnessMode::Local, agent_instance_id)
        .await
}

pub(super) async fn mirror_spec_best_effort(
    workspace_root: &str,
    old_title: Option<&str>,
    new_title: &str,
    markdown: &str,
) {
    match mirror_spec_to_disk(StdPath::new(workspace_root), old_title, new_title, markdown).await {
        Ok(path) => info!(path = %path.display(), "spec mirrored to disk"),
        Err(err) => warn!(workspace = %workspace_root, %err, "failed to mirror spec to disk"),
    }
}

pub(super) async fn load_generated_specs(
    state: &AppState,
    project_id: &ProjectId,
    jwt: &str,
) -> ApiResult<Vec<Spec>> {
    let storage = state.require_storage_client()?;
    let started_at = tokio::time::Instant::now();
    let mut specs: Vec<Spec> = loop {
        let storage_specs = storage
            .list_specs(&project_id.to_string(), jwt)
            .await
            .map_err(|e| ApiError::internal(format!("listing specs: {e}")))?;
        let specs: Vec<Spec> = storage_specs
            .into_iter()
            .filter_map(|s| Spec::try_from(s).ok())
            .collect();
        if !specs.is_empty() || started_at.elapsed() >= SPEC_RESULT_POLL_TIMEOUT {
            break specs;
        }
        tokio::time::sleep(SPEC_RESULT_POLL_INTERVAL).await;
    };
    specs.sort_by_key(|s| s.order_index);
    Ok(specs)
}

pub(super) fn specs_changed_since(before: &[Spec], after: &[Spec]) -> bool {
    if before.len() != after.len() {
        return true;
    }

    let before_versions: HashMap<_, _> = before
        .iter()
        .map(|spec| (spec.spec_id, spec.updated_at))
        .collect();

    after.iter().any(|spec| {
        before_versions
            .get(&spec.spec_id)
            .map_or(true, |updated_at| *updated_at != spec.updated_at)
    })
}

pub(super) async fn resolve_harness_mode(
    state: &AppState,
    project_id: &ProjectId,
    params: &SpecQueryParams,
) -> ApiResult<HarnessMode> {
    if let Some(aiid) = params.agent_instance_id {
        let instance = state
            .agent_instance_service
            .get_instance(project_id, &aiid)
            .await
            .map_err(|e| match e {
                aura_os_agents::AgentError::NotFound => {
                    ApiError::not_found(format!("agent instance {aiid} not found"))
                }
                other => ApiError::internal(format!("looking up agent instance {aiid}: {other}")),
            })?;
        Ok(instance.harness_mode())
    } else {
        Ok(HarnessMode::Local)
    }
}
