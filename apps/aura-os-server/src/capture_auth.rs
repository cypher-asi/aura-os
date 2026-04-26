use std::time::Instant;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;

use aura_os_core::listing_status::AgentListingStatus;
use aura_os_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, AgentPermissions, AgentStatus, ChatRole, OrgId,
    Project, ProjectId, ProjectStatus, SessionEvent, SessionEventId, SessionId, TaskId,
    ZeroAuthSession,
};

use crate::dto::AuthSessionResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, CachedSession};

const CAPTURE_ACCESS_TOKEN_PREFIX: &str = "aura-capture:";
const CAPTURE_ACCESS_TOKEN_VERSION: &str = "v1";
const CAPTURE_ACCESS_TOKEN_MAX_AGE_SECS: i64 = 30 * 60;
const PRIMARY_CAPTURE_SECRET_ENV: &str = "AURA_CHANGELOG_CAPTURE_SECRET";
const LEGACY_CAPTURE_SECRET_ENV: &str = "AURA_CAPTURE_MODE_SECRET";
const MIN_CAPTURE_SECRET_LEN: usize = 24;
const DEMO_ORG_ID: &str = "11111111-1111-4111-8111-111111111111";
const DEMO_PROJECT_ID: &str = "22222222-2222-4222-8222-222222222222";
const DEMO_AGENT_ID: &str = "33333333-3333-4333-8333-333333333333";
const DEMO_AGENT_INSTANCE_ID: &str = "44444444-4444-4444-8444-444444444444";
const DEMO_USER_EVENT_ID: &str = "55555555-5555-4555-8555-555555555555";
const DEMO_ASSISTANT_EVENT_ID: &str = "66666666-6666-4666-8666-666666666666";

#[derive(Debug, Deserialize)]
pub(crate) struct CaptureSessionRequest {
    secret: String,
}

fn configured_capture_secret() -> Option<String> {
    [PRIMARY_CAPTURE_SECRET_ENV, LEGACY_CAPTURE_SECRET_ENV]
        .into_iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|secret| secret.trim().to_owned())
        .filter(|secret| secret.len() >= MIN_CAPTURE_SECRET_LEN)
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    let diff = left
        .iter()
        .zip(right.iter())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b));
    diff == 0
}

pub(crate) fn is_capture_access_token(token: &str) -> bool {
    token.starts_with(CAPTURE_ACCESS_TOKEN_PREFIX)
}

fn capture_token_key(secret: &str) -> [u8; 32] {
    *blake3::hash(secret.as_bytes()).as_bytes()
}

fn capture_token_signature(secret: &str, payload: &str) -> String {
    let key = capture_token_key(secret);
    hex::encode(blake3::keyed_hash(&key, payload.as_bytes()).as_bytes())
}

fn mint_capture_access_token(secret: &str) -> String {
    let payload = format!(
        "{CAPTURE_ACCESS_TOKEN_VERSION}:{}:{}",
        Utc::now().timestamp(),
        uuid::Uuid::new_v4()
    );
    let signature = capture_token_signature(secret, &payload);
    format!("{CAPTURE_ACCESS_TOKEN_PREFIX}{payload}:{signature}")
}

fn validate_capture_access_token(token: &str, secret: &str) -> bool {
    let Some(unsigned) = token.strip_prefix(CAPTURE_ACCESS_TOKEN_PREFIX) else {
        return false;
    };
    let parts = unsigned.split(':').collect::<Vec<_>>();
    if parts.len() != 4 || parts[0] != CAPTURE_ACCESS_TOKEN_VERSION {
        return false;
    }

    let Ok(created_at) = parts[1].parse::<i64>() else {
        return false;
    };
    let now = Utc::now().timestamp();
    if created_at > now + 120 {
        return false;
    }
    let age_secs = now.saturating_sub(created_at);
    if age_secs > CAPTURE_ACCESS_TOKEN_MAX_AGE_SECS {
        return false;
    }

    if uuid::Uuid::parse_str(parts[2]).is_err() {
        return false;
    }

    let payload = format!("{}:{}:{}", parts[0], parts[1], parts[2]);
    let expected_signature = capture_token_signature(secret, &payload);
    constant_time_eq(parts[3], &expected_signature)
}

pub(crate) fn capture_session_from_access_token(token: &str) -> Option<ZeroAuthSession> {
    let secret = configured_capture_secret()?;
    validate_capture_access_token(token, &secret).then(|| build_capture_session(token.to_owned()))
}

fn parse_uuid(value: &str) -> uuid::Uuid {
    uuid::Uuid::parse_str(value).expect("capture demo UUID constants must be valid")
}

pub(crate) fn demo_org_id() -> OrgId {
    OrgId::from_uuid(parse_uuid(DEMO_ORG_ID))
}

pub(crate) fn demo_project_id() -> ProjectId {
    ProjectId::from_uuid(parse_uuid(DEMO_PROJECT_ID))
}

pub(crate) fn demo_agent_id() -> AgentId {
    AgentId::from_uuid(parse_uuid(DEMO_AGENT_ID))
}

pub(crate) fn demo_agent_instance_id() -> AgentInstanceId {
    AgentInstanceId::from_uuid(parse_uuid(DEMO_AGENT_INSTANCE_ID))
}

