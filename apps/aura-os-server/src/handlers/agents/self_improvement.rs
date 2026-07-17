use axum::extract::{Path, Query, State};
use axum::http::Method;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use aura_os_agents::{
    AgentImprovementEvidence, AgentImprovementKind, AgentImprovementProposal,
    AgentImprovementProvenance, AgentImprovementSource, AgentImprovementStatus,
    AgentLearningReviewResult, AgentSelfImprovementConfig, AgentSelfImprovementMode,
};
use aura_os_core::AgentId;
use aura_os_storage::StorageSessionEvent;

use crate::capture_auth::{demo_agent_id, is_capture_access_token};
use crate::error::{ApiError, ApiResult};
use crate::handlers::harness_proxy::{
    create_skill_from_payload, update_my_skill_from_payload, CreateSkillBody, UpdateSkillBody,
};
use crate::state::{AppState, AuthJwt, AuthSession};

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateSelfImprovementConfigRequest {
    pub mode: AgentSelfImprovementMode,
    #[serde(default = "default_true")]
    pub allow_memory: bool,
    #[serde(default = "default_true")]
    pub allow_skills: bool,
    #[serde(default)]
    pub allow_background_review: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ProposeImprovementRequest {
    pub kind: AgentImprovementKind,
    pub title: String,
    pub rationale: String,
    #[serde(default)]
    pub source_session_id: Option<String>,
    #[serde(default)]
    pub evidence: Vec<AgentImprovementEvidence>,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ProposeImprovementQuery {
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ListImprovementsQuery {
    #[serde(default)]
    pub status: Option<AgentImprovementStatus>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunLearningReviewRequest {
    #[serde(default)]
    pub limit_sessions: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct MemoryFactPayload {
    key: String,
    value: Value,
    #[serde(default)]
    confidence: Option<f64>,
    #[serde(default)]
    importance: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct MemoryProcedurePayload {
    name: String,
    trigger: String,
    steps: Vec<String>,
    #[serde(default)]
    context_constraints: Option<Value>,
    #[serde(default)]
    skill_name: Option<String>,
    #[serde(default)]
    skill_relevance: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct SkillCreatePayload {
    name: String,
    description: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    user_invocable: Option<bool>,
    #[serde(default)]
    model_invocable: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct SkillUpdatePayload {
    name: String,
    description: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    user_invocable: Option<bool>,
    #[serde(default)]
    model_invocable: Option<bool>,
}

fn default_true() -> bool {
    true
}

const REVIEW_DEFAULT_SESSION_LIMIT: usize = 5;
const REVIEW_MAX_SESSION_LIMIT: usize = 10;
const REVIEW_EVENT_LIMIT: u32 = 50;
const REVIEW_MAX_PENDING: usize = 5;
const REVIEW_QUOTE_LIMIT: usize = 240;

pub(crate) async fn get_self_improvement_config(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<AgentSelfImprovementConfig>> {
    ensure_agent_visible(&state, &jwt, &agent_id).await?;
    let config = state
        .agent_service
        .load_agent_self_improvement_config(&agent_id)
        .map_err(|e| ApiError::internal(format!("loading self-improvement config: {e}")))?;
    Ok(Json(config))
}

pub(crate) async fn update_self_improvement_config(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<UpdateSelfImprovementConfigRequest>,
) -> ApiResult<Json<AgentSelfImprovementConfig>> {
    ensure_agent_visible(&state, &jwt, &agent_id).await?;
    let config = AgentSelfImprovementConfig {
        mode: body.mode,
        allow_memory: body.allow_memory,
        allow_skills: body.allow_skills,
        allow_background_review: body.allow_background_review,
    };
    state
        .agent_service
        .save_agent_self_improvement_config(&agent_id, &config)
        .map_err(|e| ApiError::internal(format!("saving self-improvement config: {e}")))?;
    state.evict_chat_sessions_for_agent(&agent_id.to_string());
    Ok(Json(config))
}

pub(crate) async fn list_improvement_proposals(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<ListImprovementsQuery>,
) -> ApiResult<Json<Vec<AgentImprovementProposal>>> {
    ensure_agent_visible(&state, &jwt, &agent_id).await?;
    let mut proposals = state
        .agent_service
        .list_agent_improvement_proposals(&agent_id)
        .map_err(|e| ApiError::internal(format!("listing improvement proposals: {e}")))?;
    if let Some(status) = query.status {
        proposals.retain(|proposal| proposal.status == status);
    }
    Ok(Json(proposals))
}

pub(crate) async fn propose_improvement(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<ProposeImprovementQuery>,
    Json(body): Json<ProposeImprovementRequest>,
) -> ApiResult<Json<AgentImprovementProposal>> {
    ensure_agent_visible(&state, &jwt, &agent_id).await?;
    let project_id = clean_optional_string(query.project_id);
    if let Some(project_id) = project_id.as_deref() {
        ensure_agent_project_visible(&state, &jwt, &agent_id, project_id).await?;
    }
    let config = state
        .agent_service
        .load_agent_self_improvement_config(&agent_id)
        .map_err(|e| ApiError::internal(format!("loading self-improvement config: {e}")))?;
    validate_self_improvement_enabled(&config, body.kind)?;
    validate_proposal_request(&body)?;

    let now = Utc::now();
    let evidence = sanitize_evidence(body.evidence)?;
    let proposal = AgentImprovementProposal {
        id: Uuid::new_v4().to_string(),
        agent_id,
        kind: body.kind,
        title: body.title.trim().to_string(),
        rationale: body.rationale.trim().to_string(),
        source_session_id: body
            .source_session_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| evidence.first().and_then(|item| item.session_id.clone())),
        project_id,
        evidence,
        provenance: AgentImprovementProvenance::default(),
        dedup_key: None,
        payload: body.payload,
        status: AgentImprovementStatus::Pending,
        error: None,
        created_at: now,
        updated_at: now,
        applied_at: None,
    };
    let saved = state
        .agent_service
        .save_agent_improvement_proposal(proposal)
        .map_err(|e| ApiError::internal(format!("saving improvement proposal: {e}")))?;
    Ok(Json(saved))
}

pub(crate) async fn run_learning_review(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<RunLearningReviewRequest>,
) -> ApiResult<Json<AgentLearningReviewResult>> {
    ensure_agent_visible(&state, &jwt, &agent_id).await?;
    let config = state
        .agent_service
        .load_agent_self_improvement_config(&agent_id)
        .map_err(|e| ApiError::internal(format!("loading self-improvement config: {e}")))?;
    if config.mode == AgentSelfImprovementMode::Off {
        return Err(ApiError::forbidden(
            "self-improvement is disabled for this agent",
        ));
    }
    if !config.allow_background_review {
        return Err(ApiError::forbidden(
            "learning review is disabled for this agent",
        ));
    }

    let Some(storage) = state.storage_client.as_ref() else {
        return Err(ApiError::conflict(
            "learning review requires session storage",
        ));
    };

    let review_id = Uuid::new_v4().to_string();
    let session_limit = body
        .limit_sessions
        .unwrap_or(REVIEW_DEFAULT_SESSION_LIMIT)
        .clamp(1, REVIEW_MAX_SESSION_LIMIT);
    let sessions = storage
        .list_my_sessions(&jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing sessions for learning review: {e}")))?;
    let agent_id_string = agent_id.to_string();
    let target_sessions: Vec<_> = sessions
        .into_iter()
        .filter(|entry| entry.agent_id.as_deref() == Some(agent_id_string.as_str()))
        .filter(|entry| !super::sessions::storage_session_is_deleted(&entry.session))
        .filter(|entry| entry.session.event_count.unwrap_or(0) > 0)
        .take(session_limit)
        .collect();

    let existing = state
        .agent_service
        .list_agent_improvement_proposals(&agent_id)
        .map_err(|e| ApiError::internal(format!("listing improvement proposals: {e}")))?;
    let mut known_dedup_keys: std::collections::HashSet<String> = existing
        .iter()
        .filter_map(|proposal| proposal.dedup_key.clone())
        .collect();
    let mut pending_review_count = existing
        .iter()
        .filter(|proposal| {
            proposal.status == AgentImprovementStatus::Pending
                && proposal.provenance.source == AgentImprovementSource::LearningReview
        })
        .count();

    let mut scanned_events = 0usize;
    let mut skipped_existing = 0usize;
    let mut limit_reached = pending_review_count >= REVIEW_MAX_PENDING;
    let mut proposals = Vec::new();

    if !limit_reached {
        for session in &target_sessions {
            let events = storage
                .list_events(&session.session.id, &jwt, Some(REVIEW_EVENT_LIMIT), None)
                .await
                .map_err(|e| {
                    ApiError::internal(format!(
                        "listing events for learning review session {}: {e}",
                        session.session.id
                    ))
                })?;
            for event in events {
                scanned_events += 1;
                let Some(mut proposal) = proposal_from_review_event(
                    &agent_id,
                    &review_id,
                    &event,
                    session.session.project_id.as_deref(),
                    config.allow_memory,
                ) else {
                    continue;
                };
                let Some(dedup_key) = proposal.dedup_key.clone() else {
                    continue;
                };
                if !known_dedup_keys.insert(dedup_key) {
                    skipped_existing += 1;
                    continue;
                }
                proposal = state
                    .agent_service
                    .save_agent_improvement_proposal(proposal)
                    .map_err(|e| {
                        ApiError::internal(format!("saving learning review proposal: {e}"))
                    })?;
                proposals.push(proposal);
                pending_review_count += 1;
                if pending_review_count >= REVIEW_MAX_PENDING {
                    limit_reached = true;
                    break;
                }
            }
            if limit_reached {
                break;
            }
        }
    }

    Ok(Json(AgentLearningReviewResult {
        review_id,
        scanned_sessions: target_sessions.len(),
        scanned_events,
        created_proposals: proposals.len(),
        skipped_existing,
        limit_reached,
        proposals,
    }))
}

pub(crate) async fn reject_improvement_proposal(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((agent_id, proposal_id)): Path<(AgentId, String)>,
) -> ApiResult<Json<AgentImprovementProposal>> {
    ensure_agent_visible(&state, &jwt, &agent_id).await?;
    let mut proposal = state
        .agent_service
        .get_agent_improvement_proposal(&agent_id, &proposal_id)
        .map_err(|e| map_proposal_lookup_error("loading improvement proposal", e))?;
    if proposal.status == AgentImprovementStatus::Applied {
        return Err(ApiError::conflict("applied proposals cannot be rejected"));
    }
    proposal.status = AgentImprovementStatus::Rejected;
    proposal.error = None;
    proposal.updated_at = Utc::now();
    let saved = state
        .agent_service
        .save_agent_improvement_proposal(proposal)
        .map_err(|e| ApiError::internal(format!("saving rejected proposal: {e}")))?;
    Ok(Json(saved))
}

pub(crate) async fn apply_improvement_proposal(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Path((agent_id, proposal_id)): Path<(AgentId, String)>,
) -> ApiResult<Json<AgentImprovementProposal>> {
    ensure_agent_visible(&state, &jwt, &agent_id).await?;
    let mut proposal = state
        .agent_service
        .get_agent_improvement_proposal(&agent_id, &proposal_id)
        .map_err(|e| map_proposal_lookup_error("loading improvement proposal", e))?;
    if proposal.status == AgentImprovementStatus::Applied {
        return Err(ApiError::conflict("proposal has already been applied"));
    }
    if proposal.status == AgentImprovementStatus::Rejected {
        return Err(ApiError::conflict("rejected proposals cannot be applied"));
    }

    let project_id = if proposal.kind.touches_memory() {
        let project_id = resolve_proposal_project_id(&state, &jwt, &proposal).await?;
        if let Some(project_id) = project_id.as_deref() {
            ensure_agent_project_visible(&state, &jwt, &agent_id, project_id).await?;
        }
        project_id
    } else {
        None
    };

    match apply_proposal_payload(
        &state,
        &agent_id,
        &proposal,
        project_id.as_deref(),
        &auth_session.user_id,
    )
    .await
    {
        Ok(()) => {
            let now = Utc::now();
            proposal.status = AgentImprovementStatus::Applied;
            proposal.error = None;
            proposal.updated_at = now;
            proposal.applied_at = Some(now);
            let saved = state
                .agent_service
                .save_agent_improvement_proposal(proposal)
                .map_err(|e| ApiError::internal(format!("saving applied proposal: {e}")))?;
            state.evict_chat_sessions_for_agent(&agent_id.to_string());
            Ok(Json(saved))
        }
        Err(message) => {
            proposal.status = AgentImprovementStatus::Failed;
            proposal.error = Some(message.clone());
            proposal.updated_at = Utc::now();
            let _ = state
                .agent_service
                .save_agent_improvement_proposal(proposal);
            Err(ApiError::internal(message))
        }
    }
}

async fn ensure_agent_visible(state: &AppState, jwt: &str, agent_id: &AgentId) -> ApiResult<()> {
    if is_capture_access_token(jwt) && *agent_id == demo_agent_id() {
        return Ok(());
    }

    if state
        .agent_service
        .get_agent_with_jwt(jwt, agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(agent_id))
        .is_ok()
    {
        return Ok(());
    }
    Err(ApiError::not_found("agent not found"))
}

async fn ensure_agent_project_visible(
    state: &AppState,
    jwt: &str,
    agent_id: &AgentId,
    project_id: &str,
) -> ApiResult<()> {
    let storage = state
        .storage_client
        .as_deref()
        .ok_or_else(|| ApiError::service_unavailable("aura-storage is not configured"))?;
    let bindings = crate::handlers::agents::chat::find_matching_project_agents(
        state,
        storage,
        jwt,
        &agent_id.to_string(),
    )
    .await;
    let has_binding = bindings
        .iter()
        .any(|binding| binding.project_id.as_deref() == Some(project_id));
    if has_binding {
        return Ok(());
    }

    // Session ownership is a fallback when local project discovery has not
    // populated yet, including the first proposal in a new project chat.
    let agent_id_string = agent_id.to_string();
    let sessions = storage.list_my_sessions(jwt).await.map_err(|error| {
        ApiError::service_unavailable(format!(
            "could not verify project access from sessions: {error}"
        ))
    })?;
    let has_owned_session = sessions.iter().any(|entry| {
        entry.agent_id.as_deref() == Some(agent_id_string.as_str())
            && entry.session.project_id.as_deref() == Some(project_id)
    });
    if has_owned_session {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "agent is not available in the requested project",
        ))
    }
}

async fn resolve_proposal_project_id(
    state: &AppState,
    jwt: &str,
    proposal: &AgentImprovementProposal,
) -> ApiResult<Option<String>> {
    if let Some(project_id) = proposal
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(project_id.to_string()));
    }

    let Some(source_session_id) = proposal.source_session_id.as_deref() else {
        return Ok(None);
    };
    let storage = state
        .storage_client
        .as_deref()
        .ok_or_else(|| ApiError::service_unavailable("aura-storage is not configured"))?;
    let session = storage
        .get_session(source_session_id, jwt)
        .await
        .map_err(|error| {
            ApiError::service_unavailable(format!(
                "could not resolve the proposal's source project: {error}"
            ))
        })?;
    Ok(session.project_id.filter(|value| !value.trim().is_empty()))
}

fn validate_self_improvement_enabled(
    config: &AgentSelfImprovementConfig,
    kind: AgentImprovementKind,
) -> ApiResult<()> {
    if config.mode == AgentSelfImprovementMode::Off {
        return Err(ApiError::forbidden(
            "self-improvement is disabled for this agent",
        ));
    }
    if kind.touches_memory() && !config.allow_memory {
        return Err(ApiError::forbidden(
            "memory proposals are disabled for this agent",
        ));
    }
    if kind.touches_skills() && !config.allow_skills {
        return Err(ApiError::forbidden(
            "skill proposals are disabled for this agent",
        ));
    }
    Ok(())
}

fn validate_proposal_request(body: &ProposeImprovementRequest) -> ApiResult<()> {
    if body.title.trim().is_empty() {
        return Err(ApiError::bad_request("proposal title is required"));
    }
    if body.rationale.trim().is_empty() {
        return Err(ApiError::bad_request("proposal rationale is required"));
    }
    if body.title.len() > 160 {
        return Err(ApiError::bad_request("proposal title is too long"));
    }
    validate_payload_shape(body.kind, body.payload.clone())
}

fn sanitize_evidence(
    evidence: Vec<AgentImprovementEvidence>,
) -> ApiResult<Vec<AgentImprovementEvidence>> {
    if evidence.len() > 5 {
        return Err(ApiError::bad_request(
            "at most 5 evidence items are allowed",
        ));
    }
    evidence
        .into_iter()
        .map(|item| {
            let quote = normalize_text(&item.quote);
            if quote.is_empty() {
                return Err(ApiError::bad_request("evidence quote is required"));
            }
            Ok(AgentImprovementEvidence {
                session_id: clean_optional_string(item.session_id),
                event_id: clean_optional_string(item.event_id),
                event_type: clean_optional_string(item.event_type),
                quote: truncate_chars(&quote, REVIEW_QUOTE_LIMIT),
                created_at: clean_optional_string(item.created_at),
            })
        })
        .collect()
}

fn proposal_from_review_event(
    agent_id: &AgentId,
    review_id: &str,
    event: &StorageSessionEvent,
    project_id: Option<&str>,
    allow_memory: bool,
) -> Option<AgentImprovementProposal> {
    if !allow_memory || event.event_type.as_deref() != Some("user_message") {
        return None;
    }
    let text = normalize_text(&event_text(event)?);
    if text.is_empty() {
        return None;
    }

    if let Some(fact) = extract_after_marker(
        &text,
        &[
            "please remember that ",
            "remember that ",
            "for future reference, ",
            "for future reference ",
            "in the future, remember ",
        ],
    ) {
        return Some(review_memory_fact_proposal(
            agent_id, review_id, event, project_id, &text, &fact,
        ));
    }

    if let Some(procedure) = extract_after_marker(
        &text,
        &[
            "from now on, ",
            "from now on ",
            "next time, ",
            "next time ",
            "going forward, ",
            "going forward ",
        ],
    ) {
        return Some(review_memory_procedure_proposal(
            agent_id, review_id, event, project_id, &text, &procedure,
        ));
    }

    None
}

fn review_memory_fact_proposal(
    agent_id: &AgentId,
    review_id: &str,
    event: &StorageSessionEvent,
    project_id: Option<&str>,
    full_text: &str,
    fact: &str,
) -> AgentImprovementProposal {
    let now = Utc::now();
    let fact = truncate_chars(fact, 220);
    let dedup_key = stable_dedup_key("memory_fact", &fact);
    AgentImprovementProposal {
        id: Uuid::new_v4().to_string(),
        agent_id: *agent_id,
        kind: AgentImprovementKind::MemoryFact,
        title: format!("Remember {}", sentence_fragment(&fact, 72)),
        rationale: "Learning review found an explicit durable instruction in a recent session."
            .to_string(),
        source_session_id: event.session_id.clone(),
        project_id: project_id.map(str::to_string),
        evidence: vec![review_evidence(event, full_text)],
        provenance: AgentImprovementProvenance {
            source: AgentImprovementSource::LearningReview,
            created_by: "learning_review".to_string(),
            review_id: Some(review_id.to_string()),
        },
        dedup_key: Some(dedup_key),
        payload: serde_json::json!({
            "key": memory_fact_key(&fact),
            "value": fact,
            "confidence": 0.82,
            "importance": 0.68
        }),
        status: AgentImprovementStatus::Pending,
        error: None,
        created_at: now,
        updated_at: now,
        applied_at: None,
    }
}

fn review_memory_procedure_proposal(
    agent_id: &AgentId,
    review_id: &str,
    event: &StorageSessionEvent,
    project_id: Option<&str>,
    full_text: &str,
    procedure: &str,
) -> AgentImprovementProposal {
    let now = Utc::now();
    let procedure = truncate_chars(procedure, 220);
    let dedup_key = stable_dedup_key("memory_procedure", &procedure);
    AgentImprovementProposal {
        id: Uuid::new_v4().to_string(),
        agent_id: *agent_id,
        kind: AgentImprovementKind::MemoryProcedure,
        title: format!("Follow {}", sentence_fragment(&procedure, 72)),
        rationale: "Learning review found a future-work instruction in a recent session."
            .to_string(),
        source_session_id: event.session_id.clone(),
        project_id: project_id.map(str::to_string),
        evidence: vec![review_evidence(event, full_text)],
        provenance: AgentImprovementProvenance {
            source: AgentImprovementSource::LearningReview,
            created_by: "learning_review".to_string(),
            review_id: Some(review_id.to_string()),
        },
        dedup_key: Some(dedup_key),
        payload: serde_json::json!({
            "name": format!("learning_review_{}", slug_fragment(&procedure, 40)),
            "trigger": "When future work matches this user instruction.",
            "steps": [procedure],
            "skill_relevance": 0.65
        }),
        status: AgentImprovementStatus::Pending,
        error: None,
        created_at: now,
        updated_at: now,
        applied_at: None,
    }
}

fn review_evidence(event: &StorageSessionEvent, full_text: &str) -> AgentImprovementEvidence {
    AgentImprovementEvidence {
        session_id: event.session_id.clone(),
        event_id: Some(event.id.clone()),
        event_type: event.event_type.clone(),
        quote: truncate_chars(full_text, REVIEW_QUOTE_LIMIT),
        created_at: event.created_at.clone(),
    }
}

fn event_text(event: &StorageSessionEvent) -> Option<String> {
    let content = event.content.as_ref()?;
    content
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| content.get("message").and_then(Value::as_str))
        .or_else(|| content.as_str())
        .map(ToString::to_string)
}

fn extract_after_marker(text: &str, markers: &[&str]) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    for marker in markers {
        if let Some(index) = lower.find(marker) {
            let candidate = &text[index + marker.len()..];
            let cleaned = clean_instruction(candidate);
            if cleaned.len() >= 8 {
                return Some(cleaned);
            }
        }
    }
    None
}

fn clean_instruction(value: &str) -> String {
    let first_line = value.lines().next().unwrap_or(value);
    let trimmed = first_line
        .trim()
        .trim_matches(|c: char| matches!(c, '"' | '\'' | '`' | ':' | '-' | ' '));
    let sentence_end = trimmed
        .char_indices()
        .find_map(|(index, ch)| matches!(ch, '.' | '!' | '?').then_some(index + ch.len_utf8()))
        .unwrap_or(trimmed.len());
    normalize_text(&trimmed[..sentence_end])
}

fn normalize_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|trimmed| !trimmed.is_empty())
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max_chars.saturating_sub(3)).collect();
    out.push_str("...");
    out
}

