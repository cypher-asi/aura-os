use serde::{Deserialize, Serialize};

/// LLM call parameters shared across chat, engine, and other AI callers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub default_model: String,
    pub chat_max_tokens: u32,
    pub task_execution_max_tokens: u32,
    pub thinking_budget: u32,
    pub max_context_tokens: u64,
    pub keep_recent_messages: usize,
    pub stream_timeout_secs: u64,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            default_model: "claude-opus-4-6".into(),
            chat_max_tokens: 24_576,
            task_execution_max_tokens: 32_768,
            thinking_budget: 10_000,
            max_context_tokens: 150_000,
            keep_recent_messages: 10,
            stream_timeout_secs: 600,
        }
    }
}

/// Engine retry/loop tuning knobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub max_agentic_iterations: usize,
    pub max_chat_tool_iterations: usize,
    pub max_build_fix_retries: u32,
    pub max_execution_retries: u32,
    pub max_shell_task_retries: u32,
    pub max_loop_task_retries: u32,
    pub max_follow_ups_per_loop: usize,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            max_agentic_iterations: 50,
            max_chat_tool_iterations: 25,
            max_build_fix_retries: 5,
            max_execution_retries: 2,
            max_shell_task_retries: 20,
            max_loop_task_retries: 5,
            max_follow_ups_per_loop: 20,
        }
    }
}
