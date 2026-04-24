use async_trait::async_trait;
use serde_json::json;

use aura_os_core::{OrgId, ProjectId, ToolDomain};
use aura_os_network::{CreateProjectRequest, UpdateProjectRequest};

use super::{AgentTool, AgentToolContext, CapabilityRequirement, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

fn require_network(
    ctx: &AgentToolContext,
) -> Result<&aura_os_network::NetworkClient, AgentRuntimeError> {
    ctx.network_client
        .as_deref()
        .ok_or_else(|| AgentRuntimeError::Internal("network client not available".into()))
}

fn tool_err(action: &str, e: impl std::fmt::Display) -> AgentRuntimeError {
    AgentRuntimeError::ToolError(format!("{action}: {e}"))
}

fn slugify(name: &str) -> String {
    let s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "project".to_string()
    } else {
        s
    }
}

// ---------------------------------------------------------------------------
// 1. CreateProjectTool
// ---------------------------------------------------------------------------

pub struct CreateProjectTool;

#[async_trait]
impl AgentTool for CreateProjectTool {
    fn name(&self) -> &str {
        "create_project"
    }
    fn description(&self) -> &str {
        "Create a new project in the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `create_project` has no project-scoped capability
        // yet (the `Capability` enum lacks `CreateProject`); the CEO
        // preset holds universe scope so it is always allowed, and the
        // downstream aura-network / Orbit calls enforce membership via
        // the JWT. Revisit once an org-level write capability exists.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Project name" },
                "description": { "type": "string", "description": "Project description" },
                "org_id": { "type": "string", "description": "Organization ID (uses context org if omitted)" }
            },
            "required": ["name"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let name = input["name"].as_str().unwrap_or_default().to_string();
        let org_id = input["org_id"].as_str().unwrap_or(&ctx.org_id).to_string();

        let orbit_repo_slug = slugify(&name);
        let req = CreateProjectRequest {
            name,
            org_id: org_id.clone(),
            description: input["description"].as_str().map(String::from),
            folder: None,
            git_repo_url: None,
            git_branch: Some("main".to_string()),
            orbit_base_url: None,
            orbit_owner: Some(org_id.clone()),
            orbit_repo: Some(orbit_repo_slug.clone()),
        };
        let project = network
            .create_project(&ctx.jwt, &req)
            .await
            .map_err(|e| tool_err("create_project", e))?;

        let orbit = ctx.orbit_client.as_deref().ok_or_else(|| {
            AgentRuntimeError::ToolError(
                "create_project: Orbit client not configured (ORBIT_BASE_URL not set); \
                 cannot create required Orbit repo"
                    .into(),
            )
        })?;

        if let Err(e) = orbit
            .ensure_repo(&orbit_repo_slug, &org_id, &project.id, &ctx.jwt)
            .await
        {
            // Best-effort rollback: delete the project we just created.
            let _ = network.delete_project(&project.id, &ctx.jwt).await;
            return Err(tool_err(
                "create_project",
                format!(
                    "project created but Orbit repo creation failed (project rolled back): {e}"
                ),
            ));
        }

        Ok(ToolResult {
            content: serde_json::to_value(&project).unwrap_or_default(),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 2. ImportProjectTool (stub)
// ---------------------------------------------------------------------------

pub struct ImportProjectTool;

#[async_trait]
impl AgentTool for ImportProjectTool {
    fn name(&self) -> &str {
        "import_project"
    }
    fn description(&self) -> &str {
        "Import an existing project (e.g. from GitHub)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `import_project` is a stub and has no capability
        // mapping yet. Treat as org-scoped write once available.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "description": { "type": "string" },
                "org_id": { "type": "string" }
            },
            "required": ["name"]
        })
    }

    async fn execute(
        &self,
        _input: serde_json::Value,
        _ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        Ok(ToolResult {
            content: json!({ "message": "Project import is not yet supported via the agent runtime. Please use the web UI to import projects." }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 3. ListProjectsTool
// ---------------------------------------------------------------------------

pub struct ListProjectsTool;

#[async_trait]
impl AgentTool for ListProjectsTool {
    fn name(&self) -> &str {
        "list_projects"
    }
    fn description(&self) -> &str {
        "List all projects in the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `list_projects` is org-scoped; there is no
        // `ReadOrg` capability yet and the result set is filtered by
        // the caller's JWT downstream, so leaving this unrestricted
        // matches existing behaviour for non-CEO agents with scoped
        // `ReadProject` grants.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    async fn execute(
        &self,
        _input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        if let Some(network) = ctx.network_client.as_deref() {
            let projects = network
                .list_projects_by_org(&ctx.org_id, &ctx.jwt)
                .await
                .map_err(|e| tool_err("list_projects", e))?;
            return Ok(ToolResult {
                content: serde_json::to_value(&projects).unwrap_or_default(),
                is_error: false,
            });
        }

        let org_id: OrgId = ctx.org_id.parse().unwrap_or_default();
        let projects = ctx
            .project_service
            .list_projects_by_org(&org_id)
            .map_err(|e| tool_err("list_projects", e))?;
        Ok(ToolResult {
            content: serde_json::to_value(&projects).unwrap_or_default(),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 4. GetProjectTool
// ---------------------------------------------------------------------------

pub struct GetProjectTool;

#[async_trait]
impl AgentTool for GetProjectTool {
    fn name(&self) -> &str {
        "get_project"
    }
    fn description(&self) -> &str {
        "Get details of a specific project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::ReadProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id_str = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;

        if let Some(network) = ctx.network_client.as_deref() {
            let project = network
                .get_project(project_id_str, &ctx.jwt)
                .await
                .map_err(|e| tool_err("get_project", e))?;
            return Ok(ToolResult {
                content: serde_json::to_value(&project).unwrap_or_default(),
                is_error: false,
            });
        }

        let pid: ProjectId = project_id_str
            .parse()
            .map_err(|_| AgentRuntimeError::ToolError("invalid project_id".into()))?;
        let project = ctx
            .project_service
            .get_project(&pid)
            .map_err(|e| tool_err("get_project", e))?;
        Ok(ToolResult {
            content: serde_json::to_value(&project).unwrap_or_default(),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 5. UpdateProjectTool
// ---------------------------------------------------------------------------

pub struct UpdateProjectTool;

#[async_trait]
impl AgentTool for UpdateProjectTool {
    fn name(&self) -> &str {
        "update_project"
    }
    fn description(&self) -> &str {
        "Update project settings (name, description, git config, etc.)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "name": { "type": "string" },
                "description": { "type": "string" },
                "git_repo_url": { "type": "string" },
                "git_branch": { "type": "string" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;
        let req = UpdateProjectRequest {
            name: input["name"].as_str().map(String::from),
            description: input["description"].as_str().map(String::from),
            folder: None,
            git_repo_url: input["git_repo_url"].as_str().map(String::from),
            git_branch: input["git_branch"].as_str().map(String::from),
            orbit_base_url: None,
            orbit_owner: None,
            orbit_repo: None,
        };
        let project = network
            .update_project(project_id, &ctx.jwt, &req)
            .await
            .map_err(|e| tool_err("update_project", e))?;
        Ok(ToolResult {
            content: serde_json::to_value(&project).unwrap_or_default(),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 6. DeleteProjectTool
// ---------------------------------------------------------------------------

pub struct DeleteProjectTool;

#[async_trait]
impl AgentTool for DeleteProjectTool {
    fn name(&self) -> &str {
        "delete_project"
    }
    fn description(&self) -> &str {
        "Permanently delete a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID to delete" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;
        network
            .delete_project(project_id, &ctx.jwt)
            .await
            .map_err(|e| tool_err("delete_project", e))?;
        Ok(ToolResult {
            content: json!({ "deleted": true, "project_id": project_id }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 7. ArchiveProjectTool (soft-delete via update)
// ---------------------------------------------------------------------------

pub struct ArchiveProjectTool;

#[async_trait]
impl AgentTool for ArchiveProjectTool {
    fn name(&self) -> &str {
        "archive_project"
    }
    fn description(&self) -> &str {
        "Archive a project (soft-delete)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID to archive" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id_str = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;
        let pid: ProjectId = project_id_str
            .parse()
            .map_err(|_| AgentRuntimeError::ToolError("invalid project_id".into()))?;
        let project = ctx
            .project_service
            .archive_project(&pid)
            .map_err(|e| tool_err("archive_project", e))?;
        Ok(ToolResult {
            content: serde_json::to_value(&project).unwrap_or_default(),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 8. GetProjectStatsTool
// ---------------------------------------------------------------------------

pub struct GetProjectStatsTool;

#[async_trait]
impl AgentTool for GetProjectStatsTool {
    fn name(&self) -> &str {
        "get_project_stats"
    }
    fn description(&self) -> &str {
        "Get statistics for a project (tasks, agents, sessions)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Project
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::ReadProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id_str = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;

        if let Some(network) = ctx.network_client.as_deref() {
            let project = network
                .get_project(project_id_str, &ctx.jwt)
                .await
                .map_err(|e| tool_err("get_project_stats", e))?;

            let agents = network.list_agents(&ctx.jwt).await.unwrap_or_default();

            return Ok(ToolResult {
                content: json!({
                    "project_id": project_id_str,
                    "project_name": project.name,
                    "agent_count": agents.len(),
                    "description": project.description,
                    "git_repo_url": project.git_repo_url,
                }),
                is_error: false,
            });
        }

        let pid: ProjectId = project_id_str
            .parse()
            .map_err(|_| AgentRuntimeError::ToolError("invalid project_id".into()))?;
        let project = ctx
            .project_service
            .get_project(&pid)
            .map_err(|e| tool_err("get_project_stats", e))?;

        let agent_count = ctx
            .agent_service
            .list_agents()
            .map(|a| a.len())
            .unwrap_or(0);

        Ok(ToolResult {
            content: json!({
                "project_id": project_id_str,
                "project_name": project.name,
                "agent_count": agent_count,
                "description": project.description,
                "git_repo_url": project.git_repo_url,
            }),
            is_error: false,
        })
    }
}