fn sentence_fragment(value: &str, max_chars: usize) -> String {
    let fragment = truncate_chars(value, max_chars);
    fragment.trim().trim_end_matches('.').trim().to_string()
}

fn memory_fact_key(value: &str) -> String {
    format!("learning.{}", slug_fragment(value, 48))
}

fn slug_fragment(value: &str, max_len: usize) -> String {
    let mut out = String::new();
    let mut last_was_separator = false;
    for ch in value.chars() {
        if out.len() >= max_len {
            break;
        }
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator && !out.is_empty() {
            out.push('_');
            last_was_separator = true;
        }
    }
    let slug = out.trim_matches('_').to_string();
    if slug.is_empty() {
        "instruction".to_string()
    } else {
        slug
    }
}

fn stable_dedup_key(kind: &str, value: &str) -> String {
    let normalized = normalize_text(value).to_ascii_lowercase();
    let mut hash = 0xcbf29ce484222325u64;
    for byte in normalized.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("learning_review:{kind}:{hash:016x}")
}

fn validate_payload_shape(kind: AgentImprovementKind, payload: Value) -> ApiResult<()> {
    match kind {
        AgentImprovementKind::MemoryFact => {
            let parsed: MemoryFactPayload = parse_payload(payload)?;
            require_non_empty("key", &parsed.key)?;
            if parsed.value.is_null() {
                return Err(ApiError::bad_request("value is required"));
            }
            validate_optional_unit_interval("confidence", parsed.confidence)?;
            validate_optional_unit_interval("importance", parsed.importance)?;
        }
        AgentImprovementKind::MemoryProcedure => {
            let parsed: MemoryProcedurePayload = parse_payload(payload)?;
            require_non_empty("name", &parsed.name)?;
            require_non_empty("trigger", &parsed.trigger)?;
            if parsed.steps.is_empty() || parsed.steps.iter().all(|step| step.trim().is_empty()) {
                return Err(ApiError::bad_request("procedure steps are required"));
            }
            if let Some(skill_name) = parsed.skill_name.as_deref() {
                require_non_empty("skill_name", skill_name)?;
            }
            validate_optional_unit_interval("skill_relevance", parsed.skill_relevance)?;
            if parsed
                .context_constraints
                .as_ref()
                .is_some_and(|value| !value.is_object())
            {
                return Err(ApiError::bad_request(
                    "context_constraints must be an object when provided",
                ));
            }
        }
        AgentImprovementKind::SkillCreate => {
            let parsed: SkillCreatePayload = parse_payload(payload)?;
            require_non_empty("name", &parsed.name)?;
            require_non_empty("description", &parsed.description)?;
        }
        AgentImprovementKind::SkillUpdate => {
            let parsed: SkillUpdatePayload = parse_payload(payload)?;
            require_non_empty("name", &parsed.name)?;
            require_non_empty("description", &parsed.description)?;
        }
    }
    Ok(())
}

