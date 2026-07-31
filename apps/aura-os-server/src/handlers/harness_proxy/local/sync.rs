//! Best-effort synchronization between portable cloud skill definitions and
//! this runtime's local harness files.
//!
//! The cloud owns portable definitions and agent assignments. The harness
//! continues to own device grants (`approved_paths` / `approved_commands`).
//! Existing marker-less local skills are deliberately quarantined: without a
//! durable owner id, claiming them for the currently signed-in user would be
//! an unsafe cross-account migration.

use aura_os_storage::{
    CreateStorageSkillRequest, StorageError, StorageSkill, UpdateStorageSkillRequest,
};
use tracing::{info, warn};

use crate::state::AppState;

use super::create::{
    render_skill_frontmatter, CreateSkillBody, SkillAgentTarget, SkillFrontmatterOptions,
};
use super::frontmatter::{extract_frontmatter_field, strip_frontmatter};
use super::{create_skill_name_valid, user_skills_root, USER_CREATED_SOURCE_MARKER};

const STORAGE_ID_FIELD: &str = "aura_storage_id";
const STORAGE_REVISION_FIELD: &str = "aura_storage_revision";
const STORAGE_HASH_FIELD: &str = "aura_storage_hash";
const STORAGE_DIRTY_FIELD: &str = "aura_storage_dirty";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudSkillMetadata {
    pub id: String,
    pub revision: i64,
}

pub(crate) fn cloud_skill_metadata_for_name(name: &str) -> Option<CloudSkillMetadata> {
    let content = std::fs::read_to_string(user_skills_root()?.join(name).join("SKILL.md")).ok()?;
    cloud_skill_metadata(&content)
}

fn cloud_skill_metadata(content: &str) -> Option<CloudSkillMetadata> {
    let id = extract_frontmatter_field(content, STORAGE_ID_FIELD)?;
    let revision = extract_frontmatter_field(content, STORAGE_REVISION_FIELD)?
        .parse()
        .ok()?;
    Some(CloudSkillMetadata { id, revision })
}

pub(super) fn preserve_cloud_metadata(frontmatter: String, existing: &str) -> String {
    let Some(metadata) = cloud_skill_metadata(existing) else {
        return frontmatter;
    };
    let hash = extract_frontmatter_field(existing, STORAGE_HASH_FIELD).unwrap_or_default();
    let mut preserved = frontmatter
        .strip_suffix("---\n")
        .unwrap_or(&frontmatter)
        .to_string();
    preserved.push_str(&format!(
        "{STORAGE_ID_FIELD}: \"{}\"\n{STORAGE_REVISION_FIELD}: {}\n{STORAGE_HASH_FIELD}: \"{}\"\n{STORAGE_DIRTY_FIELD}: true\n---\n",
        metadata.id, metadata.revision, hash
    ));
    preserved
}

fn skill_agent_target(skill: &StorageSkill) -> Option<SkillAgentTarget> {
    let target = skill.agent_target.as_ref()?;
    let agent_id = target
        .get("agent_id")
        .or_else(|| target.get("agentId"))?
        .as_str()?;
    let name = target.get("name")?.as_str()?;
    Some(SkillAgentTarget {
        agent_id: agent_id.to_string(),
        name: name.to_string(),
    })
}

fn render_cloud_skill(skill: &StorageSkill) -> String {
    let agent_target = skill_agent_target(skill);
    let frontmatter = render_skill_frontmatter(
        &skill.name,
        &skill.description,
        SkillFrontmatterOptions {
            allowed_tools: (!skill.allowed_tools.is_empty())
                .then_some(skill.allowed_tools.as_slice()),
            model: skill.model.as_deref(),
            context: skill.context.as_deref(),
            user_invocable: skill.user_invocable,
            model_invocable: skill.model_invocable,
            agent_target: agent_target.as_ref(),
        },
    );
    let mut with_cloud_metadata = frontmatter
        .strip_suffix("---\n")
        .unwrap_or(&frontmatter)
        .to_string();
    with_cloud_metadata.push_str(&format!(
        "{STORAGE_ID_FIELD}: \"{}\"\n{STORAGE_REVISION_FIELD}: {}\n{STORAGE_HASH_FIELD}: \"{}\"\n---\n\n{}",
        skill.id, skill.revision, skill.content_hash, skill.body
    ));
    with_cloud_metadata
}

