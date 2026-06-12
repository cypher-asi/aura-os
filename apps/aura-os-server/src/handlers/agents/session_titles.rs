//! ChatGPT-style session title/summary generation.
//!
//! Two entry points share one router-call core:
//! - [`generate_session_title`] — on-send flow: titles a brand-new
//!   session from the user's first message, spawned from the chat send
//!   path so the title lands in the sidekick while the assistant turn
//!   is still streaming.
//! - [`generate_session_summary`] — lazy `/summarize` flow: loads the
//!   transcript from storage and titles from a few turns of context.
//!   Kept for backfilling sessions created before the on-send path
//!   existed, and reused by the auto-fork rollover summary.

use serde_json::json;

use aura_os_storage::StorageClient;

const HAIKU_MODEL: &str = "claude-haiku-4-5-20251001";
/// 32 tokens is plenty for a 2-5 word title; the extra slack is room
/// for Haiku to choose the slightly-longer phrasing when the topic
/// genuinely needs it (e.g. "Cyberpunk Character Design Iteration").
const SUMMARY_MAX_TOKENS: u32 = 32;
const TRANSCRIPT_CHAR_LIMIT: usize = 4000;
/// Cap how much of the user's first message we send to the title
/// model. 2k chars covers any reasonable prompt and keeps the request
/// small; longer prompts get truncated rather than blowing past
/// router limits.
const TITLE_INPUT_CHAR_LIMIT: usize = 2000;

/// Title-style system prompt shared by both flows.
///
/// Calibrated to mimic ChatGPT's recents list — short, scannable,
/// title-cased noun phrases like "Heartburn During Water Fast" or
/// "Logo Addition Request". Plain text only because the sidekick row
/// renders the result as a single-line label and any `#`/`**`/`-`
/// decoration leaks through as literal characters; the render-time
/// strip in `interface/src/components/SessionsList/session-row-utils.ts`
/// is a backstop for older summaries that already carry these
/// prefixes.
const TITLE_SYSTEM_PROMPT: &str = "Generate a concise 2-5 word title for this conversation \
based on the user's message. Use title case (e.g. \"Heartburn During Water Fast\", \
\"Logo Addition Request\", \"Cyberpunk Character Design\"). Be specific to the topic. \
No quotes, no trailing punctuation. Output only the title, nothing else.";

/// Everything a title/summary generation round-trip needs: storage to
/// read/persist, the router HTTP client, and the aura-* attribution
/// identifiers so the LLM tokens land on the right session/project.
pub(crate) struct TitleGenScope<'a> {
    pub storage: &'a StorageClient,
    pub http: &'a reqwest::Client,
    pub router_url: &'a str,
    pub jwt: &'a str,
    pub session_id: &'a str,
    pub project_id: &'a str,
    pub agent_id: &'a str,
}

/// Strip whitespace, surrounding quotes, and trailing punctuation that
/// the model occasionally appends despite the prompt asking it not to.
/// Returns an empty string if nothing meaningful remains.
fn clean_title(raw: &str) -> String {
    let trimmed = raw.trim();
    let stripped = trimmed
        .trim_start_matches(['"', '\'', '`'])
        .trim_end_matches(['"', '\'', '`', '.', ':']);
    stripped.trim().to_string()
}

/// Lazy `/summarize` flow: build a transcript from the persisted
/// events and title it. The transcript gives Haiku a few extra turns
/// of context to title against (vs. titling from just the first user
/// message), which is useful when the first message alone is
/// ambiguous like "fix this" or "again".
pub(crate) async fn generate_session_summary(scope: &TitleGenScope<'_>) -> Result<String, String> {
    let events = scope
        .storage
        .list_events(scope.session_id, scope.jwt, None, None)
        .await
        .map_err(|e| format!("listing events: {e}"))?;

    let transcript = build_title_transcript(&events);
    if transcript.is_empty() {
        return Ok(String::new());
    }

    let summary = request_title_from_router(scope, &transcript).await?;
    if !summary.is_empty() {
        persist_session_summary(scope, &summary).await?;
    }
    Ok(summary)
}

