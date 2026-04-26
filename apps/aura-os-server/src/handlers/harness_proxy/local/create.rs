//! `POST /api/harness/skills` (create) and
//! `POST /api/harness/skills/install-from-shop` (install) flows.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::state::AppState;

use super::frontmatter::{extract_frontmatter_field, strip_frontmatter, yaml_escape_scalar};
use super::{create_skill_name_valid, skills_base_dir, USER_CREATED_SOURCE_MARKER};

#[derive(Deserialize)]
pub(crate) struct CreateSkillBody {
    pub name: String,
    pub description: String,
    pub body: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub context: Option<String>,
    pub user_invocable: Option<bool>,
    pub model_invocable: Option<bool>,
    /// Optional agent to auto-install this newly created skill on.
    /// When set, the server mirrors the Skill Shop flow: register the
    /// skill with the harness catalog AND install it for the agent so it
    /// shows up under "Installed" immediately.
    pub agent_id: Option<String>,
}

#[derive(serde::Serialize)]
struct CreateSkillResponse {
    name: String,
    path: String,
    created: bool,
    registered: bool,
    installed_on_agent: bool,
}

fn build_skill_frontmatter(payload: &CreateSkillBody) -> String {
    let mut frontmatter = format!(
        "---\ndescription: \"{}\"\n",
        yaml_escape_scalar(&payload.description)
    );
    if let Some(ref tools) = payload.allowed_tools {
        frontmatter.push_str(&format!("allowed_tools: [{}]\n", tools.join(", ")));
    }
    if let Some(ref model) = payload.model {
        frontmatter.push_str(&format!("model: \"{}\"\n", yaml_escape_scalar(model)));
    }
    if let Some(ref context) = payload.context {
        frontmatter.push_str(&format!("context: \"{}\"\n", yaml_escape_scalar(context)));
    }
    frontmatter.push_str(&format!(
        "user_invocable: {}\n",
        payload.user_invocable.unwrap_or(true)
    ));
    frontmatter.push_str(&format!(
        "model_invocable: {}\n",
        payload.model_invocable.unwrap_or(false)
    ));
    frontmatter.push_str(&format!("source: \"{USER_CREATED_SOURCE_MARKER}\"\n"));
    frontmatter.push_str("---\n");
    frontmatter
}

async fn maybe_install_on_agent(
    state: &AppState,
    skill_name: &str,
    agent_id: Option<&str>,
) -> bool {
    match agent_id {
        Some(agent_id) if !agent_id.is_empty() => {
            let empty: Vec<String> = Vec::new();
            let install_body = serde_json::json!({
                "name": skill_name,
                "approved_paths": empty,
                "approved_commands": empty,
            })
            .to_string();
            state
                .harness_http
                .post_json_ignore_result(&format!("api/agents/{agent_id}/skills"), install_body)
                .await;
            true
        }
        _ => false,
    }
}

pub(crate) async fn create_skill(
    State(state): State<AppState>,
    Json(payload): Json<CreateSkillBody>,
) -> Result<axum::response::Response, StatusCode> {
    if !create_skill_name_valid(&payload.name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&payload.name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let frontmatter = build_skill_frontmatter(&payload);
    let body_text = payload.body.clone().unwrap_or_default();
    let content = format!("{frontmatter}\n{body_text}");
    let skill_path = skill_dir.join("SKILL.md");

    // Register the skill with the harness catalog so it shows up in listings.
    // Without this the UI's catalog (backed by the harness' `GET api/skills`)
    // stays empty and the newly created skill is invisible.
    //
    // NB: the harness writes its OWN `~/.aura/skills/<name>/SKILL.md` on
    // this POST (with a different frontmatter shape — `name:` included,
    // `user-invocable:` spelled with a hyphen, and crucially NO `source:`
    // marker). We therefore have to do the harness call *before* our own
    // write so our marker-bearing file wins the race; otherwise the
    // harness overwrites it and `list_my_skills` can't find the skill,
    // landing it under "Available" instead of "My Skills".
    state
        .harness_http
        .post_json_ignore_result(
            "api/skills",
            serde_json::json!({
                "name": payload.name,
                "description": payload.description,
                "body": body_text,
                "user_invocable": payload.user_invocable.unwrap_or(true),
                "model_invocable": payload.model_invocable.unwrap_or(false),
            })
            .to_string(),
        )
        .await;

    // Last writer wins: stamp the source marker after the harness has had
    // its turn. (The directory was created above; the harness call may or
    // may not have written SKILL.md, either way we overwrite.)
    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let installed_on_agent =
        maybe_install_on_agent(&state, &payload.name, payload.agent_id.as_deref()).await;

    let resp = CreateSkillResponse {
        name: payload.name,
        path: skill_path.to_string_lossy().into_owned(),
        created: true,
        registered: true,
        installed_on_agent,
    };
    let body = serde_json::to_string(&resp).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::CREATED,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

#[derive(Deserialize)]
pub(crate) struct InstallFromShopBody {
    pub name: String,
    pub category: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
}

async fn load_shop_skill_markdown(
    normalized_name: &str,
    body: &InstallFromShopBody,
) -> Result<String, StatusCode> {
    if let Some(ref category) = body.category {
        let local_path = skills_base_dir()
            .join(category)
            .join(normalized_name)
            .join("SKILL.md");
        return std::fs::read_to_string(&local_path).map_err(|_| StatusCode::NOT_FOUND);
    }
    if let Some(ref source_url) = body.source_url {
        return reqwest::Client::new()
            .get(source_url)
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?
            .text()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY);
    }
    Err(StatusCode::BAD_REQUEST)
}

fn install_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub(crate) async fn install_from_shop(
    State(state): State<AppState>,
    Json(body): Json<InstallFromShopBody>,
) -> Result<axum::response::Response, StatusCode> {
    let name = body.name.trim().to_lowercase().replace(' ', "-");
    if !install_name_valid(&name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let content = load_shop_skill_markdown(&name, &body).await?;

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let skill_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let description = extract_frontmatter_field(&content, "description")
        .unwrap_or_else(|| format!("{name} skill"));
    let body_text = strip_frontmatter(&content);

    state
        .harness_http
        .post_json_ignore_result(
            "api/skills",
            serde_json::json!({
                "name": name,
                "description": description,
                "body": body_text,
                "user_invocable": true,
            })
            .to_string(),
        )
        .await;

    let resp_json = serde_json::json!({
        "name": name,
        "path": skill_path.to_string_lossy(),
        "installed": true,
    });

    Ok((
        StatusCode::CREATED,
        [(header::CONTENT_TYPE, "application/json")],
        resp_json.to_string(),
    )
        .into_response())
}
