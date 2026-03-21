use chrono::Utc;
use serde_json::{json, Value};

use aura_core::*;

use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};
use super::str_field;

impl ChatToolExecutor {
    pub(crate) async fn list_specs_from_storage(&self, project_id: &ProjectId) -> Result<Vec<Spec>, ToolExecResult> {
        let (storage, jwt) = self.storage_and_jwt()?;
        let storage_specs = storage
            .list_specs(&project_id.to_string(), &jwt)
            .await
            .map_err(|e| ToolExecResult::err(format!("aura-storage: {e}")))?;
        Ok(storage_specs
            .into_iter()
            .filter_map(|s| Spec::try_from(s).ok())
            .collect())
    }

    pub(crate) async fn get_spec_from_storage(&self, spec_id: &SpecId) -> Result<Spec, ToolExecResult> {
        let (storage, jwt) = self.storage_and_jwt()?;
        let ss = storage
            .get_spec(&spec_id.to_string(), &jwt)
            .await
            .map_err(|e| ToolExecResult::err(format!("aura-storage: {e}")))?;
        Spec::try_from(ss).map_err(ToolExecResult::err)
    }

    /// Resolve a `spec_id` field that may be a UUID, a title prefix like "01",
    /// or a numeric order index. Falls back to matching against existing specs
    /// when UUID parsing fails so the LLM doesn't need to get the format right.
    pub(crate) async fn resolve_spec_id(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> Result<SpecId, ToolExecResult> {
        let raw = str_field(input, "spec_id")
            .ok_or_else(|| ToolExecResult::err("Missing required field: spec_id"))?;

        if let Ok(id) = raw.parse::<SpecId>() {
            return Ok(id);
        }

        let specs = self.list_specs_from_storage(project_id).await?;

        if let Some(spec) = specs.iter().find(|s| s.title.starts_with(&format!("{raw}:"))) {
            return Ok(spec.spec_id);
        }

        if let Ok(n) = raw.parse::<u32>() {
            let idx = if n > 0 { n - 1 } else { n };
            if let Some(spec) = specs.iter().find(|s| s.order_index == idx) {
                return Ok(spec.spec_id);
            }
            if let Some(spec) = specs.iter().find(|s| s.order_index == n) {
                return Ok(spec.spec_id);
            }
        }

        Err(ToolExecResult::err(format!(
            "Could not resolve spec_id '{raw}'. Use the UUID returned by list_specs or create_spec."
        )))
    }

    pub(crate) async fn list_specs(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.list_specs_from_storage(project_id).await {
            Ok(specs) => {
                let summaries: Vec<Value> = specs
                    .iter()
                    .map(|s| {
                        json!({
                            "spec_id": s.spec_id.to_string(),
                            "title": s.title,
                            "order_index": s.order_index,
                        })
                    })
                    .collect();
                ToolExecResult::ok(json!({ "specs": summaries }))
            }
            Err(e) => e,
        }
    }

    pub(crate) async fn get_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input).await {
            Ok(id) => id,
            Err(e) => return e,
        };
        match self.get_spec_from_storage(&spec_id).await {
            Ok(s) => ToolExecResult::ok(json!(s)),
            Err(e) => e,
        }
    }

    pub(crate) async fn create_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let title = str_field(input, "title").unwrap_or_default();
        let markdown = str_field(input, "markdown_contents").unwrap_or_default();

        let existing = self.list_specs_from_storage(project_id).await.unwrap_or_default();
        let order = existing.iter().map(|s| s.order_index).max().unwrap_or(0) + 1;

        let (storage, jwt) = match self.storage_and_jwt() {
            Ok(v) => v,
            Err(e) => return e,
        };
        let req = aura_storage::CreateSpecRequest {
            title: title.clone(),
            order_index: Some(order as i32),
            markdown_contents: Some(markdown.clone()),
        };
        match storage.create_spec(&project_id.to_string(), &jwt, &req).await {
            Ok(ss) => match Spec::try_from(ss) {
                Ok(spec) => ToolExecResult::ok_with_spec(json!(spec), spec),
                Err(e) => ToolExecResult::err(e),
            },
            Err(e) => ToolExecResult::err(format!("aura-storage: {e}")),
        }
    }

    pub(crate) async fn update_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input).await {
            Ok(id) => id,
            Err(e) => return e,
        };
        let spec = match self.get_spec_from_storage(&spec_id).await {
            Ok(s) => s,
            Err(e) => return e,
        };
        let (storage, jwt) = match self.storage_and_jwt() {
            Ok(v) => v,
            Err(e) => return e,
        };
        let new_title = str_field(input, "title");
        let new_markdown = str_field(input, "markdown_contents");
        let req = aura_storage::UpdateSpecRequest {
            title: new_title.clone(),
            order_index: None,
            markdown_contents: new_markdown.clone(),
        };
        if let Err(e) = storage.update_spec(&spec_id.to_string(), &jwt, &req).await {
            return ToolExecResult::err(format!("aura-storage: {e}"));
        }
        let mut updated = spec;
        if let Some(t) = new_title {
            updated.title = t;
        }
        if let Some(m) = new_markdown {
            updated.markdown_contents = m;
        }
        updated.updated_at = Utc::now();
        ToolExecResult::ok_with_spec(json!(updated), updated)
    }

    pub(crate) async fn delete_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input).await {
            Ok(id) => id,
            Err(e) => return e,
        };
        let (storage, jwt) = match self.storage_and_jwt() {
            Ok(v) => v,
            Err(e) => return e,
        };
        match storage.delete_spec(&spec_id.to_string(), &jwt).await {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": spec_id.to_string() })),
            Err(e) => ToolExecResult::err(format!("aura-storage: {e}")),
        }
    }
}