/// Materialize a cloud skill without overwriting an unowned legacy file.
pub(crate) async fn materialize_cloud_skill(state: &AppState, skill: &StorageSkill) -> bool {
    materialize_cloud_skill_inner(state, skill, false).await
}

async fn materialize_owned_cloud_skill(state: &AppState, skill: &StorageSkill) -> bool {
    materialize_cloud_skill_inner(state, skill, true).await
}

async fn register_cloud_skill_with_harness(state: &AppState, skill: &StorageSkill) -> bool {
    state
        .harness_http
        .post_json_ok(
            "api/skills",
            serde_json::json!({
                "name": skill.name,
                "description": skill.description,
                "body": skill.body,
                "user_invocable": skill.user_invocable,
                "model_invocable": skill.model_invocable,
                "agent_target": skill.agent_target,
            })
            .to_string(),
        )
        .await
}

async fn materialize_cloud_skill_inner(
    state: &AppState,
    skill: &StorageSkill,
    allow_unmarked_owned_file: bool,
) -> bool {
    let Some(root) = user_skills_root() else {
        return false;
    };
    let skill_dir = root.join(&skill.name);
    let skill_path = skill_dir.join("SKILL.md");
    if let Ok(existing) = std::fs::read_to_string(&skill_path) {
        let source = extract_frontmatter_field(&existing, "source").unwrap_or_default();
        let existing_metadata = cloud_skill_metadata(&existing);
        let ownership_conflicts = existing_metadata
            .as_ref()
            .is_some_and(|metadata| metadata.id != skill.id);
        let ownership_missing = existing_metadata.is_none() && !allow_unmarked_owned_file;
        if source != USER_CREATED_SOURCE_MARKER || ownership_conflicts || ownership_missing {
            warn!(
                skill = %skill.name,
                "left legacy or differently-owned local skill untouched during cloud sync"
            );
            return false;
        }
        let existing_hash =
            extract_frontmatter_field(&existing, STORAGE_HASH_FIELD).unwrap_or_default();
        let dirty =
            extract_frontmatter_field(&existing, STORAGE_DIRTY_FIELD).as_deref() == Some("true");
        if dirty && !allow_unmarked_owned_file {
            return false;
        }
        if existing_hash == skill.content_hash
            && existing_metadata.is_some_and(|metadata| metadata.revision == skill.revision)
        {
            // The hosted Harness is a separate service with its own
            // filesystem and in-memory registry. Aura API's local marker
            // file can therefore be current while the hosted registry was
            // emptied by a restart or deploy. Re-register there before
            // treating the definition as materialized. Desktop keeps the
            // old fast path because its sidecar scans the same local file.
            return !state.harness_http.hosted_local_runtime_available()
                || register_cloud_skill_with_harness(state, skill).await;
        }
    }

    if let Err(error) = std::fs::create_dir_all(&skill_dir) {
        warn!(%error, skill = %skill.name, "failed to create cloud skill directory");
        return false;
    }

    if !register_cloud_skill_with_harness(state, skill).await {
        warn!(
            skill = %skill.name,
            "harness rejected canonical cloud skill registration; sync will retry"
        );
        return false;
    }

    if let Err(error) = std::fs::write(&skill_path, render_cloud_skill(skill)) {
        warn!(%error, skill = %skill.name, "failed to materialize cloud skill");
        return false;
    }
    info!(
        skill = %skill.name,
        revision = skill.revision,
        "materialized canonical cloud skill into local harness"
    );
    true
}

fn parse_allowed_tools(content: &str) -> Vec<String> {
    let Some(raw) = extract_frontmatter_field(content, "allowed_tools") else {
        return Vec::new();
    };
    let Some(inner) = raw
        .trim()
        .strip_prefix('[')
        .and_then(|raw| raw.strip_suffix(']'))
    else {
        return Vec::new();
    };
    inner
        .split(',')
        .map(str::trim)
        .filter(|tool| !tool.is_empty())
        .map(str::to_string)
        .collect()
}

