// ---------------------------------------------------------------------------
// Agent resolution helper
// ---------------------------------------------------------------------------

/// Resolved integration data for building provider config.
#[allow(dead_code)]
struct ResolvedIntegration {
    metadata: aura_os_core::OrgIntegration,
}

/// Resolve the agent's org integration, returning the metadata and secret
/// needed to build a `SessionProviderConfig`.
fn resolve_agent_integration(
    agent: &Agent,
    org_service: &OrgService,
) -> Option<ResolvedIntegration> {
    if agent.auth_source != "org_integration" {
        return None;
    }
    let integration_id = agent.integration_id.as_deref()?;
    let org_id = agent.org_id.as_ref()?;

    let metadata = match org_service.get_integration(org_id, integration_id) {
        Ok(Some(m)) => m,
        Ok(None) => {
            warn!(%integration_id, "Integration not found for process agent");
            return None;
        }
        Err(e) => {
            warn!(%integration_id, error = %e, "Failed to load integration for process agent");
            return None;
        }
    };

    Some(ResolvedIntegration { metadata })
}

/// Resolve the effective model using the same cascade as the chat handler:
/// node config override > agent default > integration default.
fn effective_model(
    node: &ProcessNode,
    agent: Option<&Agent>,
    integration: Option<&ResolvedIntegration>,
) -> Option<String> {
    node.config
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            agent
                .and_then(|a| a.default_model.clone())
                .filter(|s| !s.trim().is_empty())
        })
        .or_else(|| {
            integration
                .and_then(|ri| ri.metadata.default_model.clone())
                .filter(|s| !s.trim().is_empty())
        })
}

fn require_process_node_agent(
    node: &ProcessNode,
    agent_service: &AgentService,
) -> Result<Agent, ProcessError> {
    let agent_id = node.agent_id.as_ref().ok_or_else(|| {
        ProcessError::Execution(format!(
            "Node '{}' requires an assigned agent to create a session",
            node.label
        ))
    })?;
    agent_service.get_agent_local(agent_id).map_err(|e| {
        ProcessError::Execution(format!(
            "Failed to load agent for node '{}': {e}",
            node.label
        ))
    })
}

async fn resolve_or_create_process_node_binding(
    storage: &StorageClient,
    jwt: &str,
    project_id: &ProjectId,
    node: &ProcessNode,
    agent_service: &AgentService,
    org_service: &OrgService,
) -> Result<ProcessNodeExecutionBinding, ProcessError> {
    let agent = require_process_node_agent(node, agent_service)?;
    let project_agents = storage
        .list_project_agents(&project_id.to_string(), jwt)
        .await
        .map_err(|e| {
            ProcessError::Execution(format!(
                "Failed to list project agents for node '{}': {e}",
                node.label
            ))
        })?;
    let agent_id = agent.agent_id.to_string();
    let project_agent_id = if let Some(existing) = project_agents
        .into_iter()
        .find(|project_agent| project_agent.agent_id.as_deref() == Some(agent_id.as_str()))
    {
        existing.id
    } else {
        let created = storage
            .create_project_agent(
                &project_id.to_string(),
                jwt,
                &aura_os_storage::CreateProjectAgentRequest {
                    agent_id,
                    name: agent.name.clone(),
                    org_id: None,
                    role: Some(agent.role.clone()),
                    personality: Some(agent.personality.clone()),
                    system_prompt: Some(agent.system_prompt.clone()),
                    skills: Some(agent.skills.clone()),
                    icon: agent.icon.clone(),
                    harness: None,
                },
            )
            .await
            .map_err(|e| {
                ProcessError::Execution(format!(
                    "Failed to create project agent for node '{}': {e}",
                    node.label
                ))
            })?;
        created.id
    };

    let integration = resolve_agent_integration(&agent, org_service);
    let model = effective_model(node, Some(&agent), integration.as_ref())
        .unwrap_or_else(|| DEFAULT_PROCESS_NODE_MODEL.to_string());

    Ok(ProcessNodeExecutionBinding {
        project_agent_id,
        model,
    })
}

async fn create_process_task_session(
    storage: &StorageClient,
    jwt: Option<&str>,
    project_id: &ProjectId,
    task_id: &str,
    node_label: &str,
    binding: &ProcessNodeExecutionBinding,
) -> Result<String, ProcessError> {
    let jwt =
        jwt.ok_or_else(|| ProcessError::Execution("No JWT available for session creation".into()))?;
    let session = storage
        .create_session(
            &binding.project_agent_id,
            jwt,
            &aura_os_storage::CreateSessionRequest {
                project_id: project_id.to_string(),
                org_id: None,
                model: Some(binding.model.clone()),
                status: Some("active".to_string()),
                context_usage_estimate: Some(0.0),
                summary_of_previous_context: Some(format!("Process node: {node_label}")),
            },
        )
        .await
        .map_err(|e| {
            ProcessError::Execution(format!(
                "Failed to create session for process node '{node_label}': {e}"
            ))
        })?;

    storage
        .update_task(
            task_id,
            jwt,
            &aura_os_storage::UpdateTaskRequest {
                title: None,
                description: None,
                order_index: None,
                dependency_ids: None,
                execution_notes: None,
                files_changed: None,
                model: Some(binding.model.clone()),
                total_input_tokens: None,
                total_output_tokens: None,
                session_id: Some(session.id.clone()),
                assigned_project_agent_id: Some(binding.project_agent_id.clone()),
            },
        )
        .await
        .map_err(|e| {
            ProcessError::Execution(format!(
                "Failed to update task/session metadata for process node '{node_label}': {e}"
            ))
        })?;

    Ok(session.id)
}

