use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::listing_status::AgentListingStatus;
use aura_os_core::{Agent, AgentId, HarnessMode};

use crate::dto::{
    AgentCloneCopyReport, CloneAgentToLocalRequest, CloneAgentToLocalResponse, CreateAgentRequest,
};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const CLONE_SOURCE_TAG_PREFIX: &str = "cloned_from_agent:";
const LISTING_STATUS_TAG_PREFIX: &str = "listing_status:";
const EXPERTISE_TAG_PREFIX: &str = "expertise:";

/// Clone a remote agent's portable configuration into a new local agent.
///
/// This is intentionally create-only: the source is fetched for authorization
/// and projection, then the standard local creation path creates a new network
/// identity and Home-project binding. No update, delete, or swarm lifecycle
/// call can be reached from this handler, which makes `source_preserved` an
/// invariant rather than a best-effort promise.
pub(crate) async fn clone_agent_to_local(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(source_agent_id): Path<AgentId>,
    Json(body): Json<CloneAgentToLocalRequest>,
) -> ApiResult<Json<CloneAgentToLocalResponse>> {
    let source = super::list::get_agent(
        State(state.clone()),
        AuthJwt(jwt.clone()),
        Path(source_agent_id),
    )
    .await?
    .0;

    if source.harness_mode() != HarnessMode::Swarm {
        return Err(ApiError::bad_request(
            "only remote agents can be cloned to the local runtime",
        ));
    }

    let create_request = local_clone_request(&source, body);
    let agent = super::create::create_agent(State(state), AuthJwt(jwt), Json(create_request))
        .await?
        .0;

    Ok(Json(CloneAgentToLocalResponse {
        agent,
        source_agent_id,
        source_preserved: true,
        copy_report: clone_copy_report(),
    }))
}

fn local_clone_request(source: &Agent, body: CloneAgentToLocalRequest) -> CreateAgentRequest {
    let requested_name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned);

    CreateAgentRequest {
        org_id: source.org_id,
        name: requested_name.unwrap_or_else(|| default_clone_name(&source.name)),
        role: source.role.clone(),
        personality: source.personality.clone(),
        system_prompt: source.system_prompt.clone(),
        skills: source.skills.clone(),
        icon: source.icon.clone(),
        machine_type: Some("local".to_string()),
        adapter_type: Some("aura_harness".to_string()),
        environment: Some("local_host".to_string()),
        auth_source: Some("aura_managed".to_string()),
        integration_id: None,
        default_model: source.default_model.clone(),
        tags: Some(clone_tags(source)),
        // A clone is a new private identity. Marketplace discoverability,
        // expertise, stats, reputation, and the source wallet never carry.
        listing_status: Some(AgentListingStatus::Closed.as_str().to_string()),
        expertise: Some(Vec::new()),
        local_workspace_path: None,
        permissions: source.permissions.clone(),
        intent_classifier: source.intent_classifier.clone(),
    }
}

fn clone_tags(source: &Agent) -> Vec<String> {
    let mut tags: Vec<String> = source
        .tags
        .iter()
        .filter(|tag| {
            let lower = tag.to_ascii_lowercase();
            !lower.starts_with(LISTING_STATUS_TAG_PREFIX)
                && !lower.starts_with(EXPERTISE_TAG_PREFIX)
                && !lower.starts_with(CLONE_SOURCE_TAG_PREFIX)
        })
        .cloned()
        .collect();
    tags.push(format!("{CLONE_SOURCE_TAG_PREFIX}{}", source.agent_id));
    tags
}

fn default_clone_name(source_name: &str) -> String {
    let mut base = String::with_capacity(source_name.len());
    let mut previous_separator = false;
    for ch in source_name.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            base.push(ch);
            previous_separator = false;
        } else if !previous_separator && !base.is_empty() {
            base.push('-');
            previous_separator = true;
        }
    }
    while base.ends_with('-') {
        base.pop();
    }
    if base.is_empty() {
        base.push_str("agent");
    }
    format!("{base}-local")
}

fn clone_copy_report() -> AgentCloneCopyReport {
    AgentCloneCopyReport {
        copied: [
            "profile",
            "system_prompt",
            "model",
            "permissions",
            "skill_labels",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        not_copied: [
            "wallet",
            "marketplace_state",
            "chat_history",
            "memory",
            "workspace_files",
            "installed_skill_packages",
            "secrets",
            "processes",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentPermissions, OrgId};
    use chrono::Utc;

    fn source_agent(name: &str) -> Agent {
        Agent {
            agent_id: AgentId::new(),
            user_id: "user-1".into(),
            org_id: Some(OrgId::new()),
            name: name.into(),
            role: "developer".into(),
            personality: "careful".into(),
            system_prompt: "Build reliable systems.".into(),
            skills: vec!["rust".into()],
            icon: None,
            machine_type: "remote".into(),
            adapter_type: "aura_harness".into(),
            environment: "swarm_microvm".into(),
            auth_source: "aura_managed".into(),
            integration_id: None,
            default_model: Some("aura-test-model".into()),
            vm_id: Some("vm-1".into()),
            wallet_address: Some("0xsource".into()),
            network_agent_id: None,
            profile_id: None,
            tags: vec![
                "custom".into(),
                "listing_status:hireable".into(),
                "expertise:coding".into(),
            ],
            is_pinned: false,
            listing_status: AgentListingStatus::Hireable,
            expertise: vec!["coding".into()],
            jobs: 9,
            revenue_usd: 42.0,
            reputation: 4.8,
            local_workspace_path: None,
            permissions: AgentPermissions::default_new_agent(),
            intent_classifier: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn derives_a_supported_local_name() {
        assert_eq!(
            default_clone_name("My Remote Agent!"),
            "My-Remote-Agent-local"
        );
        assert_eq!(default_clone_name("!!!"), "agent-local");
    }

    #[test]
    fn clone_request_copies_only_portable_configuration() {
        let source = source_agent("Source");
        let request = local_clone_request(&source, CloneAgentToLocalRequest::default());

        assert_eq!(request.name, "Source-local");
        assert_eq!(request.machine_type.as_deref(), Some("local"));
        assert_eq!(request.environment.as_deref(), Some("local_host"));
        assert_eq!(request.default_model, source.default_model);
        assert_eq!(request.permissions, source.permissions);
        assert_eq!(request.listing_status.as_deref(), Some("closed"));
        assert_eq!(request.expertise, Some(Vec::new()));
        let tags = request.tags.expect("clone tags");
        assert!(tags.contains(&"custom".to_string()));
        assert!(tags.contains(&format!("cloned_from_agent:{}", source.agent_id)));
        assert!(!tags.iter().any(|tag| tag.starts_with("expertise:")));
        assert!(!tags.iter().any(|tag| tag == "listing_status:hireable"));
    }
}
