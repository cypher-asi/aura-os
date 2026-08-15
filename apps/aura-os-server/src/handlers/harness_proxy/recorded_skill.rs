use axum::extract::State;
use axum::Json;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::warn;

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};
use crate::trusted_router;

const RECORDED_SKILL_MODEL: &str = "aura-claude-sonnet-5";
const RECORDED_SKILL_MAX_TOKENS: u32 = 3_000;
const MAX_RECORDING_FRAMES: usize = 12;
const MAX_FRAME_BASE64_BYTES: usize = 3 * 1024 * 1024;
const MAX_TOTAL_BASE64_BYTES: usize = 20 * 1024 * 1024;
const MAX_GOAL_CHARS: usize = 1_000;
const MAX_NOTES_CHARS: usize = 4_000;
const RECORDED_SKILL_SYSTEM_PROMPT: &str = "You turn a short visual demonstration into a reusable Aura skill. Infer the repeatable workflow shown by the ordered screenshots and the user's stated goal. Generalize the demonstration into parameterized instructions rather than brittle coordinates. Prefer stable APIs, command-line tools, semantic UI labels, and verification checks. Include prerequisites, inputs, numbered steps, success verification, failure recovery, and privacy cautions where relevant. Never include secrets or values visible in screenshots. Return only valid JSON with exactly these string fields: name, description, body. name should be a concise lowercase kebab-case slug. body must be useful Markdown instructions for a SKILL.md file.";

#[derive(Debug, Deserialize)]
pub(crate) struct RecordingFrame {
    media_type: String,
    data: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AnalyzeSkillRecordingRequest {
    goal: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
    frames: Vec<RecordingFrame>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct RecordedSkillDraft {
    name: String,
    description: String,
    body: String,
}

pub(crate) async fn analyze_skill_recording(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(request): Json<AnalyzeSkillRecordingRequest>,
) -> ApiResult<Json<RecordedSkillDraft>> {
    validate_recording_request(&request)?;
    let request_body = build_router_request(&request);
    let mut outbound = trusted_router::request(&state, Method::POST, "/v1/messages")?
        .bearer_auth(&jwt)
        .header("anthropic-beta", "prompt-caching-2024-07-31");
    if let Some(agent_id) = request
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        outbound = outbound.header("x-aura-agent-id", agent_id);
    }

    let response = outbound.json(&request_body).send().await.map_err(|error| {
        warn!(%error, "recorded skill analysis request failed");
        ApiError::internal("Could not analyze the recording")
    })?;
    if !response.status().is_success() {
        let status = response.status();
        warn!(%status, "recorded skill analysis returned an error");
        return Err(ApiError::internal("Could not analyze the recording"));
    }

    let body: Value = response.json().await.map_err(|error| {
        warn!(%error, "recorded skill analysis response was invalid");
        ApiError::internal("Could not read the generated skill")
    })?;
    let text = body
        .get("content")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .find(|text| !text.trim().is_empty())
        })
        .ok_or_else(|| ApiError::internal("The skill generator returned no content"))?;
    let draft = parse_recorded_skill_draft(text).map_err(|error| {
        warn!(%error, "recorded skill analysis returned malformed JSON");
        ApiError::internal("The generated skill could not be parsed")
    })?;
    Ok(Json(draft))
}

fn validate_recording_request(request: &AnalyzeSkillRecordingRequest) -> ApiResult<()> {
    let goal = request.goal.trim();
    if goal.is_empty() {
        return Err(ApiError::bad_request("goal is required"));
    }
    if goal.chars().count() > MAX_GOAL_CHARS {
        return Err(ApiError::bad_request(format!(
            "goal must be at most {MAX_GOAL_CHARS} characters"
        )));
    }
    if request
        .notes
        .as_deref()
        .is_some_and(|notes| notes.chars().count() > MAX_NOTES_CHARS)
    {
        return Err(ApiError::bad_request(format!(
            "notes must be at most {MAX_NOTES_CHARS} characters"
        )));
    }
    if request.frames.is_empty() || request.frames.len() > MAX_RECORDING_FRAMES {
        return Err(ApiError::bad_request(format!(
            "recording must contain 1 to {MAX_RECORDING_FRAMES} frames"
        )));
    }

    let mut total_bytes = 0usize;
    for frame in &request.frames {
        if !matches!(frame.media_type.as_str(), "image/png" | "image/jpeg") {
            return Err(ApiError::bad_request(
                "recording frames must be PNG or JPEG images",
            ));
        }
        if frame.data.is_empty() || frame.data.len() > MAX_FRAME_BASE64_BYTES {
            return Err(ApiError::bad_request("a recording frame is too large"));
        }
        total_bytes = total_bytes.saturating_add(frame.data.len());
    }
    if total_bytes > MAX_TOTAL_BASE64_BYTES {
        return Err(ApiError::bad_request("recording is too large"));
    }
    Ok(())
}

