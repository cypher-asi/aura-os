use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::warn;
use uuid::Uuid;

use aura_os_core::{ProjectId, Task};

use crate::bug_report_store::{BugReport, BugReportStore};
use crate::error::{ApiError, ApiResult};
use crate::handlers::permissions::require_sys_admin;
use crate::state::{AppState, AuthJwt, AuthSession};

const BUG_REPORT_MODEL: &str = "aura-claude-opus-4-8";
const BUG_REPORT_MAX_TOKENS: u32 = 2048;

/// Feedback-post shape used when a bug report is mirrored into the public
/// Feedback app. Only the user's free-text description is published — the
/// private diagnostics bundle and the Opus triage summary stay in the
/// admin-only `BugReportStore`, honoring the consent boundary the user
/// agreed to (share prompt/conversation data with the dev team only).
const BUG_FEEDBACK_EVENT_TYPE: &str = "feedback";
const BUG_FEEDBACK_POST_TYPE: &str = "post";
const BUG_FEEDBACK_CATEGORY: &str = "bug";
const BUG_FEEDBACK_STATUS: &str = "not_started";
const BUG_FEEDBACK_PRODUCT: &str = "aura";
const BUG_REPORT_SYSTEM_PROMPT: &str = "You are an expert software engineer triaging a private bug report for the AURA dev team. \
You are given a free-text description of an issue plus a JSON bundle of diagnostics (prompt/conversation context, model, agent/session identity, error details, and machine/environment info). \
Respond in GitHub-flavoured markdown with exactly three sections: \
(1) `## Summary` — a concise, plain-language summary of the issue; \
(2) `## Likely root cause` — your best assessment of what is going wrong and why, grounded in the diagnostics; \
(3) `## Possible fixes` — a ranked, numbered list of concrete fixes from most to least likely to resolve the issue. \
Be specific and technical. Do not invent details that are not supported by the report.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateBugReportRequest {
    pub description: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub diagnostics: serde_json::Value,
    #[serde(default)]
    pub consent: bool,
    #[serde(default)]
    pub consent_version: Option<String>,
    #[serde(default)]
    pub feedback_post_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateBugReportResponse {
    pub id: Uuid,
    /// Public Feedback post the report was mirrored into, when one was
    /// created. Lets the client confirm/link the submission in the
    /// Feedback section. `None` when the feedback-network call failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback_post_id: Option<String>,
}

/// Generate the Opus 4.8 triage summary by calling aura-router's
/// Anthropic-style `/v1/messages` endpoint, mirroring the round-trip
/// shape used by `generate_session_summary`.
async fn generate_bug_report_summary(
    state: &AppState,
    jwt: &str,
    description: &str,
    diagnostics: &serde_json::Value,
) -> Result<String, String> {
    let diagnostics_text =
        serde_json::to_string_pretty(diagnostics).unwrap_or_else(|_| diagnostics.to_string());
    let user_content = format!(
        "Issue description:\n{description}\n\nDiagnostics bundle (JSON):\n{diagnostics_text}"
    );

    let req_body = json!({
        "model": BUG_REPORT_MODEL,
        "max_tokens": BUG_REPORT_MAX_TOKENS,
        "system": [
            {
                "type": "text",
                "text": BUG_REPORT_SYSTEM_PROMPT,
                "cache_control": { "type": "ephemeral" }
            }
        ],
        "messages": [{ "role": "user", "content": user_content }],
    });

    let resp = state
        .http_client
        .post(format!("{}/v1/messages", state.router_url))
        .bearer_auth(jwt)
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM returned {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parsing LLM response: {e}"))?;

    let text = body
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("LLM returned empty content".to_string());
    }
    Ok(text)
}

/// Derive a concise feedback-post title from the report description: the
/// first non-empty line, trimmed to 80 chars. Falls back to a generic
/// label so the mirrored post always has a title.
fn feedback_title_from_description(description: &str) -> String {
    let head = description
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("Reported issue");
    head.chars().take(80).collect()
}

