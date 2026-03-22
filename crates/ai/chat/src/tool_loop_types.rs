use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;
use aura_billing::MeteredLlm;
use aura_claude::{RichMessage, ThinkingConfig, ToolCall, ToolDefinition};

// ---------------------------------------------------------------------------
// Per-call input bundle (replaces 8 positional args to `run_tool_loop`)
// ---------------------------------------------------------------------------

pub struct ToolLoopInput<'a> {
    pub llm: Arc<MeteredLlm>,
    pub api_key: &'a str,
    pub system_prompt: &'a str,
    pub initial_messages: Vec<RichMessage>,
    pub tools: Arc<[ToolDefinition]>,
    pub config: &'a ToolLoopConfig,
    pub executor: &'a (dyn ToolExecutor + 'a),
    pub event_tx: &'a mpsc::UnboundedSender<ToolLoopEvent>,
}

/// Borrowed subset of [`ToolLoopInput`] that stays constant across iterations.
pub(crate) struct IterationContext<'a> {
    pub llm: &'a Arc<MeteredLlm>,
    pub api_key: &'a str,
    pub system_prompt: &'a str,
    pub tools: &'a Arc<[ToolDefinition]>,
    pub config: &'a ToolLoopConfig,
    pub event_tx: &'a mpsc::UnboundedSender<ToolLoopEvent>,
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

pub struct ToolLoopConfig {
    pub max_iterations: usize,
    pub max_tokens: u32,
    pub thinking: Option<ThinkingConfig>,
    pub stream_timeout: Duration,
    pub billing_reason: &'static str,
    /// When set, the loop uses API-reported input_tokens (not the chars/4
    /// heuristic) to detect context window pressure and retroactively compact
    /// older tool results before the next iteration.
    pub max_context_tokens: Option<u64>,
    /// Maximum credits to spend in this tool loop. The loop stops gracefully
    /// when cumulative debited credits approach this limit. `None` means no cap.
    pub credit_budget: Option<u64>,
    /// Base exploration allowance (read_file, search_code, find_files,
    /// list_files calls before blocking). Defaults to 12 when `None`.
    pub exploration_allowance: Option<usize>,
    /// Override the LLM model for this loop (e.g. use a lighter model for
    /// simple tasks). `None` uses the provider's default.
    pub model_override: Option<String>,
    /// Number of write-bearing iterations to skip between automatic build
    /// checks. `None` defaults to 2. Engine tasks use 1 for tighter feedback.
    pub auto_build_cooldown: Option<usize>,
}

// ---------------------------------------------------------------------------
// Tool execution trait -- callers implement this
// ---------------------------------------------------------------------------

pub struct ToolCallResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
    /// When true the loop will break after processing all results in this batch.
    pub stop_loop: bool,
}

#[async_trait]
pub trait ToolExecutor: Send + Sync {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult>;

    /// Run a lightweight build check (e.g. `cargo check --lib`) and return the
    /// combined stdout+stderr output. Returns `None` when build checking is not
    /// supported or not configured for this project.
    async fn auto_build_check(&self) -> Option<AutoBuildResult> {
        None
    }

    /// Capture the current build error state to use as a baseline for
    /// distinguishing pre-existing errors from newly introduced ones.
    async fn capture_build_baseline(&self) -> Option<BuildBaseline> {
        None
    }
}

/// Result of an automatic build check triggered after write operations.
pub struct AutoBuildResult {
    pub success: bool,
    pub output: String,
}

/// Normalized error signatures from a build baseline, used to distinguish
/// pre-existing errors from newly introduced ones.
#[derive(Debug, Clone, Default)]
pub struct BuildBaseline {
    pub error_signatures: Vec<String>,
}

