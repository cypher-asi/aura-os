//! End-to-end coverage for the safety valve + permissions cache added
//! to the cross-agent tool dispatcher.
//!
//! Two flavors of regression this pins down:
//!
//! 1. Session-open populates the `permissions_cache` under the stamped
//!    id the dispatcher actually reads (`AgentId` or
//!    `AgentInstanceId`, as a string). The dispatcher is expected to
//!    answer capability checks from that cache *before* falling back to
//!    the local shadow / aura-network resolve, so local-only installs
//!    (where `AURA_NETWORK_URL` is not set) never regress the CEO agent
//!    to 403 on `list_agents` / `get_fleet_status`.
//!
//! 2. `AURA_TOOL_POLICY_MODE=audit` (the default) makes a would-deny
//!    call succeed with a `deny_audit` row in the audit log. This is
//!    the ship-first safety valve that keeps users moving if a
//!    permission-bundle bug lands in prod.

mod common;

use std::time::Duration;

use aura_os_agent_runtime::audit::AgentToolInvocation;
use aura_os_core::AgentPermissions;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use common::*;

/// Build a POST request to `/api/agent_tools/:name` carrying the test
/// JWT and the supplied agent-id header value.
fn dispatch_request(tool: &str, agent_id: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/api/agent_tools/{tool}"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {TEST_JWT}"))
        .header("x-aura-agent-id", agent_id)
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap()
}

/// Poll the audit log up to ~1s waiting for an entry for
/// `invocation_id`. The dispatcher records asynchronously via
/// `record_allow` / `record_deny`, so a bare `snapshot().await` right
/// after the HTTP call occasionally races and returns an empty slice
/// on slow CI runners.
async fn wait_for_audit_entry(
    runtime: &aura_os_agent_runtime::AgentRuntimeService,
    tool_name: &str,
) -> Option<AgentToolInvocation> {
    for _ in 0..20 {
        let rows = runtime.recent_tool_invocations().await;
        if let Some(row) = rows.into_iter().rev().find(|r| r.tool_name == tool_name) {
            return Some(row);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    None
}

/// Whole dispatcher policy-mode lifecycle in a single test so the env
/// variable is set sequentially and never races other tests in this
/// binary. Sub-cases:
///
/// 1. `enforce` + cache miss → 403 (resolve fails with no network
///    client). Proves the cache is actually consulted and not silently
///    bypassed.
/// 2. `enforce` + cache hit with `ceo_preset` → 200. Proves the cache
///    short-circuits the would-be-403 resolve path.
/// 3. `audit` + cache miss → 200 with `deny_audit` audit row. Proves
///    the safety valve falls through to execution.
#[tokio::test]
async fn dispatcher_policy_modes_and_cache() {
    // build_test_app wires `network_client: None`, so any code path
    // that reaches `AgentService::get_agent_with_jwt` returns
    // "aura-network is not configured". That's exactly the
    // local-only-install scenario we're protecting against.
    let (app, state, _tmp) = build_test_app();
    store_zero_auth_session(&state.store);

    // Use the same uuid shape chat.rs stamps. The dispatcher reads the
    // raw header value, so as long as the cache key matches the
    // header, the parse step is never reached.
    let agent_id = "11111111-2222-3333-4444-555555555555";

    // -----------------------------------------------------------------
    // 1. Enforce + cache miss → 403
    // -----------------------------------------------------------------
    unsafe {
        std::env::set_var("AURA_TOOL_POLICY_MODE", "enforce");
    }
    state.permissions_cache.remove(agent_id);
    assert!(
        state.permissions_cache.get(agent_id).is_none(),
        "cache must be empty for the enforce-miss case"
    );

    let resp = app
        .clone()
        .oneshot(dispatch_request(
            "list_agents",
            agent_id,
            serde_json::json!({}),
        ))
        .await
        .expect("oneshot dispatch");
    assert_eq!(
        resp.status(),
        StatusCode::FORBIDDEN,
        "enforce-mode + cache miss + no network client must 403 \
         (this is the regression the cache fixes)"
    );

    // -----------------------------------------------------------------
    // 2. Enforce + cache hit (ceo_preset) → not 403
    // -----------------------------------------------------------------
    state
        .permissions_cache
        .insert(agent_id, AgentPermissions::ceo_preset());

    let resp = app
        .clone()
        .oneshot(dispatch_request(
            "list_agents",
            agent_id,
            serde_json::json!({}),
        ))
        .await
        .expect("oneshot dispatch");
    assert_ne!(
        resp.status(),
        StatusCode::FORBIDDEN,
        "cache hit with ceo_preset must NOT 403 in enforce mode \
         (observed status: {})",
        resp.status()
    );
    // `list_agents` with no network client falls back to the local
    // agent_service.list_agents() which succeeds with an empty list.
    assert!(
        resp.status().is_success(),
        "list_agents with ceo_preset should succeed (got {})",
        resp.status()
    );

    // -----------------------------------------------------------------
    // 3. Audit + cache miss → not 403 + deny_audit audit row
    // -----------------------------------------------------------------
    unsafe {
        std::env::set_var("AURA_TOOL_POLICY_MODE", "audit");
    }
    state.permissions_cache.remove(agent_id);
    assert!(
        state.permissions_cache.get(agent_id).is_none(),
        "cache must be empty for the audit-fallthrough case"
    );

    let resp = app
        .clone()
        .oneshot(dispatch_request(
            "list_agents",
            agent_id,
            serde_json::json!({}),
        ))
        .await
        .expect("oneshot dispatch");
    assert_ne!(
        resp.status(),
        StatusCode::FORBIDDEN,
        "audit mode must NOT 403 on a would-deny call \
         (observed status: {})",
        resp.status()
    );
    assert!(
        resp.status().is_success(),
        "audit-fallthrough list_agents should still execute the tool (got {})",
        resp.status()
    );

    // The audit log is populated asynchronously from `record_deny`; poll
    // briefly so the assertion is robust on slow runners.
    let row = wait_for_audit_entry(&state.agent_runtime, "list_agents")
        .await
        .expect("expected an audit row for list_agents");
    assert_eq!(
        row.permit_decision, "deny_audit",
        "audit-mode fallthrough must record permit_decision=deny_audit"
    );
    assert!(
        row.permit_reason.is_some(),
        "deny_audit row must carry a human-readable reason"
    );

    // Restore env for subsequent tests in the binary.
    unsafe {
        std::env::remove_var("AURA_TOOL_POLICY_MODE");
    }
}