/// Publish the user's bug description as a public Feedback "bug" post and
/// return the new post id. Only the description is shared; the private
/// diagnostics bundle never leaves the admin-only `BugReportStore`.
async fn create_feedback_bug_post(
    state: &AppState,
    jwt: &str,
    profile_id: Option<&str>,
    description: &str,
) -> Result<String, String> {
    let client = state
        .require_feedback_network_client()
        .map_err(|_| "aura-network is not configured".to_string())?;
    let body = description.trim();
    let title = feedback_title_from_description(body);
    let metadata = json!({
        "feedbackCategory": BUG_FEEDBACK_CATEGORY,
        "feedbackStatus": BUG_FEEDBACK_STATUS,
        "feedbackProduct": BUG_FEEDBACK_PRODUCT,
        "body": body,
    });
    let post = client
        .create_post(&aura_os_network::client::CreatePostParams {
            title: &title,
            event_type: BUG_FEEDBACK_EVENT_TYPE,
            summary: Some(body),
            post_type: Some(BUG_FEEDBACK_POST_TYPE),
            metadata: Some(metadata),
            profile_id,
            project_id: None,
            agent_id: None,
            user_id: None,
            org_id: None,
            push_id: None,
            commit_ids: None,
            jwt,
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(post.id)
}

/// Generate the Opus triage summary off the request path and attach it to
/// the stored report once it lands. Kept out of `create_bug_report` so
/// "Send report" returns immediately instead of blocking on a multi-second
/// LLM generation. The summary is admin-only triage metadata; every failure
/// is logged and swallowed because the report is already fully persisted.
fn spawn_bug_report_summary(
    state: AppState,
    jwt: String,
    report_id: Uuid,
    description: String,
    diagnostics: serde_json::Value,
) {
    tokio::spawn(async move {
        let summary = match generate_bug_report_summary(&state, &jwt, &description, &diagnostics)
            .await
        {
            Ok(summary) => summary,
            Err(error) => {
                warn!(%report_id, %error, "bug report LLM summary failed; report persisted without summary");
                return;
            }
        };
        let store = BugReportStore::new(state.store.clone());
        match store.get(&report_id) {
            Ok(Some(mut report)) => {
                report.llm_summary = Some(summary);
                if let Err(error) = store.put(&report) {
                    warn!(%report_id, %error, "bug report: failed to persist llm summary");
                }
            }
            Ok(None) => warn!(%report_id, "bug report: vanished before summary could attach"),
            Err(error) => {
                warn!(%report_id, %error, "bug report: failed to reload for summary attach")
            }
        }
    });
}

pub(crate) async fn create_bug_report(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateBugReportRequest>,
) -> ApiResult<(StatusCode, Json<CreateBugReportResponse>)> {
    if !req.consent {
        return Err(ApiError::bad_request(
            "consent is required to submit a bug report",
        ));
    }
    if req.description.trim().is_empty() {
        return Err(ApiError::bad_request("description is required"));
    }

    // Route every bug report into the public Feedback app as a Bug post so
    // the reporter actually sees it land in the Feedback section. Best-effort:
    // a feedback-network failure must never lose the private report or block
    // the user, so we warn and fall back to no linked post. An explicit
    // `feedbackPostId` from the client (rare) wins over creating a new one.
    let profile_id_str = session.profile_id.map(|id| id.to_string());
    let feedback_post_id = match req.feedback_post_id.clone() {
        Some(existing) if !existing.trim().is_empty() => Some(existing),
        _ => match create_feedback_bug_post(
            &state,
            &jwt,
            profile_id_str.as_deref(),
            &req.description,
        )
        .await
        {
            Ok(post_id) => Some(post_id),
            Err(error) => {
                warn!(%error, "bug report: failed to create linked feedback post; continuing");
                None
            }
        },
    };

    let now = Utc::now();
    let report = BugReport {
        id: Uuid::new_v4(),
        created_at: now,
        user_id: session.user_id.clone(),
        network_user_id: session.network_user_id.map(|id| id.to_string()),
        display_name: session.display_name.clone(),
        description: req.description.clone(),
        category: req.category,
        severity: req.severity,
        diagnostics: req.diagnostics.clone(),
        llm_summary: None,
        status: "new".to_string(),
        consent: req.consent,
        consent_version: req.consent_version,
        consented_at: Some(now),
        feedback_post_id: feedback_post_id.clone(),
        linked_task_id: None,
        linked_project_id: None,
    };

    let store = BugReportStore::new(state.store.clone());
    store.put(&report).map_err(ApiError::internal)?;

    spawn_bug_report_summary(
        state.clone(),
        jwt,
        report.id,
        req.description,
        req.diagnostics,
    );

    Ok((
        StatusCode::CREATED,
        Json(CreateBugReportResponse {
            id: report.id,
            feedback_post_id,
        }),
    ))
}

pub(crate) async fn list_bug_reports(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
) -> ApiResult<Json<Vec<BugReport>>> {
    require_sys_admin(&session)?;
    let store = BugReportStore::new(state.store.clone());
    let reports = store.list().map_err(ApiError::internal)?;
    Ok(Json(reports))
}

pub(crate) async fn get_bug_report(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<BugReport>> {
    require_sys_admin(&session)?;
    let uuid = Uuid::parse_str(&id).map_err(|_| ApiError::bad_request("invalid bug report id"))?;
    let store = BugReportStore::new(state.store.clone());
    let report = store
        .get(&uuid)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("bug report not found"))?;
    Ok(Json(report))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateFixTaskRequest {
    pub project_id: String,
    #[serde(default)]
    pub agent_instance_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateFixTaskResponse {
    pub task: Task,
    pub project_id: String,
    pub bug_report_id: Uuid,
}

/// Stable, machine-readable marker embedded as the trailing line of the
/// fix task's description so the linkage is resolvable from the task side
/// even without a first-class storage column. The authoritative link is
/// `BugReport::linked_task_id` (scanned by the completion hook); this is a
/// human/agent-visible breadcrumb that survives task edits.
fn bug_report_marker(id: &Uuid) -> String {
    format!("bug_report_id: {id}")
}

/// Compose a one-line spec/task title from the report. Prefers the first
/// non-empty line of the user's description, trimmed to a sane length.
fn fix_task_title(report: &BugReport) -> String {
    let head = report
        .description
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("reported issue");
    let truncated: String = head.chars().take(80).collect();
    format!("Fix: {truncated}")
}

/// Build the spec markdown body from the stored Opus analysis plus the
/// original report. The summary already contains root cause + ranked
/// fixes; we frame it with the user's description and a compact slice of
/// the diagnostics so the agent has grounding without the full bundle.
fn fix_spec_markdown(report: &BugReport) -> String {
    let mut out = String::new();
    out.push_str("## Reported issue\n\n");
    if report.description.trim().is_empty() {
        out.push_str("_No description provided._\n");
    } else {
        out.push_str(report.description.trim());
        out.push('\n');
    }
    if let Some(summary) = report.llm_summary.as_deref().map(str::trim) {
        if !summary.is_empty() {
            out.push_str("\n## Triage analysis\n\n");
            out.push_str(summary);
            out.push('\n');
        }
    }
    let diagnostics_text = serde_json::to_string_pretty(&report.diagnostics)
        .unwrap_or_else(|_| report.diagnostics.to_string());
    if diagnostics_text.trim() != "null" && !diagnostics_text.trim().is_empty() {
        out.push_str("\n## Key diagnostics\n\n```json\n");
        out.push_str(diagnostics_text.trim());
        out.push_str("\n```\n");
    }
    out
}

/// Admin-only: turn a bug report into an assigned fix task. Generates a
/// spec from the stored Opus analysis (no streaming harness call), creates
/// a task under it assigned to the chosen or default project agent, and
/// links the result both ways (and flips an associated feedback post to
/// `in_progress`).
pub(crate) async fn create_fix_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<CreateFixTaskRequest>,
) -> ApiResult<Json<CreateFixTaskResponse>> {
    require_sys_admin(&session)?;

    let uuid = Uuid::parse_str(&id).map_err(|_| ApiError::bad_request("invalid bug report id"))?;
    let project_id = req
        .project_id
        .parse::<ProjectId>()
        .map_err(|_| ApiError::bad_request("invalid project_id: must be a UUID"))?;

    let store = BugReportStore::new(state.store.clone());
    let mut report = store
        .get(&uuid)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("bug report not found"))?;

    let storage = state.require_storage_client()?;

    let title = fix_task_title(&report);
    let spec_markdown = fix_spec_markdown(&report);

    let spec = storage
        .create_spec(
            &project_id.to_string(),
            &jwt,
            &aura_os_storage::CreateSpecRequest {
                title: title.clone(),
                org_id: None,
                order_index: None,
                markdown_contents: Some(spec_markdown),
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("creating fix spec: {e}")))?;

    // Resolve the agent to assign: an explicit instance wins; otherwise
    // fall back to the project's canonical Loop instance. If neither
    // resolves, the task is still created unassigned.
    let assigned_agent_instance_id = match req.agent_instance_id.clone() {
        Some(id) if !id.trim().is_empty() => Some(id),
        _ => match state
            .agent_instance_service
            .ensure_default_loop_instance(&project_id)
            .await
        {
            Ok(instance) => Some(instance.agent_instance_id.to_string()),
            Err(error) => {
                warn!(%project_id, %error, "fix-task: no default agent resolved; creating task unassigned");
                None
            }
        },
    };

    let task_description = format!(
        "Investigate and fix the reported issue. See the linked spec for the triage analysis and \
         diagnostics.\n\n{}",
        bug_report_marker(&uuid)
    );

    let created = storage
        .create_task(
            &project_id.to_string(),
            &jwt,
            &aura_os_storage::CreateTaskRequest {
                spec_id: spec.id.clone(),
                title,
                org_id: None,
                description: Some(task_description),
                status: Some("backlog".to_string()),
                order_index: None,
                dependency_ids: None,
                assigned_project_agent_id: assigned_agent_instance_id,
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("creating fix task: {e}")))?;
    let task = Task::try_from(created).map_err(ApiError::internal)?;

    report.linked_task_id = Some(task.task_id.to_string());
    report.linked_project_id = Some(project_id.to_string());
    report.status = "in_progress".to_string();
    store.put(&report).map_err(ApiError::internal)?;

    if let Some(post_id) = report.feedback_post_id.as_deref() {
        if let Err(error) = set_feedback_status(&state, &jwt, post_id, "in_progress").await {
            warn!(%post_id, %error, "fix-task: failed to set feedback status to in_progress");
        }
    }

    Ok(Json(CreateFixTaskResponse {
        task,
        project_id: project_id.to_string(),
        bug_report_id: uuid,
    }))
}

/// Best-effort feedback status patch reusing the aura-network metadata
/// path that `update_feedback_status` drives (`feedbackStatus`). Returns
/// an error string the caller logs and swallows.
async fn set_feedback_status(
    state: &AppState,
    jwt: &str,
    post_id: &str,
    status: &str,
) -> Result<(), String> {
    let client = state
        .require_feedback_network_client()
        .map_err(|_| "aura-network is not configured".to_string())?;
    let patch = json!({ "feedbackStatus": status });
    client
        .patch_post_metadata(post_id, &patch, jwt)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Completion hook: when a fix task reaches a terminal `Done`, mark the
/// linked bug report resolved and flip any associated feedback post to
/// `done`. Best-effort — every failure is logged and swallowed so it can
/// never unwind the task transition that triggered it.
pub(crate) async fn resolve_linked_bug_report_on_done(state: &AppState, jwt: &str, task_id: &str) {
    let store = BugReportStore::new(state.store.clone());
    let reports = match store.list() {
        Ok(reports) => reports,
        Err(error) => {
            warn!(%task_id, %error, "fix-task completion hook: failed to scan bug reports");
            return;
        }
    };
    let Some(mut report) = reports
        .into_iter()
        .find(|r| r.linked_task_id.as_deref() == Some(task_id))
    else {
        return;
    };

    report.status = "resolved".to_string();
    if let Err(error) = store.put(&report) {
        warn!(report_id = %report.id, %error, "fix-task completion hook: failed to mark report resolved");
    }

    if let Some(post_id) = report.feedback_post_id.as_deref() {
        if let Err(error) = set_feedback_status(state, jwt, post_id, "done").await {
            warn!(%post_id, %error, "fix-task completion hook: failed to set feedback status to done");
        }
    }
}

pub(crate) async fn list_my_bug_reports(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
) -> ApiResult<Json<Vec<BugReport>>> {
    let store = BugReportStore::new(state.store.clone());
    let network_user_id = session.network_user_id.map(|id| id.to_string());
    let reports = store
        .list()
        .map_err(ApiError::internal)?
        .into_iter()
        .filter(|r| {
            r.user_id == session.user_id
                || (network_user_id.is_some() && r.network_user_id == network_user_id)
        })
        .collect();
    Ok(Json(reports))
}