/// On-send title generator. Builds a ChatGPT-style 2-5 word noun
/// phrase from the user's first message in a brand-new session and
/// persists it as `summary_of_previous_context`. Designed to be
/// `tokio::spawn`'d from the chat send path so the title lands in the
/// sidekick before the assistant's turn finishes streaming.
///
/// Distinct from [`generate_session_summary`] because we already have
/// the user's message in hand and don't need to round-trip storage to
/// load the transcript — keeping the critical-path latency low.
pub(crate) async fn generate_session_title(
    scope: &TitleGenScope<'_>,
    first_user_message: &str,
) -> Result<String, String> {
    let trimmed = first_user_message.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let prompt_input: &str = if trimmed.len() > TITLE_INPUT_CHAR_LIMIT {
        &trimmed[..TITLE_INPUT_CHAR_LIMIT]
    } else {
        trimmed
    };

    let title = request_title_from_router(scope, prompt_input).await?;
    if title.is_empty() {
        return Ok(String::new());
    }
    persist_session_summary(scope, &title).await?;
    Ok(title)
}

/// Flatten terminal events into a `User:`/`Assistant:` transcript,
/// truncated at [`TRANSCRIPT_CHAR_LIMIT`].
fn build_title_transcript(events: &[aura_os_storage::StorageSessionEvent]) -> String {
    let mut transcript = String::new();
    for event in events {
        let event_type = event.event_type.as_deref().unwrap_or("");
        let content = event.content.as_ref();
        let text = content
            .and_then(|c| c.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let role = match event_type {
            "user_message" => "User",
            "assistant_message_end" | "task_output" => "Assistant",
            _ => continue,
        };
        transcript.push_str(role);
        transcript.push_str(": ");
        transcript.push_str(text);
        transcript.push('\n');
        if transcript.len() > TRANSCRIPT_CHAR_LIMIT {
            transcript.truncate(TRANSCRIPT_CHAR_LIMIT);
            transcript.push_str("\n[truncated]");
            break;
        }
    }
    transcript
}

/// Shared router round-trip for both flows: one Haiku `/v1/messages`
/// call with the title system prompt, the aura-* attribution headers
/// (without them aura-router's `SessionContext::from_headers` returns
/// `None` and the token_usage_daily row gets `project_id = null` —
/// silently excluded from per-project cost aggregation), and the
/// response cleaned via [`clean_title`].
async fn request_title_from_router(
    scope: &TitleGenScope<'_>,
    user_content: &str,
) -> Result<String, String> {
    let req_body = json!({
        "model": HAIKU_MODEL,
        "max_tokens": SUMMARY_MAX_TOKENS,
        "system": [
            {
                "type": "text",
                "text": TITLE_SYSTEM_PROMPT,
                "cache_control": { "type": "ephemeral" }
            }
        ],
        "messages": [{"role": "user", "content": user_content}],
    });

    let resp = scope
        .http
        .post(format!("{}/v1/messages", scope.router_url))
        .bearer_auth(scope.jwt)
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .header("x-aura-session-id", scope.session_id)
        .header("x-aura-project-id", scope.project_id)
        .header("x-aura-agent-id", scope.agent_id)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("title LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("title LLM returned {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parsing title LLM response: {e}"))?;

    Ok(clean_title(
        body.get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|block| block.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or(""),
    ))
}

async fn persist_session_summary(scope: &TitleGenScope<'_>, summary: &str) -> Result<(), String> {
    let update_req = aura_os_storage::UpdateSessionRequest {
        summary_of_previous_context: Some(summary.to_string()),
        ..Default::default()
    };
    scope
        .storage
        .update_session(scope.session_id, scope.jwt, &update_req)
        .await
        .map_err(|e| format!("updating session summary: {e}"))
}
