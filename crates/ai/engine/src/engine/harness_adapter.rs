//! Adapter bridging [`EngineToolLoopExecutor`] to the harness [`ToolExecutor`] trait.

use async_trait::async_trait;

use aura_provider::ToolCall as ProviderToolCall;
use aura_harness::{
    AutoBuildResult as HarnessAutoBuild,
    BuildBaseline as HarnessBaseline,
    ToolCallResult as HarnessResult,
    ToolExecutor as HarnessToolExecutor,
};

use super::tool_executor::EngineToolLoopExecutor;

/// Wraps an [`EngineToolLoopExecutor`] to implement the harness
/// [`ToolExecutor`](HarnessToolExecutor) trait.
pub(crate) struct HarnessExecutorAdapter<'a> {
    inner: &'a EngineToolLoopExecutor,
}

impl<'a> HarnessExecutorAdapter<'a> {
    /// Create an adapter wrapping the given engine executor.
    pub(crate) fn new(inner: &'a EngineToolLoopExecutor) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl HarnessToolExecutor for HarnessExecutorAdapter<'_> {
    async fn execute(&self, tool_calls: &[ProviderToolCall]) -> Vec<HarnessResult> {
        let claude_calls: Vec<aura_claude::ToolCall> = tool_calls
            .iter()
            .map(|tc| aura_claude::ToolCall {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input: tc.input.clone(),
            })
            .collect();
        let chat_results = aura_chat::ToolExecutor::execute(self.inner, &claude_calls).await;
        chat_results
            .into_iter()
            .map(|r| HarnessResult {
                tool_use_id: r.tool_use_id,
                content: r.content,
                is_error: r.is_error,
                stop_loop: r.stop_loop,
            })
            .collect()
    }

    async fn auto_build_check(&self) -> Option<HarnessAutoBuild> {
        aura_chat::ToolExecutor::auto_build_check(self.inner)
            .await
            .map(|r| HarnessAutoBuild {
                success: r.success,
                output: r.output,
            })
    }

    async fn capture_build_baseline(&self) -> Option<HarnessBaseline> {
        aura_chat::ToolExecutor::capture_build_baseline(self.inner)
            .await
            .map(|r| HarnessBaseline {
                error_signatures: r.error_signatures,
            })
    }
}
