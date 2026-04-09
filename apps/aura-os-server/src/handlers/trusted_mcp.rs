use std::path::{Path, PathBuf};
use std::process::Stdio;

use aura_os_core::OrgIntegration;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub(crate) const TOOL_SOURCE_KIND_METADATA_KEY: &str = "aura_source_kind";
pub(crate) const TOOL_TRUST_CLASS_METADATA_KEY: &str = "aura_trust_class";
pub(crate) const MCP_INTEGRATION_ID_METADATA_KEY: &str = "aura_mcp_integration_id";
pub(crate) const MCP_TOOL_NAME_METADATA_KEY: &str = "aura_mcp_tool_name";
pub(crate) const MCP_INTEGRATION_NAME_METADATA_KEY: &str = "aura_mcp_integration_name";

const SCRIPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrustedMcpToolDescriptor {
    pub(crate) original_name: String,
    pub(crate) description: String,
    pub(crate) input_schema: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrustedMcpPayload<'a> {
    integration: &'a OrgIntegration,
    secret: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    args: Option<&'a Value>,
}

#[cfg(test)]
use std::sync::OnceLock;

#[cfg(test)]
static TRUSTED_MCP_SCRIPT_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

pub(crate) async fn discover_tools(
    integration: &OrgIntegration,
    secret: Option<&str>,
) -> Result<Vec<TrustedMcpToolDescriptor>, String> {
    let payload = TrustedMcpPayload {
        integration,
        secret,
        tool_name: None,
        args: None,
    };
    run_bridge_command("list-tools", &payload).await
}

pub(crate) async fn call_tool(
    integration: &OrgIntegration,
    secret: Option<&str>,
    tool_name: &str,
    args: &Value,
) -> Result<Value, String> {
    let payload = TrustedMcpPayload {
        integration,
        secret,
        tool_name: Some(tool_name),
        args: Some(args),
    };
    run_bridge_command("call-tool", &payload).await
}

pub(crate) fn projected_tool_name(integration_id: &str, original_name: &str) -> String {
    format!("mcp_{}__{original_name}", slugify(integration_id))
}

fn script_path() -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(path) = TRUSTED_MCP_SCRIPT_OVERRIDE.get() {
        return Some(path.clone());
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../../interface/scripts/aura-trusted-mcp.mjs"),
        PathBuf::from("interface/scripts/aura-trusted-mcp.mjs"),
        PathBuf::from("../../interface/scripts/aura-trusted-mcp.mjs"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

async fn run_bridge_command<T: serde::de::DeserializeOwned>(
    subcommand: &str,
    payload: &TrustedMcpPayload<'_>,
) -> Result<T, String> {
    let script = script_path().ok_or_else(|| {
        "trusted MCP bridge script not found in the Aura OS workspace".to_string()
    })?;
    run_bridge_command_with_script(&script, subcommand, payload).await
}

async fn run_bridge_command_with_script<T: serde::de::DeserializeOwned>(
    script: &Path,
    subcommand: &str,
    payload: &TrustedMcpPayload<'_>,
) -> Result<T, String> {
    let payload_json = serde_json::to_vec(payload)
        .map_err(|error| format!("serializing MCP bridge payload failed: {error}"))?;

    let mut command = if matches!(
        script.extension().and_then(|extension| extension.to_str()),
        Some("mjs" | "js" | "cjs")
    ) {
        let mut command = Command::new("node");
        command.arg(script);
        command
    } else {
        Command::new(script)
    };
    let mut child = command
        .arg(subcommand)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("spawning trusted MCP bridge failed: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "trusted MCP bridge stdin unavailable".to_string())?;
    stdin
        .write_all(&payload_json)
        .await
        .map_err(|error| format!("writing trusted MCP bridge payload failed: {error}"))?;
    stdin
        .shutdown()
        .await
        .map_err(|error| format!("closing trusted MCP bridge stdin failed: {error}"))?;

    let output = tokio::time::timeout(SCRIPT_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "trusted MCP bridge timed out".to_string())?
        .map_err(|error| format!("waiting for trusted MCP bridge failed: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "trusted MCP bridge `{}` exited with status {}",
                script.display(),
                output.status
            )
        } else {
            format!("trusted MCP bridge failed: {stderr}")
        });
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("trusted MCP bridge returned invalid JSON: {error}"))
}

fn slugify(value: &str) -> String {
    let mut slug = String::with_capacity(value.len());
    let mut last_was_separator = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator {
            slug.push('_');
            last_was_separator = true;
        }
    }
    slug.trim_matches('_').to_string()
}

#[cfg(test)]
pub(crate) fn set_script_override_for_tests(path: PathBuf) {
    let _ = TRUSTED_MCP_SCRIPT_OVERRIDE.set(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{OrgId, OrgIntegrationKind};
    use chrono::Utc;
    use tempfile::tempdir;

    fn sample_integration() -> OrgIntegration {
        let now = Utc::now();
        OrgIntegration {
            integration_id: "mcp-1".to_string(),
            org_id: OrgId::new(),
            name: "Demo MCP".to_string(),
            provider: "mcp_server".to_string(),
            kind: OrgIntegrationKind::McpServer,
            default_model: None,
            provider_config: Some(serde_json::json!({
                "transport": "stdio",
                "command": "demo"
            })),
            has_secret: true,
            enabled: true,
            secret_last4: Some("1234".to_string()),
            created_at: now,
            updated_at: now,
        }
    }

    fn write_mock_script(response: &str) -> PathBuf {
        let dir = tempdir().unwrap();
        let script_path = dir.path().join("trusted-mcp-mock.sh");
        std::fs::write(
            &script_path,
            format!(
                r#"#!/bin/sh
printf '%s' '{response}'
"#
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms).unwrap();
        }
        std::mem::forget(dir);
        script_path
    }

    #[tokio::test]
    async fn discover_tools_parses_bridge_output() {
        let script = write_mock_script(
            r#"[{"originalName":"search","description":"Search docs","inputSchema":{"type":"object"}}]"#,
        );
        let payload = TrustedMcpPayload {
            integration: &sample_integration(),
            secret: Some("secret"),
            tool_name: None,
            args: None,
        };
        let tools: Vec<TrustedMcpToolDescriptor> =
            run_bridge_command_with_script(&script, "list-tools", &payload)
                .await
                .unwrap();
        assert_eq!(
            tools,
            vec![TrustedMcpToolDescriptor {
                original_name: "search".to_string(),
                description: "Search docs".to_string(),
                input_schema: serde_json::json!({"type":"object"}),
            }]
        );
    }

    #[tokio::test]
    async fn call_tool_parses_bridge_output() {
        let script = write_mock_script(r#"{"content":[{"type":"text","text":"ok"}]}"#);
        let integration = sample_integration();
        let payload = TrustedMcpPayload {
            integration: &integration,
            secret: Some("secret"),
            tool_name: Some("search"),
            args: Some(&serde_json::json!({"query":"aura"})),
        };
        let value: Value = run_bridge_command_with_script(&script, "call-tool", &payload)
            .await
            .unwrap();
        assert_eq!(
            value,
            serde_json::json!({"content":[{"type":"text","text":"ok"}]})
        );
    }

    #[test]
    fn projected_tool_name_namespaces_by_integration() {
        assert_eq!(
            projected_tool_name("GitHub MCP 1", "search_code"),
            "mcp_github_mcp_1__search_code"
        );
    }
}
