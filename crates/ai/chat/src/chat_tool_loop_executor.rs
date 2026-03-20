use std::collections::HashSet;

use async_trait::async_trait;
use tokio::sync::mpsc;

use aura_core::*;
use aura_claude::ToolCall;

use crate::channel_ext::send_or_log;
use crate::chat::{ChatStreamEvent, ContentBlockAccumulator};
use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};
use crate::tool_loop::{ToolCallResult, ToolExecutor};

// ---------------------------------------------------------------------------
// Project resolution strategies
// ---------------------------------------------------------------------------

/// Resolve the project ID for a tool call. Implementations define how a tool
/// call is associated with a project.
pub(crate) trait ProjectResolver: Send + Sync {
    fn resolve(&self, tc: &ToolCall) -> Result<ProjectId, &'static str>;

    /// Whether `create_task` calls must run sequentially to preserve order.
    fn sequential_create_task(&self) -> bool;
}

/// Single-project resolver: all calls target a fixed project ID.
pub(crate) struct SingleProjectResolver {
    pub(crate) project_id: ProjectId,
}

impl ProjectResolver for SingleProjectResolver {
    fn resolve(&self, _tc: &ToolCall) -> Result<ProjectId, &'static str> {
        Ok(self.project_id)
    }

    fn sequential_create_task(&self) -> bool {
        true
    }
}

/// Multi-project resolver: the project ID is extracted from the tool input
/// and validated against a set of allowed IDs.
pub(crate) struct MultiProjectResolver {
    pub(crate) allowed_project_ids: HashSet<String>,
}

impl ProjectResolver for MultiProjectResolver {
    fn resolve(&self, tc: &ToolCall) -> Result<ProjectId, &'static str> {
        let pid_str = tc
            .input
            .get("project_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if self.allowed_project_ids.contains(pid_str) {
            pid_str
                .parse::<ProjectId>()
                .map_err(|_| "Missing or invalid project_id. You must specify a valid project_id from the available projects.")
        } else {
            Err("Missing or invalid project_id. You must specify a valid project_id from the available projects.")
        }
    }

    fn sequential_create_task(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// Unified forwarding executor
// ---------------------------------------------------------------------------

pub(crate) struct ForwardingToolExecutor<R: ProjectResolver> {
    pub(crate) inner: ChatToolExecutor,
    pub(crate) resolver: R,
    pub(crate) chat_tx: mpsc::UnboundedSender<ChatStreamEvent>,
    pub(crate) blocks: ContentBlockAccumulator,
}

impl<R: ProjectResolver> ForwardingToolExecutor<R> {
    fn forward_result(&self, tc: &ToolCall, result: &ToolExecResult) -> ToolCallResult {
        if let Some(spec) = &result.saved_spec {
            if let Ok(mut acc) = self.blocks.lock() {
                acc.push(ChatContentBlock::SpecRef {
                    spec_id: spec.spec_id.to_string(),
                    title: spec.title.clone(),
                });
            }
            send_or_log(&self.chat_tx, ChatStreamEvent::SpecSaved(spec.clone()));
        }
        if let Some(task) = &result.saved_task {
            if let Ok(mut acc) = self.blocks.lock() {
                acc.push(ChatContentBlock::TaskRef {
                    task_id: task.task_id.to_string(),
                    title: task.title.clone(),
                });
            }
            send_or_log(&self.chat_tx, ChatStreamEvent::TaskSaved(task.clone()));
        }
        ToolCallResult {
            tool_use_id: tc.id.clone(),
            content: result.content.clone(),
            is_error: result.is_error,
            stop_loop: false,
        }
    }
}

#[async_trait]
impl<R: ProjectResolver> ToolExecutor for ForwardingToolExecutor<R> {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        let mut indexed_results: Vec<(usize, ToolExecResult)> =
            Vec::with_capacity(tool_calls.len());

        if self.resolver.sequential_create_task() {
            let mut concurrent_indices = Vec::new();
            let mut sequential_indices = Vec::new();
            for (i, tc) in tool_calls.iter().enumerate() {
                if tc.name == "create_task" {
                    sequential_indices.push(i);
                } else {
                    concurrent_indices.push(i);
                }
            }

            if !concurrent_indices.is_empty() {
                let futures: Vec<_> = concurrent_indices
                    .iter()
                    .map(|&i| {
                        let tc = &tool_calls[i];
                        let pid = self.resolver.resolve(tc);
                        async move {
                            match pid {
                                Ok(pid) => self.inner.execute(&pid, &tc.name, tc.input.clone()).await,
                                Err(msg) => ToolExecResult::err_static(msg),
                            }
                        }
                    })
                    .collect();
                let results = futures::future::join_all(futures).await;
                for (result, &i) in results.into_iter().zip(&concurrent_indices) {
                    indexed_results.push((i, result));
                }
            }

            for &i in &sequential_indices {
                let tc = &tool_calls[i];
                let result = match self.resolver.resolve(tc) {
                    Ok(pid) => self.inner.execute(&pid, &tc.name, tc.input.clone()).await,
                    Err(msg) => ToolExecResult::err_static(msg),
                };
                indexed_results.push((i, result));
            }

            indexed_results.sort_by_key(|(i, _)| *i);
        } else {
            let futures: Vec<_> = tool_calls
                .iter()
                .map(|tc| {
                    let pid = self.resolver.resolve(tc);
                    async move {
                        match pid {
                            Ok(pid) => self.inner.execute(&pid, &tc.name, tc.input.clone()).await,
                            Err(msg) => ToolExecResult::err_static(msg),
                        }
                    }
                })
                .collect();
            let results = futures::future::join_all(futures).await;
            for (i, result) in results.into_iter().enumerate() {
                indexed_results.push((i, result));
            }
        }

        indexed_results
            .into_iter()
            .map(|(i, result)| {
                let tc = &tool_calls[i];
                self.forward_result(tc, &result)
            })
            .collect()
    }
}
