use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

use super::helpers::require_str;
use super::{AgentToolContext, AgentTool, ToolResult};
use crate::AgentRuntimeError;

fn router_url() -> String {
    std::env::var("AURA_ROUTER_URL").unwrap_or_else(|_| "http://localhost:3100".to_string())
}

// ---------------------------------------------------------------------------
// 1. GenerateImageTool
// ---------------------------------------------------------------------------

pub struct GenerateImageTool;

#[async_trait]
impl AgentTool for GenerateImageTool {
    fn name(&self) -> &str {
        "generate_image"
    }
    fn description(&self) -> &str {
        "Generate an image from a text prompt using AI"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Generation
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "Text prompt describing the image to generate" },
                "model": { "type": "string", "description": "Model to use (optional, server picks default)" }
            },
            "required": ["prompt"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let prompt = require_str(&input, "prompt")?;
        let mut body = json!({ "prompt": prompt });
        if let Some(model) = input["model"].as_str() {
            body["model"] = json!(model);
        }

        let url = format!("{}/v1/generate-image", router_url());
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .bearer_auth(&ctx.jwt)
            .json(&body)
            .send()
            .await
            .map_err(|e| AgentRuntimeError::ToolError(format!("generate_image: {e}")))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Ok(ToolResult {
                content: json!({ "error": err }),
                is_error: true,
            });
        }

        let result: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AgentRuntimeError::ToolError(format!("generate_image: {e}")))?;
        Ok(ToolResult {
            content: result,
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 2. Generate3dModelTool
// ---------------------------------------------------------------------------

pub struct Generate3dModelTool;

#[async_trait]
impl AgentTool for Generate3dModelTool {
    fn name(&self) -> &str {
        "generate_3d_model"
    }
    fn description(&self) -> &str {
        "Generate a 3D model from an image URL"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Generation
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "image_url": { "type": "string", "description": "URL of the source image" }
            },
            "required": ["image_url"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let image_url = require_str(&input, "image_url")?;
        let body = json!({ "image_url": image_url });

        let url = format!("{}/v1/generate-3d", router_url());
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .bearer_auth(&ctx.jwt)
            .json(&body)
            .send()
            .await
            .map_err(|e| AgentRuntimeError::ToolError(format!("generate_3d_model: {e}")))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Ok(ToolResult {
                content: json!({ "error": err }),
                is_error: true,
            });
        }

        let result: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AgentRuntimeError::ToolError(format!("generate_3d_model: {e}")))?;
        Ok(ToolResult {
            content: result,
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 3. Get3dStatusTool
// ---------------------------------------------------------------------------

pub struct Get3dStatusTool;

#[async_trait]
impl AgentTool for Get3dStatusTool {
    fn name(&self) -> &str {
        "get_3d_status"
    }
    fn description(&self) -> &str {
        "Check the status of a 3D model generation task"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Generation
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string", "description": "3D generation task ID" }
            },
            "required": ["task_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let task_id = require_str(&input, "task_id")?;

        let url = format!("{}/v1/generate-3d/{task_id}", router_url());
        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .bearer_auth(&ctx.jwt)
            .send()
            .await
            .map_err(|e| AgentRuntimeError::ToolError(format!("get_3d_status: {e}")))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Ok(ToolResult {
                content: json!({ "error": err }),
                is_error: true,
            });
        }

        let result: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AgentRuntimeError::ToolError(format!("get_3d_status: {e}")))?;
        Ok(ToolResult {
            content: result,
            is_error: false,
        })
    }
}