fn build_router_request(request: &AnalyzeSkillRecordingRequest) -> Value {
    let mut content = vec![json!({
        "type": "text",
        "text": format!(
            "Workflow goal:\n{}\n\nAdditional notes:\n{}\n\nThe following {} screenshots are ordered from earliest to latest.",
            request.goal.trim(),
            request.notes.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or("None"),
            request.frames.len(),
        )
    })];
    for (index, frame) in request.frames.iter().enumerate() {
        content.push(json!({
            "type": "text",
            "text": format!("Screenshot {} of {}", index + 1, request.frames.len()),
        }));
        content.push(json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": frame.media_type,
                "data": frame.data,
            }
        }));
    }
    json!({
        "model": RECORDED_SKILL_MODEL,
        "max_tokens": RECORDED_SKILL_MAX_TOKENS,
        "system": [{
            "type": "text",
            "text": RECORDED_SKILL_SYSTEM_PROMPT,
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": [{ "role": "user", "content": content }],
    })
}

fn parse_recorded_skill_draft(raw: &str) -> Result<RecordedSkillDraft, String> {
    let trimmed = raw.trim();
    let json_text = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);
    let mut draft: RecordedSkillDraft =
        serde_json::from_str(json_text).map_err(|error| error.to_string())?;
    draft.name = slugify_skill_name(&draft.name);
    draft.description = draft.description.trim().to_string();
    draft.body = draft.body.trim().to_string();
    if draft.name.is_empty() || draft.description.is_empty() || draft.body.is_empty() {
        return Err("generated skill fields must not be empty".to_string());
    }
    Ok(draft)
}

fn slugify_skill_name(value: &str) -> String {
    let mut slug = String::new();
    let mut pending_hyphen = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            if pending_hyphen && !slug.is_empty() && slug.len() < 64 {
                slug.push('-');
            }
            pending_hyphen = false;
            if slug.len() < 64 {
                slug.push(character);
            }
        } else {
            pending_hyphen = true;
        }
        if slug.len() >= 64 {
            break;
        }
    }
    slug.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> AnalyzeSkillRecordingRequest {
        AnalyzeSkillRecordingRequest {
            goal: "Publish the weekly report".to_string(),
            notes: None,
            agent_id: Some("agent-1".to_string()),
            frames: vec![RecordingFrame {
                media_type: "image/png".to_string(),
                data: "aGVsbG8=".to_string(),
            }],
        }
    }

    #[test]
    fn router_request_contains_images_and_no_tools() {
        let body = build_router_request(&sample_request());
        assert!(body.get("tools").is_none());
        assert_eq!(body["messages"][0]["content"][2]["type"], "image");
        assert_eq!(
            body["messages"][0]["content"][2]["source"]["media_type"],
            "image/png"
        );
    }

    #[test]
    fn parses_fenced_json_and_normalizes_the_name() {
        let draft = parse_recorded_skill_draft(
            r#"```json
{"name":"Weekly Report!","description":" Publish reports ","body":" 1. Open the report "}
```"#,
        )
        .unwrap();
        assert_eq!(draft.name, "weekly-report");
        assert_eq!(draft.description, "Publish reports");
        assert_eq!(draft.body, "1. Open the report");
    }

    #[test]
    fn validates_frame_count_and_media_type() {
        let mut request = sample_request();
        request.frames.clear();
        assert!(validate_recording_request(&request).is_err());
        request.frames.push(RecordingFrame {
            media_type: "image/gif".to_string(),
            data: "abc".to_string(),
        });
        assert!(validate_recording_request(&request).is_err());
    }
}
