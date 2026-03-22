use super::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use async_trait::async_trait;
use aura_claude::{ToolCall, ToolDefinition};
use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_billing::testutil;
use crate::tool_loop_blocking::{
    apply_cmd_failure_tracking, build_tool_result_blocks, collect_duplicate_write_paths,
    detect_blocked_commands, detect_blocked_exploration,
    detect_blocked_write_failures, detect_blocked_writes, detect_same_target_stall,
    detect_write_file_cooldowns, looks_truncated, summarize_edit_file_input,
    summarize_write_file_input,
};
use crate::tool_loop_read_guard::{self as read_guard, ReadGuardState};

// ---------------------------------------------------------------------------
// Shared test fixtures and builders
// ---------------------------------------------------------------------------

fn default_config(max_iterations: usize) -> ToolLoopConfig {
    ToolLoopConfig {
        max_iterations,
        max_tokens: 4096,
        thinking: None,
        stream_timeout: Duration::from_secs(30),
        billing_reason: "test",
        max_context_tokens: None,
        credit_budget: None,
        exploration_allowance: None,
        model_override: None,
        auto_build_cooldown: None,
    }
}

type ToolHandler = Box<dyn Fn(&[ToolCall]) -> Vec<ToolCallResult> + Send + Sync>;

struct SimpleExecutor {
    handler: ToolHandler,
}

#[async_trait]
impl ToolExecutor for SimpleExecutor {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        (self.handler)(tool_calls)
    }
}

fn noop_executor() -> SimpleExecutor {
    SimpleExecutor {
        handler: Box::new(|_| vec![]),
    }
}

fn ok_executor() -> SimpleExecutor {
    SimpleExecutor {
        handler: Box::new(|calls| {
            calls.iter().map(|tc| ToolCallResult {
                tool_use_id: tc.id.clone(),
                content: "ok".into(),
                is_error: false,
                stop_loop: false,
            }).collect()
        }),
    }
}

#[path = "tool_loop_basic_tests.rs"]
mod basic_tests;

#[path = "tool_loop_blocking_tests.rs"]
mod blocking_tests;

#[path = "tool_loop_stall_tests.rs"]
mod stall_tests;

#[path = "tool_loop_result_tests.rs"]
mod tool_result_tests;

#[path = "tool_loop_budget_tests.rs"]
mod budget_tests;