async fn finalize_process_task_session(
    storage: &StorageClient,
    jwt: Option<&str>,
    session_id: &str,
    status: &str,
    total_input_tokens: u64,
    total_output_tokens: u64,
) -> Result<(), ProcessError> {
    let jwt =
        jwt.ok_or_else(|| ProcessError::Execution("No JWT available for session updates".into()))?;
    storage
        .update_session(
            session_id,
            jwt,
            &aura_os_storage::UpdateSessionRequest {
                status: Some(status.to_string()),
                total_input_tokens: Some(total_input_tokens),
                total_output_tokens: Some(total_output_tokens),
                context_usage_estimate: None,
                summary_of_previous_context: None,
                tasks_worked_count: Some(1),
                ended_at: Some(Utc::now().to_rfc3339()),
            },
        )
        .await
        .map_err(|e| {
            ProcessError::Execution(format!(
                "Failed to finalize process session {session_id}: {e}"
            ))
        })
}

// ---------------------------------------------------------------------------
// Spec/Task creation for project-linked processes
// ---------------------------------------------------------------------------

fn emit_process_spec_saved_event(
    broadcast: &broadcast::Sender<serde_json::Value>,
    project_id: &ProjectId,
    spec: Spec,
) {
    let spec_id = spec.spec_id.to_string();
    let _ = broadcast.send(serde_json::json!({
        "type": "spec_saved",
        "project_id": project_id.to_string(),
        "spec": spec,
        "spec_id": spec_id,
    }));
}

fn emit_process_task_saved_event(
    broadcast: &broadcast::Sender<serde_json::Value>,
    project_id: &ProjectId,
    task: Task,
) {
    let task_id = task.task_id.to_string();
    let _ = broadcast.send(serde_json::json!({
        "type": "task_saved",
        "project_id": project_id.to_string(),
        "task": task,
        "task_id": task_id,
    }));
}

async fn create_spec_and_tasks(
    broadcast: &broadcast::Sender<serde_json::Value>,
    storage: &StorageClient,
    jwt: Option<&str>,
    project_id: &ProjectId,
    process: &aura_os_core::Process,
    nodes: &[ProcessNode],
    sorted: &[ProcessNodeId],
    reachable: &HashSet<ProcessNodeId>,
    agent_service: &AgentService,
    org_service: &OrgService,
) -> Result<(String, HashMap<ProcessNodeId, String>), ProcessError> {
    let jwt =
        jwt.ok_or_else(|| ProcessError::Execution("No JWT available for task creation".into()))?;
    let pid = project_id.to_string();

    let created_spec = storage
        .create_spec(
            &pid,
            jwt,
            &aura_os_storage::CreateSpecRequest {
                title: format!("Process: {}", process.name),
                org_id: None,
                order_index: Some(0),
                markdown_contents: Some(process.description.clone()),
            },
        )
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to create spec: {e}")))?;
    let spec = Spec::try_from(created_spec)
        .map_err(|e| ProcessError::Execution(format!("Failed to decode created spec: {e}")))?;
    let spec_id = spec.spec_id.to_string();
    emit_process_spec_saved_event(broadcast, project_id, spec);

    let nodes_by_id: HashMap<ProcessNodeId, &ProcessNode> =
        nodes.iter().map(|n| (n.node_id, n)).collect();

    let mut task_map: HashMap<ProcessNodeId, String> = HashMap::new();

    for (idx, &nid) in sorted.iter().enumerate() {
        if !reachable.contains(&nid) {
            continue;
        }
        let Some(node) = nodes_by_id.get(&nid) else {
            continue;
        };
        let eligible = matches!(
            node.node_type,
            ProcessNodeType::Action
                | ProcessNodeType::Prompt
                | ProcessNodeType::Artifact
                | ProcessNodeType::Condition
        );
        if !eligible {
            continue;
        }

        let assigned_project_agent_id = Some(
            resolve_or_create_process_node_binding(
                storage,
                jwt,
                project_id,
                node,
                agent_service,
                org_service,
            )
            .await?
            .project_agent_id,
        );

        let created_task = storage
            .create_task(
                &pid,
                jwt,
                &aura_os_storage::CreateTaskRequest {
                    spec_id: spec_id.clone(),
                    title: node.label.clone(),
                    org_id: None,
                    description: Some(node.prompt.clone()),
                    status: Some("ready".to_string()),
                    order_index: Some(idx as i32),
                    dependency_ids: None,
                    assigned_project_agent_id,
                },
            )
            .await
            .map_err(|e| {
                ProcessError::Execution(format!(
                    "Failed to create task for node {}: {e}",
                    node.label
                ))
            })?;
        let task = Task::try_from(created_task)
            .map_err(|e| ProcessError::Execution(format!("Failed to decode created task: {e}")))?;
        let task_id = task.task_id.to_string();
        emit_process_task_saved_event(broadcast, project_id, task);

        task_map.insert(nid, task_id.clone());
        info!(node_id = %nid, task_id = %task_id, "Created task for process node");
    }

    Ok((spec_id, task_map))
}
