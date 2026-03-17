use serde::{Deserialize, Serialize};
use std::env;

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

impl LlmConfig {
    /// Build config from environment variables, falling back to defaults.
    ///
    /// Supported env vars (all optional):
    /// - `AURA_LLM_MODEL`
    /// - `AURA_LLM_CHAT_MAX_TOKENS`
    /// - `AURA_LLM_TASK_MAX_TOKENS`
    /// - `AURA_LLM_THINKING_BUDGET`
    /// - `AURA_LLM_MAX_CONTEXT_TOKENS`
    /// - `AURA_LLM_KEEP_RECENT_MESSAGES`
    /// - `AURA_LLM_STREAM_TIMEOUT_SECS`
    pub fn from_env() -> Self {
        let defaults = Self::default();
        Self {
            default_model: env::var("AURA_LLM_MODEL")
                .unwrap_or(defaults.default_model),
            chat_max_tokens: parse_env("AURA_LLM_CHAT_MAX_TOKENS")
                .unwrap_or(defaults.chat_max_tokens),
            task_execution_max_tokens: parse_env("AURA_LLM_TASK_MAX_TOKENS")
                .unwrap_or(defaults.task_execution_max_tokens),
            thinking_budget: parse_env("AURA_LLM_THINKING_BUDGET")
                .unwrap_or(defaults.thinking_budget),
            max_context_tokens: parse_env("AURA_LLM_MAX_CONTEXT_TOKENS")
                .unwrap_or(defaults.max_context_tokens),
            keep_recent_messages: parse_env("AURA_LLM_KEEP_RECENT_MESSAGES")
                .unwrap_or(defaults.keep_recent_messages),
            stream_timeout_secs: parse_env("AURA_LLM_STREAM_TIMEOUT_SECS")
                .unwrap_or(defaults.stream_timeout_secs),
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

impl EngineConfig {
    /// Build config from environment variables, falling back to defaults.
    ///
    /// Supported env vars (all optional):
    /// - `AURA_ENGINE_MAX_AGENTIC_ITERATIONS`
    /// - `AURA_ENGINE_MAX_CHAT_TOOL_ITERATIONS`
    /// - `AURA_ENGINE_MAX_BUILD_FIX_RETRIES`
    /// - `AURA_ENGINE_MAX_EXECUTION_RETRIES`
    /// - `AURA_ENGINE_MAX_SHELL_TASK_RETRIES`
    /// - `AURA_ENGINE_MAX_LOOP_TASK_RETRIES`
    /// - `AURA_ENGINE_MAX_FOLLOW_UPS_PER_LOOP`
    pub fn from_env() -> Self {
        let defaults = Self::default();
        Self {
            max_agentic_iterations: parse_env("AURA_ENGINE_MAX_AGENTIC_ITERATIONS")
                .unwrap_or(defaults.max_agentic_iterations),
            max_chat_tool_iterations: parse_env("AURA_ENGINE_MAX_CHAT_TOOL_ITERATIONS")
                .unwrap_or(defaults.max_chat_tool_iterations),
            max_build_fix_retries: parse_env("AURA_ENGINE_MAX_BUILD_FIX_RETRIES")
                .unwrap_or(defaults.max_build_fix_retries),
            max_execution_retries: parse_env("AURA_ENGINE_MAX_EXECUTION_RETRIES")
                .unwrap_or(defaults.max_execution_retries),
            max_shell_task_retries: parse_env("AURA_ENGINE_MAX_SHELL_TASK_RETRIES")
                .unwrap_or(defaults.max_shell_task_retries),
            max_loop_task_retries: parse_env("AURA_ENGINE_MAX_LOOP_TASK_RETRIES")
                .unwrap_or(defaults.max_loop_task_retries),
            max_follow_ups_per_loop: parse_env("AURA_ENGINE_MAX_FOLLOW_UPS_PER_LOOP")
                .unwrap_or(defaults.max_follow_ups_per_loop),
        }
    }
}

fn parse_env<T: std::str::FromStr>(key: &str) -> Option<T> {
    env::var(key).ok().and_then(|v| v.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn llm_config_defaults_are_sane() {
        let c = LlmConfig::default();
        assert_eq!(c.default_model, "claude-opus-4-6");
        assert!(c.chat_max_tokens > 0);
        assert!(c.thinking_budget > 0);
        assert!(c.stream_timeout_secs > 0);
    }

    #[test]
    fn engine_config_defaults_are_sane() {
        let c = EngineConfig::default();
        assert!(c.max_agentic_iterations > 0);
        assert!(c.max_build_fix_retries > 0);
    }

    #[test]
    fn from_env_falls_back_to_defaults() {
        let llm = LlmConfig::from_env();
        let engine = EngineConfig::from_env();
        let llm_d = LlmConfig::default();
        let engine_d = EngineConfig::default();
        assert_eq!(llm.chat_max_tokens, llm_d.chat_max_tokens);
        assert_eq!(engine.max_agentic_iterations, engine_d.max_agentic_iterations);
    }
}
