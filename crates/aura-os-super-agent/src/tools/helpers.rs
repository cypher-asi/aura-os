use aura_os_network::NetworkClient;
use serde_json::json;

use super::ToolResult;
use crate::SuperAgentError;

pub fn require_network(ctx: &super::SuperAgentContext) -> Result<&NetworkClient, SuperAgentError> {
    ctx.network_client
        .as_deref()
        .ok_or_else(|| SuperAgentError::Internal("network client not available".into()))
}

pub fn tool_err(action: &str, e: impl std::fmt::Display) -> SuperAgentError {
    SuperAgentError::ToolError(format!("{action}: {e}"))
}

pub fn require_str<'a>(
    input: &'a serde_json::Value,
    field: &str,
) -> Result<&'a str, SuperAgentError> {
    input[field]
        .as_str()
        .ok_or_else(|| SuperAgentError::ToolError(format!("{field} is required")))
}

pub async fn network_get(
    network: &NetworkClient,
    path: &str,
    jwt: &str,
) -> Result<ToolResult, SuperAgentError> {
    let url = format!("{}{}", network.base_url(), path);
    let resp = network
        .http_client()
        .get(&url)
        .bearer_auth(jwt)
        .send()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(ToolResult {
            content: json!({ "error": body }),
            is_error: true,
        });
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;
    Ok(ToolResult {
        content: body,
        is_error: false,
    })
}

pub async fn network_post(
    network: &NetworkClient,
    path: &str,
    jwt: &str,
    body: &serde_json::Value,
) -> Result<ToolResult, SuperAgentError> {
    let url = format!("{}{}", network.base_url(), path);
    let resp = network
        .http_client()
        .post(&url)
        .bearer_auth(jwt)
        .json(body)
        .send()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(ToolResult {
            content: json!({ "error": body }),
            is_error: true,
        });
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;
    Ok(ToolResult {
        content: body,
        is_error: false,
    })
}

pub async fn network_put(
    network: &NetworkClient,
    path: &str,
    jwt: &str,
    body: &serde_json::Value,
) -> Result<ToolResult, SuperAgentError> {
    let url = format!("{}{}", network.base_url(), path);
    let resp = network
        .http_client()
        .put(&url)
        .bearer_auth(jwt)
        .json(body)
        .send()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(ToolResult {
            content: json!({ "error": body }),
            is_error: true,
        });
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;
    Ok(ToolResult {
        content: body,
        is_error: false,
    })
}

pub async fn network_delete(
    network: &NetworkClient,
    path: &str,
    jwt: &str,
) -> Result<ToolResult, SuperAgentError> {
    let url = format!("{}{}", network.base_url(), path);
    let resp = network
        .http_client()
        .delete(&url)
        .bearer_auth(jwt)
        .send()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(ToolResult {
            content: json!({ "error": body }),
            is_error: true,
        });
    }

    let text = resp.text().await.unwrap_or_default();
    let body: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|_| json!({ "deleted": true }));
    Ok(ToolResult {
        content: body,
        is_error: false,
    })
}

// ---------------------------------------------------------------------------
// Local-server helpers (route through aura-os-server when configured, e.g. so
// the server can perform side-effects like mirroring specs to disk).
// ---------------------------------------------------------------------------

async fn parse_response(resp: reqwest::Response) -> Result<ToolResult, SuperAgentError> {
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Ok(ToolResult {
            content: json!({ "error": body, "status": status.as_u16() }),
            is_error: true,
        });
    }
    let text = resp.text().await.unwrap_or_default();
    if text.trim().is_empty() {
        return Ok(ToolResult {
            content: json!({ "ok": true }),
            is_error: false,
        });
    }
    let body: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|_| json!({ "raw": text }));
    Ok(ToolResult {
        content: body,
        is_error: false,
    })
}

pub async fn local_post(
    base_url: &str,
    client: &reqwest::Client,
    path: &str,
    jwt: &str,
    body: &serde_json::Value,
) -> Result<ToolResult, SuperAgentError> {
    let url = format!("{}{}", base_url, path);
    let resp = client
        .post(&url)
        .bearer_auth(jwt)
        .json(body)
        .send()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;
    parse_response(resp).await
}

pub async fn local_put(
    base_url: &str,
    client: &reqwest::Client,
    path: &str,
    jwt: &str,
    body: &serde_json::Value,
) -> Result<ToolResult, SuperAgentError> {
    let url = format!("{}{}", base_url, path);
    let resp = client
        .put(&url)
        .bearer_auth(jwt)
        .json(body)
        .send()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;
    parse_response(resp).await
}

pub async fn local_delete(
    base_url: &str,
    client: &reqwest::Client,
    path: &str,
    jwt: &str,
) -> Result<ToolResult, SuperAgentError> {
    let url = format!("{}{}", base_url, path);
    let resp = client
        .delete(&url)
        .bearer_auth(jwt)
        .send()
        .await
        .map_err(|e| SuperAgentError::ToolError(e.to_string()))?;
    parse_response(resp).await
}