fn local_update_request(content: &str, expected_revision: i64) -> UpdateStorageSkillRequest {
    let agent_target = match (
        extract_frontmatter_field(content, "agent_target_id"),
        extract_frontmatter_field(content, "agent_target_name"),
    ) {
        (Some(agent_id), Some(name)) => Some(serde_json::json!({
            "agent_id": agent_id,
            "name": name,
        })),
        _ => None,
    };
    UpdateStorageSkillRequest {
        description: Some(extract_frontmatter_field(content, "description").unwrap_or_default()),
        body: Some(strip_frontmatter(content)),
        allowed_tools: Some(parse_allowed_tools(content)),
        model: Some(extract_frontmatter_field(content, "model").filter(|value| !value.is_empty())),
        context: Some(
            extract_frontmatter_field(content, "context").filter(|value| !value.is_empty()),
        ),
        user_invocable: Some(
            extract_frontmatter_field(content, "user_invocable").as_deref() != Some("false"),
        ),
        model_invocable: Some(
            extract_frontmatter_field(content, "model_invocable").as_deref() == Some("true"),
        ),
        agent_target: Some(agent_target),
        expected_revision,
    }
}

/// Push an authenticated offline edit before pulling the cloud version.
/// Returns true when the local file was dirty, even if the network is still
/// unavailable, so callers never overwrite an unsynced edit.
async fn push_dirty_local_skill(state: &AppState, jwt: &str, cloud_skill: &StorageSkill) -> bool {
    let Some(storage) = state.storage_client.as_ref() else {
        return false;
    };
    let Some(root) = user_skills_root() else {
        return false;
    };
    let Ok(content) = std::fs::read_to_string(root.join(&cloud_skill.name).join("SKILL.md")) else {
        return false;
    };
    let Some(metadata) = cloud_skill_metadata(&content) else {
        return false;
    };
    let dirty = extract_frontmatter_field(&content, STORAGE_DIRTY_FIELD).as_deref() == Some("true");
    if !dirty || metadata.id != cloud_skill.id {
        return false;
    }

    match storage
        .update_skill(
            &metadata.id,
            jwt,
            &local_update_request(&content, metadata.revision),
        )
        .await
    {
        Ok(updated) => {
            materialize_owned_cloud_skill(state, &updated).await;
        }
        Err(StorageError::Server { status: 409, .. }) => {
            warn!(
                skill = %cloud_skill.name,
                "offline skill edit conflicted with a newer cloud revision; cloud revision retained"
            );
            // Re-read after the conflict. Two desktop requests can race with
            // the same revision; writing the sync feed's now-stale value here
            // would temporarily roll back the winner on disk.
            if let Some(latest) = find_cloud_skill_by_name(state, jwt, &cloud_skill.name).await {
                materialize_owned_cloud_skill(state, &latest).await;
            }
        }
        Err(error) => {
            warn!(
                %error,
                skill = %cloud_skill.name,
                "offline skill edit remains pending"
            );
        }
    }
    true
}

async fn remove_cloud_skill_tombstone(state: &AppState, skill: &StorageSkill) {
    let Some(root) = user_skills_root() else {
        return;
    };
    let skill_dir = root.join(&skill.name);
    let skill_path = skill_dir.join("SKILL.md");
    let Ok(content) = std::fs::read_to_string(&skill_path) else {
        return;
    };
    if cloud_skill_metadata(&content).is_none_or(|metadata| metadata.id != skill.id) {
        return;
    }

    if let Ok(agents) = state.agent_service.list_agents() {
        for agent in agents {
            let _ = state
                .harness_http
                .proxy_json(
                    axum::http::Method::DELETE,
                    &format!("api/agents/{}/skills/{}", agent.agent_id, skill.name),
                    None,
                    None,
                )
                .await;
        }
    }
    if let Err(error) = std::fs::remove_dir_all(&skill_dir) {
        warn!(%error, skill = %skill.name, "failed to apply cloud skill deletion locally");
        return;
    }
    let _ = state
        .harness_http
        .proxy_json(
            axum::http::Method::DELETE,
            &format!("api/skills/{}", skill.name),
            None,
            None,
        )
        .await;
    info!(skill = %skill.name, "applied cloud skill deletion locally");
}

