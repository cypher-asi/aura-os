use serde_json::Value;

use aura_os_core::{OrgId, OrgIntegrationKind};
use aura_os_harness::ToolAuth;
use aura_os_orgs::IntegrationSecretUpdate;

use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org,
};
use crate::handlers::trusted_mcp::TOOL_TRUST_CLASS_METADATA_KEY;

use super::trusted_mcp_script_test_lock;

#[tokio::test]
async fn installed_workspace_app_tools_include_saved_provider_tools() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Brave Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("brave-secret".to_string()),
        )
        .expect("save brave integration");

    let tools = installed_workspace_app_tools(&state, &org_id, "jwt-123").await;
    let tool_names = tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>();

    assert!(tool_names.contains(&"list_org_integrations"));
    assert!(tool_names.contains(&"brave_search_web"));
    assert!(tool_names.contains(&"brave_search_news"));

    let brave = tools
        .iter()
        .find(|tool| tool.name == "brave_search_web")
        .expect("brave_search_web installed");
    assert!(brave.endpoint.contains("/api/orgs/"));
    assert!(brave.endpoint.ends_with("/tool-actions/brave_search_web"));
    assert!(matches!(brave.auth, ToolAuth::Bearer { .. }));
    assert!(matches!(
        brave.runtime_execution,
        Some(aura_os_harness::InstalledToolRuntimeExecution::AppProvider(
            _
        ))
    ));
    assert_eq!(
        brave
            .required_integration
            .as_ref()
            .and_then(|requirement| requirement.provider.as_deref()),
        Some("brave_search")
    );
    assert_eq!(
        brave
            .required_integration
            .as_ref()
            .and_then(|requirement| requirement.kind.as_deref()),
        Some("workspace_integration")
    );
}

#[tokio::test]
async fn installed_workspace_integrations_include_enabled_runtime_capabilities() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Brave Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("brave-secret".to_string()),
        )
        .expect("save brave integration");

    state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Filesystem MCP".to_string(),
            "mcp_server".to_string(),
            OrgIntegrationKind::McpServer,
            None,
            Some(serde_json::json!({"command":"npx","args":["-y","pkg"]})),
            Some(true),
            IntegrationSecretUpdate::Preserve,
        )
        .expect("save mcp integration");

    let integrations = installed_workspace_integrations_for_org(&state, &org_id).await;
    let ids = integrations
        .iter()
        .map(|integration| integration.provider.as_str())
        .collect::<Vec<_>>();

    assert!(ids.contains(&"brave_search"));
    assert!(ids.contains(&"mcp_server"));
}

#[tokio::test]
async fn installed_workspace_app_tools_include_discovered_trusted_mcp_tools() {
    let _script_lock = trusted_mcp_script_test_lock().lock().await;
    let script_dir = tempfile::tempdir().unwrap();
    let script_path = script_dir.path().join("trusted-mcp-mock.js");
    let response = r#"[{"originalName":"search_docs","description":"Search docs","inputSchema":{"type":"object","properties":{"query":{"type":"string"}}}}]"#;
    std::fs::write(
        &script_path,
        format!(
            "process.stdin.on('data', () => {{}});\nprocess.stdin.on('end', () => process.stdout.write({}));\nprocess.stdin.resume();\n",
            serde_json::to_string(response).unwrap()
        ),
    )
    .unwrap();
    crate::handlers::trusted_mcp::set_script_override_for_tests(script_path);

    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Docs MCP".to_string(),
            "mcp_server".to_string(),
            OrgIntegrationKind::McpServer,
            None,
            Some(serde_json::json!({"transport":"stdio","command":"demo"})),
            Some(true),
            IntegrationSecretUpdate::Preserve,
        )
        .expect("save mcp integration");

    let integration = state
        .org_service
        .list_integrations(&org_id)
        .expect("list integrations")
        .into_iter()
        .find(|integration| integration.provider == "mcp_server")
        .expect("mcp integration exists");
    let discovered = crate::handlers::trusted_mcp::discover_tools(&integration, None)
        .await
        .expect("discover trusted MCP tools");
    assert_eq!(discovered.len(), 1);
    assert_eq!(discovered[0].original_name, "search_docs");

    let tools = installed_workspace_app_tools(&state, &org_id, "jwt-123").await;
    let tool = tools
        .iter()
        .find(|tool| tool.name.contains("search_docs"))
        .expect("trusted MCP tool installed");

    assert_eq!(tool.namespace.as_deref(), Some("aura_trusted_mcp"));
    assert!(tool.endpoint.contains("/tool-actions/mcp/"));
    assert!(matches!(tool.auth, ToolAuth::Bearer { .. }));
    assert_eq!(
        tool.metadata.get(TOOL_TRUST_CLASS_METADATA_KEY),
        Some(&Value::String("trusted_mcp".to_string()))
    );
}