async fn apply_proposal_payload(
    state: &AppState,
    agent_id: &AgentId,
    proposal: &AgentImprovementProposal,
    project_id: Option<&str>,
    user_id: &str,
) -> Result<(), String> {
    match proposal.kind {
        AgentImprovementKind::MemoryFact => {
            apply_memory_fact(state, agent_id, &proposal.payload, project_id, user_id).await
        }
        AgentImprovementKind::MemoryProcedure => {
            apply_memory_procedure(state, agent_id, &proposal.payload, project_id, user_id).await
        }
        AgentImprovementKind::SkillCreate => {
            apply_skill_create(state, agent_id, proposal.payload.clone()).await
        }
        AgentImprovementKind::SkillUpdate => {
            apply_skill_update(state, proposal.payload.clone()).await
        }
    }
}

async fn apply_memory_fact(
    state: &AppState,
    agent_id: &AgentId,
    payload: &Value,
    project_id: Option<&str>,
    user_id: &str,
) -> Result<(), String> {
    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let query = scoped_memory_query(project_id, user_id);
    let ok = state
        .harness_http
        .proxy_json(
            Method::POST,
            &format!("api/agents/{agent_id}/memory/facts"),
            Some(query),
            Some(body),
        )
        .await
        .is_ok_and(|response| response.status().is_success());
    if ok {
        Ok(())
    } else {
        Err("failed to apply memory fact proposal".to_string())
    }
}