pub(crate) async fn sync_all_cloud_skills(state: &AppState, jwt: &str) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    match storage.list_skills_for_sync(jwt, None).await {
        Ok(skills) => {
            for skill in skills {
                if skill.deleted_at.is_some() {
                    remove_cloud_skill_tombstone(state, &skill).await;
                    continue;
                }
                if push_dirty_local_skill(state, jwt, &skill).await {
                    continue;
                }
                materialize_cloud_skill(state, &skill).await;
            }
        }
        Err(error) => {
            warn!(%error, "cloud skill sync unavailable; retaining local skill state");
        }
    }
}

pub(super) async fn sync_one_cloud_skill(state: &AppState, jwt: &str, name: &str) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    match storage.list_skills(jwt, None).await {
        Ok(skills) => {
            if let Some(skill) = skills.into_iter().find(|skill| skill.name == name) {
                materialize_cloud_skill(state, &skill).await;
            }
        }
        Err(error) => warn!(%error, skill = %name, "could not refresh cloud skill"),
    }
}

fn create_storage_request(payload: &CreateSkillBody) -> CreateStorageSkillRequest {
    CreateStorageSkillRequest {
        org_id: None,
        name: payload.name.clone(),
        description: payload.description.clone(),
        body: payload.body.clone().unwrap_or_default(),
        allowed_tools: payload.allowed_tools.clone().unwrap_or_default(),
        model: payload.model.clone(),
        context: payload.context.clone(),
        user_invocable: payload.user_invocable.unwrap_or(true),
        model_invocable: payload.model_invocable.unwrap_or(false),
        agent_target: payload
            .agent_target
            .as_ref()
            .and_then(|target| serde_json::to_value(target).ok()),
    }
}

fn legacy_storage_request(name: &str, content: &str) -> CreateStorageSkillRequest {
    let agent_target = match (
        extract_frontmatter_field(content, "agent_target_id"),
        extract_frontmatter_field(content, "agent_target_name"),
    ) {
        (Some(agent_id), Some(name)) => Some(serde_json::json!({
            "agent_id": agent_id,
            "name": name,
        })),
        _ => None,
    };
    CreateStorageSkillRequest {
        org_id: None,
        name: name.to_string(),
        description: extract_frontmatter_field(content, "description").unwrap_or_default(),
        body: strip_frontmatter(content),
        allowed_tools: parse_allowed_tools(content),
        model: extract_frontmatter_field(content, "model").filter(|value| !value.is_empty()),
        context: extract_frontmatter_field(content, "context").filter(|value| !value.is_empty()),
        user_invocable: extract_frontmatter_field(content, "user_invocable").as_deref()
            != Some("false"),
        model_invocable: extract_frontmatter_field(content, "model_invocable").as_deref()
            == Some("true"),
        agent_target,
    }
}

/// Adopt an old marker-bearing skill only when it is installed on an agent
/// the authenticated caller has already been authorized to access. That
/// gives legacy definitions a safe ownership signal without treating every
/// file left on a shared machine as belonging to whichever account signs in
/// next. Device-local grants never enter this request.
pub(crate) async fn adopt_installed_legacy_skill(
    state: &AppState,
    jwt: &str,
    agent_id: &str,
    name: &str,
) {
    if !create_skill_name_valid(name) {
        return;
    }
    let (Some(storage), Some(root)) = (state.storage_client.as_ref(), user_skills_root()) else {
        return;
    };
    let Ok(content) = std::fs::read_to_string(root.join(name).join("SKILL.md")) else {
        return;
    };
    if extract_frontmatter_field(&content, "source").as_deref() != Some(USER_CREATED_SOURCE_MARKER)
    {
        return;
    }

    if let Some(metadata) = cloud_skill_metadata(&content) {
        if let Err(error) = storage
            .assign_agent_skill(agent_id, &metadata.id, jwt)
            .await
        {
            warn!(
                %error,
                skill = %name,
                agent = %agent_id,
                "canonical skill assignment sync is pending"
            );
        }
        return;
    }

    let skill = match storage
        .create_skill(jwt, &legacy_storage_request(name, &content))
        .await
    {
        Ok(skill) => Some(skill),
        Err(StorageError::Server { status: 409, .. }) => {
            find_cloud_skill_by_name(state, jwt, name).await
        }
        Err(error) => {
            warn!(
                %error,
                skill = %name,
                agent = %agent_id,
                "legacy installed skill remains local; canonical adoption will retry"
            );
            None
        }
    };
    let Some(skill) = skill else {
        return;
    };

    if !materialize_owned_cloud_skill(state, &skill).await {
        return;
    }
    match storage.assign_agent_skill(agent_id, &skill.id, jwt).await {
        Ok(_) => info!(
            skill = %name,
            agent = %agent_id,
            "adopted authenticated legacy installed skill into canonical storage"
        ),
        Err(error) => warn!(
            %error,
            skill = %name,
            agent = %agent_id,
            "legacy skill definition was adopted but assignment sync is pending"
        ),
    }
}

