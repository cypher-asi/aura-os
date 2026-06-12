use aura_os_core::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CreateProjectRequest {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
    /// Local-only, per-machine project working directory. Absolute OS path.
    #[serde(default)]
    pub local_workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
    /// Patch for the local workspace folder.
    /// - Absent: leaves the stored value unchanged.
    /// - `Some("")` or `Some(null)` (via `Some(None)`): clears the override.
    /// - `Some(Some("..."))`: sets a new path.
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub local_workspace_path: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportedProjectFile {
    pub relative_path: String,
    pub contents_base64: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateImportedProjectRequest {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub files: Vec<ImportedProjectFile>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
    #[serde(default)]
    pub local_workspace_path: Option<String>,
}

// Frontend (`interface/src/shared/api/tasks.ts`) and the existing
// integration tests POST `{"new_status": ...}`, so that stays the
// canonical name. The harness's `HttpDomainApi::transition_task` POSTs
// `{"status": ...}` (matching aura-storage's internal request shape),
// which used to 422 with "missing field `new_status`". Every dev-loop
// transition (`pending` -> `in_progress`, `in_progress` -> `done`,
// `pending` -> `failed`, retry sync, ...) silently failed. Locally the
// loop reported `Dev loop finished outcome=all_tasks_blocked completed=3
// failed=1`, but server-side the task records never left their initial
// state, so `[preflight] FAIL loop_progress ... no task reached a
// terminal state within 180000ms`. Accept either field name with a
// serde alias so both clients deserialize cleanly.
#[derive(Debug, Deserialize)]
pub(crate) struct TransitionTaskRequest {
    #[serde(alias = "status")]
    pub new_status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub(crate) struct ActiveLoopTask {
    pub task_id: String,
    pub agent_instance_id: AgentInstanceId,
}

#[derive(Debug, Serialize)]
pub(crate) struct LoopStatusResponse {
    pub running: bool,
    pub paused: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_state: Option<String>,
    pub project_id: Option<ProjectId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_instance_id: Option<AgentInstanceId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_agent_instances: Option<Vec<AgentInstanceId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_remaining_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_kind: Option<String>,
    /// Per-agent tasks currently streaming output. Read from
    /// `LoopActivity.current_task_id` on every Automation / TaskRun
    /// loop registered for the project so clients can rehydrate the
    /// Run panel and per-task "live" indicators after a page refresh
    /// (WS `task_started` events are not replayed, so this is the
    /// only HTTP path that exposes "what task is running right now").
    /// Empty / absent when no automatons are working a task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tasks: Option<Vec<ActiveLoopTask>>,
}

// -- Agent DTOs (user-level) --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateAgentRequest {
    #[serde(default)]
    pub org_id: Option<OrgId>,
    pub name: String,
    pub role: String,
    pub personality: String,
    pub system_prompt: String,
    #[serde(default)]
    pub skills: Vec<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub machine_type: Option<String>,
    #[serde(default)]
    pub adapter_type: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub auth_source: Option<String>,
    #[serde(default)]
    pub integration_id: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Marketplace discoverability: `closed` (default) or `hireable`. Encoded
    /// as a `listing_status:<value>` tag on the stored agent until Phase 3
    /// promotes it to a dedicated column on the network agent record.
    #[serde(default)]
    pub listing_status: Option<String>,
    /// Marketplace expertise slugs. Validated against
    /// [`aura_os_core::expertise::ALLOWED_SLUGS`] and persisted as
    /// `expertise:<slug>` tags. Dedupe is applied server-side.
    #[serde(default)]
    pub expertise: Option<Vec<String>>,
    /// Per-agent local working directory override (absolute path). Applied only
    /// for local machines; takes precedence over the project's folder.
    #[serde(default)]
    pub local_workspace_path: Option<String>,
    /// Required capability + scope bundle for the new agent. Regular agents
    /// pass [`aura_os_core::AgentPermissions::empty`] and opt into capabilities
    /// via the Permissions tab; the CEO bootstrap is the only path that ships
    /// [`aura_os_core::AgentPermissions::ceo_preset`] by default.
    pub permissions: aura_os_core::AgentPermissions,
    /// Optional intent classifier spec (CEO-style agents only).
    #[serde(default)]
    pub intent_classifier: Option<aura_os_core::IntentClassifierSpec>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAgentRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub personality: Option<String>,
    pub system_prompt: Option<String>,
    pub skills: Option<Vec<String>>,
    pub icon: Option<Option<String>>,
    pub machine_type: Option<String>,
    #[serde(default)]
    pub adapter_type: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub auth_source: Option<String>,
    #[serde(default)]
    pub integration_id: Option<Option<String>>,
    #[serde(default)]
    pub default_model: Option<Option<String>>,
    /// Replacement tag set. `None` leaves existing tags untouched; `Some` overwrites.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Marketplace discoverability override. `None` leaves the existing
    /// `listing_status:*` tag untouched; `Some(value)` replaces it.
    #[serde(default)]
    pub listing_status: Option<String>,
    /// Replacement expertise set. `None` leaves existing `expertise:*` tags
    /// untouched; `Some` replaces all of them.
    #[serde(default)]
    pub expertise: Option<Vec<String>>,
    /// `None` leaves the value unchanged. `Some(None)` clears the override.
    /// `Some(Some("..."))` sets a new path.
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub local_workspace_path: Option<Option<String>>,
    /// Optional replacement for the agent's capability bundle. `None`
    /// leaves the existing permissions untouched.
    #[serde(default)]
    pub permissions: Option<aura_os_core::AgentPermissions>,
    /// Optional replacement for the intent classifier spec. `None` leaves
    /// the existing value untouched.
    #[serde(default)]
    pub intent_classifier: Option<aura_os_core::IntentClassifierSpec>,
}

// -- Marketplace DTOs --

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MarketplaceAgent {
    pub agent: Agent,
    pub description: String,
    pub completed_tasks: u64,
    pub jobs: u64,
    pub revenue_usd: f64,
    pub reputation: f32,
    pub creator_display_name: String,
    pub creator_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_image_url: Option<String>,
    pub listed_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ListMarketplaceAgentsQuery {
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub expertise: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ListMarketplaceAgentsResponse {
    pub agents: Vec<MarketplaceAgent>,
    pub total: u64,
}

// -- AgentInstance DTOs (project-level) --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateAgentInstanceRequest {
    #[serde(default)]
    pub agent_id: Option<AgentId>,
    #[serde(default)]
    pub kind: Option<String>,
    /// Provenance marker for the new instance row. Drives the projects
    /// sidebar's `isUserFacingAgentInstance` filter on the frontend.
    /// When omitted, the handler defaults to `"ui"` so legacy callers
    /// (and the UI's existing "+" buttons) continue to surface in the
    /// sidebar. Non-UI callers (SDK scripts, benchmarks, e2e fixtures,
    /// new-project Standard-Agent auto-attach) should send an explicit
    /// non-`"ui"` value (`"sdk"`, `"auto_project_default"`, etc.).
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAgentInstanceRequest {
    pub name: Option<String>,
    pub status: Option<String>,
}

// -- Chat DTOs --

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ChatAttachmentDto {
    #[serde(rename = "type")]
    pub type_: String,
    pub media_type: String,
    pub data: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SendChatRequest {
    pub content: String,
    pub action: Option<String>,
    pub model: Option<String>,
    pub commands: Option<Vec<String>>,
    pub project_id: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<ChatAttachmentDto>>,
    #[serde(default)]
    pub new_session: Option<bool>,
    /// When set, route this turn into the specified storage session id.
    /// The handler validates the session belongs to the target agent
    /// before routing — a stale URL never silently writes into the
    /// wrong session. When `new_session` is also true, `new_session`
    /// wins and a fresh session is created.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Set by `send_to_agent` in aura-harness when agent A messages
    /// agent B. Threaded onto [`crate::handlers::agents::chat::ChatPersistCtx`]
    /// and read by `persist_task` to post B's reply back into A's
    /// session as a follow-up `user_message`. Older clients omit the
    /// field — `#[serde(default)]` keeps wire compat. Cross-repo
    /// contract documented in
    /// `c:\code\aura-harness\crates\aura-runtime\src\session\cross_agent_hook.rs::deliver_message`.
    #[serde(default)]
    pub originating_agent_id: Option<String>,
    /// Org-level `agents.agent_id` UUID of the agent that injected
    /// this `user_message` on behalf of cross-agent communication
    /// (rather than a human user typing into the box). Distinct from
    /// `originating_agent_id`, which exists for *routing* (the
    /// server uses it to know where to POST the recipient's reply
    /// back to). `from_agent_id` exists for *display*: the chat
    /// panel renders the resulting user-row with a "↩ from
    /// <agent_name>" badge so the operator can tell a real prompt
    /// apart from a cross-agent reply.
    ///
    /// Two paths populate it:
    /// 1. **A → B inbound** (`send_to_agent`) — the harness's
    ///    `cross_agent_hook::deliver_message` POSTs `from_agent_id:
    ///    A's UUID` so B's panel labels the inbound row "from <A>".
    /// 2. **B → A async reply** — the server-side
    ///    `spawn_cross_agent_reply_callback` POSTs `from_agent_id:
    ///    B's UUID` so A's panel labels Barret's reply "from <B>"
    ///    instead of looking like a duplicate user prompt.
    ///
    /// Older clients omit the field — `#[serde(default)]` keeps
    /// wire compat (a missing value just renders as a normal user
    /// message, the pre-fix behavior).
    #[serde(default)]
    pub from_agent_id: Option<String>,
    /// User-selected reasoning-effort tier for this turn
    /// (`low`/`medium`/`high`/`xhigh`/`max`). The chat client sends
    /// it from the model picker's thinking-level flyout; the server
    /// forwards it to the harness via [`aura_os_harness::SessionConfig`]
    /// so the agent loop can hard-pin the requested effort. Omitted by
    /// models without effort tiers and by older clients —
    /// `#[serde(default)]` keeps wire compat.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    /// Optional AURA Council config. When present with >= 2 models the
    /// turn fans the query across every member in parallel (one
    /// subagent child run each) and `models[0]` synthesizes the
    /// combined answer. A single model (or an absent field) is treated
    /// as ordinary single-model chat. Mirrors the frontend POST body
    /// `council: { models: [{ id, reasoning_effort }] }`.
    #[serde(default)]
    pub council: Option<CouncilRequestBody>,
}

/// AURA Council selection from the chat client. See
/// [`SendChatRequest::council`].
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CouncilRequestBody {
    pub models: Vec<CouncilModelRequestBody>,
    /// How `models[0]` combines the members' answers once every member
    /// completes (`synthesize` / `contrast` / `side_by_side`). Older
    /// clients omit it — `#[serde(default)]` keeps wire compat and the
    /// server resolves the absent / unknown value to the default
    /// (`synthesize`).
    #[serde(default)]
    pub mechanism: Option<String>,
}

/// One council member from the chat client: a model id plus its
/// optional reasoning-effort tier (same wire strings as
/// [`SendChatRequest::reasoning_effort`]).
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CouncilModelRequestBody {
    pub id: String,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GenerateImageRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub size: Option<String>,
    /// Caller-requested image quality (e.g. `low` / `medium` / `high` /
    /// `auto` for GPT Image). Forwarded verbatim to aura-router, which
    /// validates it per model.
    pub quality: Option<String>,
    #[serde(default)]
    pub images: Option<Vec<String>>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    #[serde(rename = "isIteration")]
    pub is_iteration: Option<bool>,
    /// Standalone agent chat: org-level `agents.agent_id` of the chat the
    /// user is generating into. When set, the handler resolves the
    /// agent's chat session and persists this turn (user prompt +
    /// generated image) so it survives reload — without this the
    /// synthetic in-memory `generate_image` tool turn the UI renders
    /// from `GenerationCompleted` is lost on hard refresh.
    #[serde(default, rename = "agentId")]
    pub agent_id: Option<String>,
    /// Project chat: project-binding id of the agent instance. Threaded
    /// alongside `project_id` so the handler can resolve the same
    /// project chat session the regular `instance_route` uses.
    #[serde(default, rename = "agentInstanceId")]
    pub agent_instance_id: Option<String>,
    /// Set by the chat-input "+" affordance via
    /// `markNextSendAsNewSession`. When true the persistence layer
    /// closes any active session on the partition and creates a fresh
    /// chat session for this generation turn — so image / 3D / video
    /// modes start a new conversation just like regular chat does.
    /// Mirrors `SendChatRequest.new_session`.
    #[serde(default)]
    pub new_session: Option<bool>,
    /// Pin this generation's persisted user/assistant rows into the
    /// specified storage session id. Skipped when `new_session` is
    /// also true (force-new wins). Mirrors `SendChatRequest.session_id`.
    #[serde(default)]
    pub session_id: Option<String>,
}

/// 3D generation request. Exactly one of `image_url` (a real URL,
/// typically pointing at an existing project artifact) or `image_data`
/// (a `data:image/<type>;base64,...` payload from a paste / upload in
/// chat 3D mode) must be supplied. The handler normalises both to a
/// single value before forwarding to the upstream router so the rest
/// of the protocol stays unchanged.
#[derive(Debug, Deserialize)]
pub(crate) struct Generate3dRequest {
    #[serde(default, alias = "imageUrl")]
    pub image_url: Option<String>,
    #[serde(default, alias = "imageData")]
    pub image_data: Option<String>,
    pub prompt: Option<String>,
    /// 3D provider model id (e.g. `tripo-v2`). Forwarded to the router,
    /// which falls back to its default provider when omitted.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    #[serde(default, rename = "agentId")]
    pub agent_id: Option<String>,
    #[serde(default, rename = "agentInstanceId")]
    pub agent_instance_id: Option<String>,
    /// See [`GenerateImageRequest::new_session`].
    #[serde(default)]
    pub new_session: Option<bool>,
    /// See [`GenerateImageRequest::session_id`].
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AgentRuntimeTestResponse {
    pub ok: bool,
    pub adapter_type: String,
    pub environment: String,
    pub auth_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_name: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthLoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthRegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub invite_code: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PasswordResetRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportAccessTokenRequest {
    pub access_token: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AuthSessionResponse {
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub display_name: String,
    pub profile_image: String,
    pub primary_zid: String,
    pub zero_wallet: String,
    pub wallets: Vec<String>,
    pub is_zero_pro: bool,
    pub is_access_granted: bool,
    pub is_sys_admin: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zero_pro_refresh_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}

// -- Org DTOs --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateOrgRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateOrgRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub avatar_url: Option<Option<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct CreateOrgIntegrationRequest {
    pub name: String,
    pub provider: String,
    #[serde(default = "default_org_integration_kind")]
    pub kind: aura_os_core::OrgIntegrationKind,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub provider_config: Option<serde_json::Value>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct UpdateOrgIntegrationRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<aura_os_core::OrgIntegrationKind>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_patch_option"
    )]
    pub default_model: Option<Option<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_patch_option"
    )]
    pub provider_config: Option<Option<serde_json::Value>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_patch_option"
    )]
    pub api_key: Option<Option<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_patch_option"
    )]
    pub enabled: Option<Option<bool>>,
}