async fn apply_memory_procedure(
    state: &AppState,
    agent_id: &AgentId,
    payload: &Value,
    project_id: Option<&str>,
    user_id: &str,
) -> Result<(), String> {
    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let query = scoped_memory_query(project_id, user_id);
    let ok = state
        .harness_http
        .proxy_json(
            Method::POST,
            &format!("api/agents/{agent_id}/memory/procedures"),
            Some(query),
            Some(body),
        )
        .await
        .is_ok_and(|response| response.status().is_success());
    if ok {
        Ok(())
    } else {
        Err("failed to apply memory procedure proposal".to_string())
    }
}

fn scoped_memory_query(project_id: Option<&str>, user_id: &str) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    if let Some(project_id) = project_id.filter(|value| !value.trim().is_empty()) {
        serializer.append_pair("project_id", project_id);
    }
    serializer.append_pair("user_id", user_id);
    serializer.finish()
}

async fn apply_skill_create(
    state: &AppState,
    agent_id: &AgentId,
    payload: Value,
) -> Result<(), String> {
    let parsed: SkillCreatePayload = parse_payload_for_apply(payload)?;
    create_skill_from_payload(
        state,
        CreateSkillBody {
            name: parsed.name,
            description: parsed.description,
            body: parsed.body,
            allowed_tools: parsed.allowed_tools,
            model: parsed.model,
            context: parsed.context,
            user_invocable: parsed.user_invocable,
            model_invocable: parsed.model_invocable,
            agent_target: None,
            agent_id: Some(agent_id.to_string()),
        },
    )
    .await
    .map(|_| ())
    .map_err(status_message)
}