impl BuildBaseline {
    /// Annotate build output by diffing against pre-existing errors.
    /// Uses the same splitting heuristic as the baseline capture: each block
    /// starting with `error[E` or `error:` is one logical error.
    pub fn annotate(&self, output: &str) -> String {
        if self.error_signatures.is_empty() {
            return output.to_string();
        }

        let current_sigs = Self::extract_signatures(output);
        if current_sigs.is_empty() {
            return output.to_string();
        }

        let mut new_count = 0usize;
        let mut preexisting_count = 0usize;
        for sig in &current_sigs {
            if self.error_signatures.contains(sig) {
                preexisting_count += 1;
            } else {
                new_count += 1;
            }
        }

        if preexisting_count == 0 {
            return output.to_string();
        }

        format!(
            "[BASELINE] {} error(s) are NEW (introduced by your changes), \
             {} error(s) are PRE-EXISTING (ignore them). Focus only on the new errors.\n\n{}",
            new_count, preexisting_count, output,
        )
    }

    /// Extract individual error blocks and produce a normalized signature per
    /// block. Each block starts with `error[E...` or `error:` and extends
    /// until the next such line. Normalization strips line/col numbers so that
    /// the same logical error matches across different file locations.
    pub fn extract_signatures(stderr: &str) -> Vec<String> {
        let mut signatures = Vec::new();
        let mut current_block = String::new();

        for line in stderr.lines() {
            let trimmed = line.trim_start();
            let is_error_start = trimmed.starts_with("error[E")
                || (trimmed.starts_with("error:") && !trimmed.starts_with("error: aborting"));

            if is_error_start && !current_block.is_empty() {
                let sig = Self::normalize_block(&current_block);
                if !sig.is_empty() {
                    signatures.push(sig);
                }
                current_block.clear();
            }
            if !current_block.is_empty() || is_error_start {
                current_block.push_str(line);
                current_block.push('\n');
            }
        }

        if !current_block.is_empty() {
            let sig = Self::normalize_block(&current_block);
            if !sig.is_empty() {
                signatures.push(sig);
            }
        }

        signatures
    }

    /// Normalize a single error block by stripping line numbers, column
    /// numbers, source-location indicators, and help lines.
    fn normalize_block(block: &str) -> String {
        let mut lines: Vec<String> = Vec::new();
        for line in block.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed.starts_with("For more information")
                || trimmed.starts_with("help:")
            {
                continue;
            }
            if trimmed.starts_with("-->") {
                lines.push("-->LOCATION".into());
                continue;
            }
            if trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) && trimmed.contains('|') {
                continue;
            }
            if trimmed.chars().all(|c| c == '^' || c == '-' || c == ' ' || c == '~' || c == '+') {
                continue;
            }
            let normalized = Self::strip_line_col(trimmed);
            if !normalized.is_empty() {
                lines.push(normalized);
            }
        }
        lines.sort();
        lines.dedup();
        lines.join("\n")
    }

    fn strip_line_col(line: &str) -> String {
        let mut result = String::with_capacity(line.len());
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == ':' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit() {
                result.push(':');
                result.push('N');
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            } else {
                result.push(chars[i]);
                i += 1;
            }
        }
        result
    }
}

// ---------------------------------------------------------------------------
// Stream events emitted by the loop
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum ToolLoopEvent {
    Delta(String),
    ThinkingDelta(String),
    ToolUseStarted {
        id: String,
        name: String,
    },
    ToolUseDetected {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        tool_name: String,
        content: String,
        is_error: bool,
    },
    IterationTokenUsage {
        input_tokens: u64,
        output_tokens: u64,
    },
    IterationComplete {
        iteration: usize,
    },
    Error(String),
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

pub struct ToolLoopResult {
    pub text: String,
    pub thinking: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub iterations_run: usize,
    pub timed_out: bool,
    pub insufficient_credits: bool,
    /// Set when the LLM returned a non-billing API error (e.g. provider
    /// credit exhaustion, rate limit, auth failure). Callers should treat
    /// this as a hard failure rather than a successful completion.
    pub llm_error: Option<String>,
}
