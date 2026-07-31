//! `PUT /api/harness/skills/mine/{name}` (update) flow for
//! user-authored skills.

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::state::{AppState, AuthJwt};

use super::create::{
    normalize_agent_target, render_skill_frontmatter, SkillAgentTarget, SkillFrontmatterOptions,
};
use super::frontmatter::extract_frontmatter_field;
use super::{create_skill_name_valid, user_skills_root, USER_CREATED_SOURCE_MARKER};

#[derive(Clone, Deserialize)]
pub(crate) struct UpdateSkillBody {
    pub description: String,
    pub body: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub context: Option<String>,
    pub user_invocable: Option<bool>,
    pub model_invocable: Option<bool>,
    pub agent_target: Option<SkillAgentTarget>,
}

#[derive(serde::Serialize)]
pub(crate) struct UpdateSkillResponse {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) updated: bool,
}

/// Rewrite an existing user-authored skill's `SKILL.md` (frontmatter +
/// body). Mirrors the create flow's write logic so the on-disk shape stays
/// identical — same frontmatter renderer (carrying the `source:
/// "user-created"` marker) and the same harness-first/write-last ordering
/// so our marker-bearing file wins over the harness's own clobbering write.
///
/// Preconditions (matching `delete_my_skill`):
/// - `<skills_root>/<name>/SKILL.md` must already exist (else 404). This is
///   strictly an *edit* of an existing skill — renaming/creating goes
///   through the create endpoint.
/// - The existing file must carry the `source: "user-created"` marker
///   (else 403). This stops the endpoint from being used to overwrite a
///   shop-installed skill that happens to share the on-disk layout.
pub(crate) async fn update_my_skill(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(name): Path<String>,
    Json(payload): Json<UpdateSkillBody>,
) -> Result<axum::response::Response, StatusCode> {
    let resp = update_my_skill_from_payload_synced(&state, &jwt, name, payload).await?;
    let body = serde_json::to_string(&resp).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

pub(crate) async fn update_my_skill_from_payload_synced(
    state: &AppState,
    jwt: &str,
    name: String,
    payload: UpdateSkillBody,
) -> Result<UpdateSkillResponse, StatusCode> {
    let metadata = super::sync::cloud_skill_metadata_for_name(&name);
    let response = update_my_skill_from_payload(state, name.clone(), payload.clone()).await?;
    if let Some(metadata) = metadata {
        super::sync::sync_updated_skill(state, jwt, &name, metadata, &payload)
            .await
            .map_err(|error| match error {
                aura_os_storage::StorageError::Server { status: 409, .. } => StatusCode::CONFLICT,
                _ => StatusCode::BAD_GATEWAY,
            })?;
    }
    Ok(response)
}

pub(crate) async fn update_my_skill_from_payload(
    state: &AppState,
    name: String,
    mut payload: UpdateSkillBody,
) -> Result<UpdateSkillResponse, StatusCode> {
    if !create_skill_name_valid(&name) {
        return Err(StatusCode::BAD_REQUEST);
    }
    payload.agent_target = normalize_agent_target(payload.agent_target, None)?;

    let skill_dir = user_skills_root()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
        .join(&name);
    let skill_path = skill_dir.join("SKILL.md");

    // Existence + ownership check before touching anything. Editing a skill
    // that doesn't exist is a 404; editing a non-user-created skill is a 403.
    let existing = std::fs::read_to_string(&skill_path).map_err(|_| StatusCode::NOT_FOUND)?;
    let source = extract_frontmatter_field(&existing, "source").unwrap_or_default();
    if source != USER_CREATED_SOURCE_MARKER {
        return Err(StatusCode::FORBIDDEN);
    }

    let frontmatter = super::sync::preserve_cloud_metadata(
        render_skill_frontmatter(
            &name,
            &payload.description,
            SkillFrontmatterOptions {
                allowed_tools: payload.allowed_tools.as_deref(),
                model: payload.model.as_deref(),
                context: payload.context.as_deref(),
                user_invocable: payload.user_invocable.unwrap_or(true),
                model_invocable: payload.model_invocable.unwrap_or(false),
                agent_target: payload.agent_target.as_ref(),
            },
        ),
        &existing,
    );
    let body_text = payload.body.clone().unwrap_or_default();
    let content = format!("{frontmatter}\n{body_text}");

    // Mirror create's ordering: register the updated content with the
    // harness catalog FIRST (the harness writes its own marker-less
    // SKILL.md on this POST), then stamp our marker-bearing file last so
    // it wins the race and the skill keeps showing up under "My Skills".
    //
    // Unlike create, this POST is checked rather than fire-and-forget: it is
    // the harness call that reloads the in-memory skill registry, and that
    // registry — not the on-disk file — is what agents resolve a skill's
    // content from. If it fails, the edit would NOT go live (every agent
    // keeps serving the old body), so writing the new file below and
    // returning 200 would be a lie. Fail loud and leave the on-disk skill
    // untouched so disk and the live registry stay consistent (both pre-edit).
    let registered = state
        .harness_http
        .post_json_ok(
            "api/skills",
            serde_json::json!({
                "name": name,
                "description": payload.description,
                "body": body_text,
                "user_invocable": payload.user_invocable.unwrap_or(true),
                "model_invocable": payload.model_invocable.unwrap_or(false),
                "agent_target": payload.agent_target,
            })
            .to_string(),
        )
        .await;
    if !registered {
        return Err(StatusCode::BAD_GATEWAY);
    }

    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(UpdateSkillResponse {
        name,
        path: skill_path.to_string_lossy().into_owned(),
        updated: true,
    })
}