pub(crate) fn demo_project() -> Project {
    let now = Utc::now();
    Project {
        project_id: demo_project_id(),
        org_id: demo_org_id(),
        name: "Aura Launch Workspace".into(),
        description: "A seeded workspace used only for changelog media capture.".into(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Active,
        build_command: None,
        test_command: None,
        specs_summary: Some("Specs, agents, and feedback are ready for visual capture.".into()),
        specs_title: Some("Launch checklist".into()),
        created_at: now,
        updated_at: now,
        git_repo_url: Some("https://github.com/cypher-asi/aura-os".into()),
        git_branch: Some("main".into()),
        orbit_base_url: None,
        orbit_owner: None,
        orbit_repo: None,
        local_workspace_path: None,
    }
}

pub(crate) fn demo_agent() -> Agent {
    let now = Utc::now();
    Agent {
        agent_id: demo_agent_id(),
        user_id: "capture-demo-user".into(),
        org_id: Some(demo_org_id()),
        name: "Atlas".into(),
        role: "Product agent".into(),
        personality: "Clear, precise, and launch-focused.".into(),
        system_prompt: "Help turn product ideas into implementation-ready specs.".into(),
        skills: vec![
            "spec-writing".into(),
            "product-review".into(),
            "release-notes".into(),
        ],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        auth_source: "aura_managed".into(),
        integration_id: None,
        default_model: Some("gpt-5.4".into()),
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags: vec!["capture-demo".into()],
        is_pinned: true,
        listing_status: AgentListingStatus::Closed,
        expertise: vec!["product".into()],
        jobs: 18,
        revenue_usd: 0.0,
        reputation: 4.9,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

pub(crate) fn demo_agent_instance() -> AgentInstance {
    let agent = demo_agent();
    let now = Utc::now();
    AgentInstance {
        agent_instance_id: demo_agent_instance_id(),
        project_id: demo_project_id(),
        agent_id: agent.agent_id,
        org_id: Some(demo_org_id()),
        name: agent.name,
        role: agent.role,
        personality: agent.personality,
        system_prompt: agent.system_prompt,
        skills: agent.skills,
        icon: agent.icon,
        machine_type: agent.machine_type,
        adapter_type: agent.adapter_type,
        environment: agent.environment,
        auth_source: agent.auth_source,
        integration_id: agent.integration_id,
        default_model: agent.default_model,
        workspace_path: Some("/tmp/aura-capture-workspace".into()),
        status: AgentStatus::Idle,
        current_task_id: None::<TaskId>,
        current_session_id: Some(SessionId::nil()),
        total_input_tokens: 24_860,
        total_output_tokens: 8_420,
        model: Some("gpt-5.4".into()),
        permissions: agent.permissions,
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

pub(crate) fn demo_agent_events() -> Vec<SessionEvent> {
    let now = Utc::now();
    vec![
        SessionEvent {
            event_id: SessionEventId::from_uuid(parse_uuid(DEMO_USER_EVENT_ID)),
            agent_instance_id: demo_agent_instance_id(),
            project_id: demo_project_id(),
            role: ChatRole::User,
            content: "Create a launch-ready spec for the new model picker.".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
            in_flight: None,
        },
        SessionEvent {
            event_id: SessionEventId::from_uuid(parse_uuid(DEMO_ASSISTANT_EVENT_ID)),
            agent_instance_id: demo_agent_instance_id(),
            project_id: demo_project_id(),
            role: ChatRole::Assistant,
            content: "Drafted the spec and highlighted the GPT-5.4 model choice for review.".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
            in_flight: None,
        },
    ]
}

fn build_capture_session(access_token: String) -> ZeroAuthSession {
    let now = Utc::now();
    ZeroAuthSession {
        user_id: "capture-demo-user".into(),
        network_user_id: None,
        profile_id: None,
        display_name: "Aura Capture".into(),
        profile_image: String::new(),
        primary_zid: "0://aura-capture".into(),
        zero_wallet: "0x0000000000000000000000000000000000000000".into(),
        wallets: vec![],
        access_token,
        is_zero_pro: true,
        is_access_granted: true,
        created_at: now,
        validated_at: now,
    }
}

pub(crate) async fn create_capture_session(
    State(state): State<AppState>,
    Json(req): Json<CaptureSessionRequest>,
) -> ApiResult<(StatusCode, Json<AuthSessionResponse>)> {
    let Some(expected_secret) = configured_capture_secret() else {
        return Err(ApiError::not_found("capture session endpoint is disabled"));
    };

    if !constant_time_eq(req.secret.trim(), &expected_secret) {
        return Err(ApiError::unauthorized("invalid capture session secret"));
    }

    let access_token = mint_capture_access_token(&expected_secret);
    let session = build_capture_session(access_token.clone());
    state.validation_cache.insert(
        access_token,
        CachedSession {
            session: session.clone(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: None,
        },
    );

    Ok((
        StatusCode::CREATED,
        Json(AuthSessionResponse::from(session)),
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        capture_session_from_access_token, constant_time_eq, is_capture_access_token,
        mint_capture_access_token, validate_capture_access_token, PRIMARY_CAPTURE_SECRET_ENV,
    };

    const TEST_SECRET: &str = "capture-secret-with-enough-entropy";

    #[test]
    fn capture_token_prefix_is_explicit() {
        assert!(is_capture_access_token("aura-capture:abc"));
        assert!(!is_capture_access_token("regular-jwt"));
    }

    #[test]
    fn constant_time_eq_requires_exact_match() {
        assert!(constant_time_eq("same-secret", "same-secret"));
        assert!(!constant_time_eq("same-secret", "same-secreu"));
        assert!(!constant_time_eq("same-secret", "same-secret-longer"));
    }

    #[test]
    fn signed_capture_tokens_are_statelessly_validated() {
        std::env::set_var(PRIMARY_CAPTURE_SECRET_ENV, TEST_SECRET);
        let token = mint_capture_access_token(TEST_SECRET);

        assert!(validate_capture_access_token(&token, TEST_SECRET));
        assert!(!validate_capture_access_token(&token, "different-secret"));
        assert!(capture_session_from_access_token(&token).is_some());

        std::env::remove_var(PRIMARY_CAPTURE_SECRET_ENV);
    }
}
