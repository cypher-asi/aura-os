//! Cross-agent tool dispatcher invoked by harness-hosted agents.
//!
//! Any agent whose [`AgentPermissions`](aura_os_core::AgentPermissions)
//! include one of the cross-agent capabilities
//! (`spawn_agent`, `control_agent`, etc.) is issued an
//! [`aura_protocol::InstalledTool`] pointing at this endpoint when the
//! server opens the harness session. The harness calls back here with
//! the user's JWT and the tool arguments; this handler executes the
//! tool in-process against the authenticated user's world.
//!
//! ```text
//! POST /api/agent_tools/:name
//! Authorization: Bearer <jwt>
//! X-Aura-Org-Id: <org-uuid>   (optional; falls back to server resolution)
//! Content-Type: application/json
//!
//! { ...tool args... }
//! ```
//!
//! The handler resolves `:name` against the server's tool registry,
//! builds a fresh execution context for the authenticated user, and
//! returns the tool's JSON result. Non-2xx is only produced for genuine
//! errors (missing tool, bad args, tool-level failure).

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde_json::Value;
use tracing::{info, warn};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Sentinel used when we genuinely have no org context at all (no
/// header stamped by the harness AND no network client available to
/// resolve the caller's membership). Tools that do org-scoped I/O
/// (`list_agents_by_org`, etc.) should treat this exactly the same as
/// "no org supplied" so the server falls back to the user-scoped
/// query instead of sending a bogus literal to aura-network.
const DEFAULT_ORG_SENTINEL: &str = "default";

/// `X-Aura-Org-Id` header the harness forwards from the session init
/// payload so the dispatcher doesn't have to re-resolve the org on
/// every tool call.
const ORG_ID_HEADER: &str = "x-aura-org-id";

/// POST `/api/agent_tools/:name` — execute a cross-agent tool on behalf
/// of a harness-hosted agent session.
pub(crate) async fn dispatch_agent_tool(
    State(state): State<AppState>,
    Path(tool_name): Path<String>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> ApiResult<Json<Value>> {
    let sas = state.agent_runtime.clone();

    // Use the process-wide cached registry so every cross-agent tool
    // invocation skips the ~55-entry HashMap rebuild.
    let registry = aura_os_agent_runtime::tools::shared_all_tools_registry();
    let tool = registry
        .get(&tool_name)
        .ok_or_else(|| ApiError::not_found(format!("unknown agent tool: {tool_name}")))?;

    let args = body.map(|Json(v)| v).unwrap_or(Value::Null);
    if !matches!(&args, Value::Object(_) | Value::Null) {
        return Err(ApiError::bad_request(
            "tool arguments must be a JSON object".to_string(),
        ));
    }

    let user_id = auth_session.user_id.as_str();
    let org_id = resolve_org_id(&headers, &state, &jwt, user_id).await;

    let ctx = sas.build_context(user_id, &org_id, &jwt);

    info!(
        tool = %tool_name,
        user = %user_id,
        org = %org_id,
        "dispatching cross-agent tool"
    );

    let tool = tool.clone();
    match tool.execute(args, &ctx).await {
        Ok(result) => {
            // Log the serialized content byte size so a future
            // context-bloat regression in any tool surfaces in logs
            // without needing a user bug report. `list_agents` used to
            // return multi-KB `NetworkAgent` records (personality /
            // system_prompt) and a single call drove the CEO's context
            // utilisation to 100% on the next turn — the harness's
            // `Session.messages` vector is append-only, so every
            // bloated tool_result rides along forever. The
            // CONTENT_SIZE_WARN_BYTES threshold (8 KiB) is deliberately
            // generous: typical slim tool outputs land well under 1
            // KiB, so a warn here means something genuinely changed
            // shape.
            const CONTENT_SIZE_WARN_BYTES: usize = 8 * 1024;
            let content_bytes = serde_json::to_string(&result.content)
                .map(|s| s.len())
                .unwrap_or(0);
            if content_bytes > CONTENT_SIZE_WARN_BYTES {
                warn!(
                    tool = %tool_name,
                    user = %user_id,
                    org = %org_id,
                    content_bytes,
                    "agent tool result is large — possible context bloat"
                );
            } else {
                info!(
                    tool = %tool_name,
                    content_bytes,
                    "agent tool result ready"
                );
            }
            Ok(Json(serde_json::json!({
                "tool": tool_name,
                "is_error": result.is_error,
                "content": result.content,
            })))
        }
        Err(err) => {
            warn!(
                tool = %tool_name,
                error = %err,
                "agent tool execution failed"
            );
            Err(ApiError::internal(err.to_string()))
        }
    }
}

/// Resolve the org id the tool should run under.
///
/// Resolution order:
/// 1. `X-Aura-Org-Id` header (set by `stamp_agent_tool_auth` whenever
///    the chatting agent carries an `org_id`).
/// 2. Live lookup against aura-network — pick the first org the JWT
///    has membership in via `client.list_orgs(jwt)`. This is the
///    fallback path for cases where the session was opened without an
///    agent `org_id` (bootstrap-seeded CEO on a fresh install, older
///    harness that didn't forward the header, direct curl, ...).
///
/// If neither yields a real org id we fall back to
/// [`DEFAULT_ORG_SENTINEL`]. Tools that care — `ListAgentsTool` in
/// particular — must recognize the sentinel and degrade gracefully
/// (e.g. by calling the unscoped `list_agents(jwt)` instead of sending
/// `?org_id=default` to aura-network, which would 403 because nobody
/// is a member of that string-literal org).
async fn resolve_org_id(
    headers: &HeaderMap,
    state: &AppState,
    jwt: &str,
    _user_id: &str,
) -> String {
    if let Some(org) = headers
        .get(ORG_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.trim().is_empty())
    {
        return org.to_string();
    }

    if let Some(ref client) = state.network_client {
        match client.list_orgs(jwt).await {
            Ok(orgs) => {
                if let Some(first) = orgs.into_iter().next() {
                    return first.id;
                }
            }
            Err(err) => {
                warn!(
                    error = %err,
                    "resolve_org_id: list_orgs failed; falling back to default sentinel"
                );
            }
        }
    }

    DEFAULT_ORG_SENTINEL.to_string()
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn header_parsing_extracts_org_id() {
        let mut h = HeaderMap::new();
        h.insert("x-aura-org-id", HeaderValue::from_static("org-42"));
        let got = h.get("x-aura-org-id").and_then(|v| v.to_str().ok());
        assert_eq!(got, Some("org-42"));
    }

    #[test]
    fn empty_header_is_ignored() {
        let mut h = HeaderMap::new();
        h.insert("x-aura-org-id", HeaderValue::from_static("   "));
        let got = h
            .get("x-aura-org-id")
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.trim().is_empty());
        assert_eq!(got, None);
    }
}