pub(super) async fn sync_created_skill(state: &AppState, jwt: &str, payload: &CreateSkillBody) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    match storage
        .create_skill(jwt, &create_storage_request(payload))
        .await
    {
        Ok(skill) => {
            materialize_owned_cloud_skill(state, &skill).await;
            sync_created_skill_assignment(state, jwt, payload, &skill).await;
        }
        Err(StorageError::Server { status: 409, .. }) => {
            // A previous runtime may already have created it. Cloud wins;
            // refresh that definition instead of overwriting it.
            if let Some(skill) = find_cloud_skill_by_name(state, jwt, &payload.name).await {
                materialize_owned_cloud_skill(state, &skill).await;
                sync_created_skill_assignment(state, jwt, payload, &skill).await;
            }
        }
        Err(error) => {
            warn!(
                %error,
                skill = %payload.name,
                "skill saved locally; cloud sync will retry on a later authenticated request"
            );
        }
    }
}

async fn sync_created_skill_assignment(
    state: &AppState,
    jwt: &str,
    payload: &CreateSkillBody,
    skill: &StorageSkill,
) {
    let (Some(storage), Some(agent_id)) =
        (state.storage_client.as_ref(), payload.agent_id.as_deref())
    else {
        return;
    };
    if agent_id.parse::<aura_os_core::AgentId>().is_err() {
        return;
    }
    if let Err(error) = storage.assign_agent_skill(agent_id, &skill.id, jwt).await {
        warn!(
            %error,
            agent = %agent_id,
            skill = %skill.name,
            "skill was created and installed locally; cloud assignment is pending"
        );
    }
}

pub(super) async fn sync_updated_skill(
    state: &AppState,
    jwt: &str,
    name: &str,
    metadata: CloudSkillMetadata,
    payload: &super::update::UpdateSkillBody,
) -> Result<(), StorageError> {
    let Some(storage) = state.storage_client.as_ref() else {
        return Ok(());
    };
    let request = UpdateStorageSkillRequest {
        description: Some(payload.description.clone()),
        body: Some(payload.body.clone().unwrap_or_default()),
        allowed_tools: Some(payload.allowed_tools.clone().unwrap_or_default()),
        model: Some(payload.model.clone()),
        context: Some(payload.context.clone()),
        user_invocable: Some(payload.user_invocable.unwrap_or(true)),
        model_invocable: Some(payload.model_invocable.unwrap_or(false)),
        agent_target: Some(
            payload
                .agent_target
                .as_ref()
                .and_then(|target| serde_json::to_value(target).ok()),
        ),
        expected_revision: metadata.revision,
    };
    match storage.update_skill(&metadata.id, jwt, &request).await {
        Ok(skill) => {
            materialize_owned_cloud_skill(state, &skill).await;
            Ok(())
        }
        Err(error @ StorageError::Server { status: 409, .. }) => {
            if let Some(skill) = find_cloud_skill_by_name(state, jwt, name).await {
                materialize_owned_cloud_skill(state, &skill).await;
            }
            Err(error)
        }
        Err(error) => {
            warn!(%error, skill = %name, "skill updated locally but cloud sync is unavailable");
            Ok(())
        }
    }
}