fn default_org_integration_kind() -> aura_os_core::OrgIntegrationKind {
    aura_os_core::OrgIntegrationKind::WorkspaceConnection
}

fn deserialize_patch_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateMemberRoleRequest {
    pub role: aura_os_core::OrgRole,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SetBillingRequest {
    // billing_email is intentionally not accepted here: it's provisioned from
    // the ZERO auth identity and must stay in sync with that account. Stale
    // clients may still send it; serde's default behavior ignores unknown
    // fields, so their payload is silently dropped.
    pub plan: String,
}

// -- Follow DTOs --

#[derive(Debug, Deserialize)]
pub(crate) struct FollowRequest {
    pub target_profile_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct FollowCheckResponse {
    pub following: bool,
}

// -- Billing/Credits DTOs --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateCreditCheckoutRequest {
    pub amount_usd: f64,
}

impl From<ZeroAuthSession> for AuthSessionResponse {
    fn from(s: ZeroAuthSession) -> Self {
        let token = s.access_token.clone();
        Self {
            user_id: s.user_id,
            network_user_id: s.network_user_id.map(|id| id.to_string()),
            profile_id: s.profile_id.map(|id| id.to_string()),
            display_name: s.display_name,
            profile_image: s.profile_image,
            primary_zid: s.primary_zid,
            zero_wallet: s.zero_wallet,
            wallets: s.wallets,
            is_zero_pro: s.is_zero_pro,
            is_access_granted: s.is_access_granted,
            is_sys_admin: s.is_sys_admin,
            zero_pro_refresh_error: None,
            access_token: Some(token),
            created_at: s.created_at,
            validated_at: s.validated_at,
        }
    }
}

impl AuthSessionResponse {
    pub(crate) fn from_auth_result(result: aura_os_auth::AuthSessionResult) -> Self {
        let mut response = Self::from(result.session);
        response.zero_pro_refresh_error = result.zero_pro_refresh_error;
        response
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn update_integration_serializes_absent_patch_fields_as_omitted() {
        let req = UpdateOrgIntegrationRequest {
            name: Some("Google".to_string()),
            provider: Some("google".to_string()),
            kind: Some(aura_os_core::OrgIntegrationKind::WorkspaceIntegration),
            default_model: None,
            provider_config: None,
            api_key: None,
            enabled: None,
        };

        let body = serde_json::to_value(req).expect("serialize update request");

        assert_eq!(
            body,
            json!({
                "name": "Google",
                "provider": "google",
                "kind": "workspace_integration"
            })
        );
    }

    #[test]
    fn update_integration_serializes_explicit_null_patch_fields() {
        let req = UpdateOrgIntegrationRequest {
            name: None,
            provider: None,
            kind: None,
            default_model: Some(None),
            provider_config: Some(None),
            api_key: Some(None),
            enabled: Some(None),
        };

        let body = serde_json::to_value(req).expect("serialize update request");

        assert_eq!(
            body,
            json!({
                "default_model": null,
                "provider_config": null,
                "api_key": null,
                "enabled": null
            })
        );
    }

    /// Frontend client (`interface/src/shared/api/tasks.ts`) and the
    /// aura-os-server integration tests POST `{ new_status: "..." }`.
    /// Guards that path against the alias regression.
    #[test]
    fn transition_task_request_accepts_new_status() {
        let req: TransitionTaskRequest =
            serde_json::from_str(r#"{ "new_status": "in_progress" }"#).expect("new_status decodes");
        assert_eq!(req.new_status, TaskStatus::InProgress);
    }

    /// Harness `HttpDomainApi::transition_task` POSTs `{ status: "..." }`
    /// (matching aura-storage's internal request shape). Without the
    /// alias every dev-loop transition 422'd and tasks stayed pending
    /// server-side forever -- surfacing as `loop_progress` timeouts.
    #[test]
    fn transition_task_request_accepts_legacy_status_alias() {
        let req: TransitionTaskRequest =
            serde_json::from_str(r#"{ "status": "done" }"#).expect("status alias decodes");
        assert_eq!(req.new_status, TaskStatus::Done);
    }

    /// Phase 2 of the `send_to_agent` cross-agent reply contract.
    /// aura-harness commit `6a9b33d` (branch
    /// `fix/agent-stuck-and-reset`) makes
    /// `cross_agent_hook::deliver_message` POST
    /// `originating_agent_id` on the JSON body for both
    /// `POST /api/agents/:agent_id/events/stream` and
    /// `POST /api/projects/:project_id/agents/:agent_instance_id/events/stream`.
    /// Phase 3 will read it from `ChatPersistCtx` inside `persist_task`
    /// and post agent B's reply back into agent A's session as a
    /// follow-up `user_message`. This test pins the wire shape so a
    /// rename / drop here can't silently break the harness contract.
    #[test]
    fn send_chat_request_accepts_originating_agent_id() {
        let req: SendChatRequest =
            serde_json::from_str(r#"{ "content": "hi", "originating_agent_id": "ceo-agent-id" }"#)
                .expect("originating_agent_id decodes");
        assert_eq!(req.content, "hi");
        assert_eq!(req.originating_agent_id.as_deref(), Some("ceo-agent-id"));
    }

    /// Forward-compat with older harness builds that don't yet send
    /// `originating_agent_id`. `#[serde(default)]` must leave the
    /// field as `None` rather than 422'ing the request — otherwise a
    /// version skew between aura-os-server and aura-harness would
    /// brick every chat turn during a partial rollout.
    #[test]
    fn send_chat_request_defaults_originating_agent_id_to_none() {
        let req: SendChatRequest =
            serde_json::from_str(r#"{ "content": "hi" }"#).expect("legacy body decodes");
        assert_eq!(req.content, "hi");
        assert!(
            req.originating_agent_id.is_none(),
            "missing field must default to None for wire compat with older harness builds"
        );
    }
}
