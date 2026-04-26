use aura_os_core::{OrgId, OrgIntegrationKind};
use aura_os_orgs::IntegrationSecretUpdate;

use crate::handlers::agents::workspace_tools::installed_workspace_app_tool_catalog;

use super::trusted_mcp_script_test_lock;

#[tokio::test]
async fn installed_workspace_tool_catalog_surfaces_trusted_mcp_discovery_warnings() {
    let _script_lock = trusted_mcp_script_test_lock().lock().await;
    let script_dir = tempfile::tempdir().unwrap();
    let script_path = script_dir.path().join("trusted-mcp-fail.sh");
    std::fs::write(
        &script_path,
        r#"#!/bin/sh
echo 'bridge failure' >&2
exit 1
"#,
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();
    }
    crate::handlers::trusted_mcp::set_script_override_for_tests(script_path);

    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            Some("mcp-1"),
            "Docs MCP".to_string(),
            "mcp_server".to_string(),
            OrgIntegrationKind::McpServer,
            None,
            Some(serde_json::json!({"transport":"stdio","command":"demo"})),
            Some(true),
            IntegrationSecretUpdate::Preserve,
        )
        .expect("save mcp integration");

    let catalog = installed_workspace_app_tool_catalog(&state, &org_id, "jwt-123").await;

    assert_eq!(catalog.warnings.len(), 1);
    assert_eq!(catalog.warnings[0].code, "trusted_mcp_discovery_failed");
    assert_eq!(catalog.warnings[0].integration_id, "mcp-1");
    assert_eq!(catalog.warnings[0].integration_name, "Docs MCP");
    assert_eq!(catalog.warnings[0].source_kind, "mcp");
    assert_eq!(catalog.warnings[0].trust_class, "trusted_mcp");
    assert!(catalog.warnings[0]
        .message
        .contains("tool catalog is partial"));
    assert!(catalog
        .tools
        .iter()
        .all(|tool| tool.namespace.as_deref() != Some("aura_trusted_mcp")));
}
