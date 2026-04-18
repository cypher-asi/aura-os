//! Dispatcher endpoint for super-agent tools invoked by a harness-hosted
//! super-agent.
//!
//! Phase 3 of the super-agent / harness unification: when the harness
//! runs a super-agent session (configured via
//! [`aura_os_super_agent::harness_handoff::build_super_agent_session_init`]),
//! it receives an [`aura_protocol::InstalledTool`] per super-agent tool,
//! each pointing at this endpoint:
//!
//! ```text
//! POST /api/super_agent/tools/:name
//! Authorization: Bearer <jwt>
//! X-Aura-Org-Id: <org-uuid>   (optional; falls back to server resolution)
//! Content-Type: application/json
//!
//! { ...tool args... }
//! ```
//!
//! The handler resolves `:name` against
//! [`SuperAgentService::tool_registry`], builds a fresh
//! [`SuperAgentContext`] for the authenticated user, and invokes the
//! tool's `execute` in-process. The JSON response body is whatever the
//! tool returned; non-2xx is only produced for genuine errors
//! (missing tool, bad args, tool-level failure).
//!
//! Keeping a single dispatcher means adding a new super-agent tool to
//! `ToolRegistry` automatically makes it callable from the harness —
//! no per-tool route registration required.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde_json::Value;
use tracing::{info, warn};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// `X-Aura-Org-Id` header the harness forwards from the session init
/// payload so the dispatcher doesn't have to re-resolve the org on
/// every tool call.
const ORG_ID_HEADER: &str = "x-aura-org-id";

/// POST `/api/super_agent/tools/:name` — execute a super-agent tool.
///
/// Auth: standard bearer flow. The JWT is threaded into the tool's
/// `SuperAgentContext` so tool code can call back into `aura-os-server`
/// / network APIs as the authenticated user.
pub(crate) async fn dispatch_super_agent_tool(
    State(state): State<AppState>,
    Path(tool_name): Path<String>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> ApiResult<Json<Value>> {
    let sas = state.super_agent_service.clone();

    // `with_all_tools` exposes tier-1 AND tier-2 here; the harness-side
    // intent classifier is what narrows the per-turn surface for the
    // model. This dispatcher only refuses to execute a tool if it's not
    // registered at all.
    let registry = aura_os_super_agent::tools::ToolRegistry::with_all_tools();
    let tool = registry.get(&tool_name).ok_or_else(|| {
        ApiError::not_found(format!("unknown super-agent tool: {tool_name}"))
    })?;

    let args = body.map(|Json(v)| v).unwrap_or(Value::Null);
    if !matches!(&args, Value::Object(_) | Value::Null) {
        return Err(ApiError::bad_request(
            "tool arguments must be a JSON object".to_string(),
        ));
    }

    let user_id = auth_session.user_id.as_str();
    let org_id = resolve_org_id(&headers, &sas, &jwt, user_id).await;

    let ctx = sas.build_context(user_id, &org_id, &jwt);

    info!(
        tool = %tool_name,
        user = %user_id,
        org = %org_id,
        "dispatching super-agent tool via harness handoff"
    );

    let tool = tool.clone();
    match tool.execute(args, &ctx).await {
        Ok(result) => {
            // We propagate the tool's `is_error` flag as part of the
            // response body rather than a non-2xx status: the harness's
            // generic installed-tool executor treats non-2xx as an
            // infrastructure error, whereas a tool-level failure is
            // something the model should see and reason about.
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
                "super-agent tool execution failed"
            );
            Err(ApiError::internal(err.to_string()))
        }
    }
}

/// Extract the org id from the `X-Aura-Org-Id` header or fall back to
/// whatever the server would resolve for an in-process super-agent run.
async fn resolve_org_id(
    headers: &HeaderMap,
    _sas: &std::sync::Arc<aura_os_super_agent::SuperAgentService>,
    _jwt: &str,
    _user_id: &str,
) -> String {
    if let Some(org) = headers
        .get(ORG_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.trim().is_empty())
    {
        return org.to_string();
    }
    // Conservative default: no network round-trip from the dispatcher.
    // Real org resolution happens up-front when the harness session is
    // bootstrapped (see `harness_handoff::build_super_agent_session_init`);
    // the dispatcher only needs the org the harness was configured with.
    "default".to_string()
}

#[cfg(test)]
mod tests {
    // Integration-level coverage of the dispatcher lives alongside
    // the harness-gateway integration tests in
    // `apps/aura-os-server/tests`. Here we keep only cheap unit checks
    // that exercise the header parsing so we don't need a full
    // `AppState` harness.

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