pub(super) async fn sync_deleted_skill(
    state: &AppState,
    jwt: &str,
    metadata: Option<CloudSkillMetadata>,
) -> Result<(), StorageError> {
    let (Some(storage), Some(metadata)) = (state.storage_client.as_ref(), metadata) else {
        return Ok(());
    };
    match storage.delete_skill(&metadata.id, jwt).await {
        Ok(()) | Err(StorageError::Server { status: 404, .. }) => Ok(()),
        Err(error) => {
            warn!(
                %error,
                skill_id = %metadata.id,
                "cloud skill delete was not confirmed; retaining local definition"
            );
            Err(error)
        }
    }
}

pub(crate) async fn find_cloud_skill_by_name(
    state: &AppState,
    jwt: &str,
    name: &str,
) -> Option<StorageSkill> {
    state
        .storage_client
        .as_ref()?
        .list_skills(jwt, None)
        .await
        .ok()?
        .into_iter()
        .find(|skill| skill.name == name)
}

#[cfg(test)]
mod tests {
    use aura_os_storage::StorageSkill;

    use super::{
        cloud_skill_metadata, legacy_storage_request, local_update_request,
        preserve_cloud_metadata, render_cloud_skill,
    };

    fn cloud_skill() -> StorageSkill {
        StorageSkill {
            id: "11111111-1111-4111-8111-111111111111".into(),
            org_id: None,
            created_by: "22222222-2222-4222-8222-222222222222".into(),
            name: "release-check".into(),
            description: "Checks a release".into(),
            body: "Run the smoke tests.".into(),
            allowed_tools: vec!["shell".into()],
            model: None,
            context: None,
            user_invocable: true,
            model_invocable: false,
            agent_target: None,
            revision: 3,
            content_hash: "abc123".into(),
            created_at: None,
            updated_at: None,
            deleted_at: None,
        }
    }

    #[test]
    fn cloud_metadata_round_trips_in_harness_compatible_frontmatter() {
        let content = render_cloud_skill(&cloud_skill());
        let metadata = cloud_skill_metadata(&content).unwrap();
        assert_eq!(metadata.id, "11111111-1111-4111-8111-111111111111");
        assert_eq!(metadata.revision, 3);
        assert!(content.contains("source: \"user-created\""));
        assert!(content.ends_with("Run the smoke tests."));
    }

    #[test]
    fn legacy_skill_without_owner_metadata_is_quarantined() {
        assert!(cloud_skill_metadata(
            "---\nname: \"release-check\"\nsource: \"user-created\"\n---\n"
        )
        .is_none());
    }

    #[test]
    fn offline_edit_keeps_owner_metadata_and_is_marked_dirty() {
        let existing = render_cloud_skill(&cloud_skill());
        let edited_frontmatter = "---\nname: \"release-check\"\ndescription: \"Edited\"\n\
allowed_tools: [shell, browser]\nuser_invocable: true\nmodel_invocable: false\n\
source: \"user-created\"\n---\n"
            .to_string();
        let preserved = preserve_cloud_metadata(edited_frontmatter, &existing);
        let content = format!("{preserved}\nEdited body");

        assert!(content.contains("aura_storage_dirty: true"));
        assert_eq!(cloud_skill_metadata(&content).unwrap().revision, 3);
        let request = local_update_request(&content, 3);
        assert_eq!(request.expected_revision, 3);
        assert_eq!(request.allowed_tools.unwrap(), vec!["shell", "browser"]);
        assert_eq!(request.body.as_deref(), Some("Edited body"));
    }

    #[test]
    fn legacy_adoption_request_contains_only_portable_definition_fields() {
        let request = legacy_storage_request(
            "release-check",
            "---\nname: \"release-check\"\ndescription: \"Release check\"\n\
             allowed_tools: [shell, browser]\nuser_invocable: true\nmodel_invocable: false\n\
             source: \"user-created\"\n---\n\nRun it.",
        );
        assert_eq!(request.name, "release-check");
        assert_eq!(request.allowed_tools, vec!["shell", "browser"]);
        assert_eq!(request.body, "Run it.");
        let serialized = serde_json::to_value(request).unwrap();
        assert!(serialized.get("approvedPaths").is_none());
        assert!(serialized.get("approvedCommands").is_none());
    }
}