async fn apply_skill_update(state: &AppState, payload: Value) -> Result<(), String> {
    let parsed: SkillUpdatePayload = parse_payload_for_apply(payload)?;
    update_my_skill_from_payload(
        state,
        parsed.name,
        UpdateSkillBody {
            description: parsed.description,
            body: parsed.body,
            allowed_tools: parsed.allowed_tools,
            model: parsed.model,
            context: parsed.context,
            user_invocable: parsed.user_invocable,
            model_invocable: parsed.model_invocable,
            agent_target: None,
        },
    )
    .await
    .map(|_| ())
    .map_err(status_message)
}

fn parse_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> ApiResult<T> {
    serde_json::from_value(payload)
        .map_err(|e| ApiError::bad_request(format!("invalid proposal payload: {e}")))
}

fn parse_payload_for_apply<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|e| format!("invalid proposal payload: {e}"))
}

fn require_non_empty(field: &str, value: &str) -> ApiResult<()> {
    if value.trim().is_empty() {
        return Err(ApiError::bad_request(format!("{field} is required")));
    }
    Ok(())
}

fn validate_optional_unit_interval(field: &str, value: Option<f64>) -> ApiResult<()> {
    if let Some(value) = value {
        if !(0.0..=1.0).contains(&value) {
            return Err(ApiError::bad_request(format!(
                "{field} must be between 0 and 1"
            )));
        }
    }
    Ok(())
}

fn status_message(status: axum::http::StatusCode) -> String {
    format!("failed to apply skill proposal: upstream returned {status}")
}

fn map_proposal_lookup_error(
    context: &'static str,
    err: aura_os_agents::AgentError,
) -> (axum::http::StatusCode, Json<ApiError>) {
    match err {
        aura_os_agents::AgentError::NotFound => {
            ApiError::not_found("improvement proposal not found")
        }
        other => ApiError::internal(format!("{context}: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn memory_procedure_context_constraints_must_be_object() {
        assert!(validate_payload_shape(
            AgentImprovementKind::MemoryProcedure,
            json!({
                "name": "handoff_style",
                "trigger": "When preparing a handoff",
                "steps": ["Use concise bullets"],
                "context_constraints": { "surface": "handoff" }
            }),
        )
        .is_ok());

        assert!(validate_payload_shape(
            AgentImprovementKind::MemoryProcedure,
            json!({
                "name": "handoff_style",
                "trigger": "When preparing a handoff",
                "steps": ["Use concise bullets"],
                "context_constraints": "handoff"
            }),
        )
        .is_err());
    }
}
