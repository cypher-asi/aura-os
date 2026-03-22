//! Tool execution trait and result types.

use async_trait::async_trait;

use crate::types::ToolCall;

/// The result of executing a single tool call.
pub struct ToolCallResult {
    /// The tool_use id this result corresponds to.
    pub tool_use_id: String,
    /// Textual result content.
    pub content: String,
    /// Whether this result represents an error.
    pub is_error: bool,
    /// When true, the agent loop should break after processing this batch.
    pub stop_loop: bool,
}

/// Result of an automatic build check triggered after write operations.
pub struct AutoBuildResult {
    /// Whether the build succeeded.
    pub success: bool,
    /// Combined stdout+stderr output.
    pub output: String,
    /// Number of errors detected in the build output.
    pub error_count: usize,
}

/// Normalized error signatures from a build baseline, used to distinguish
/// pre-existing errors from newly introduced ones.
#[derive(Debug, Clone, Default)]
pub struct BuildBaseline {
    /// Normalized error signatures.
    pub error_signatures: Vec<String>,
}

impl BuildBaseline {
    /// Annotate build output by diffing against pre-existing errors.
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

    /// Extract individual error blocks and produce a normalized signature per block.
    pub fn extract_signatures(stderr: &str) -> Vec<String> {
        let mut signatures = Vec::new();
        let mut current_block = String::new();
        for line in stderr.lines() {
            let trimmed = line.trim_start();
            let is_start = trimmed.starts_with("error[E")
                || (trimmed.starts_with("error:") && !trimmed.starts_with("error: aborting"));
            if is_start && !current_block.is_empty() {
                let sig = Self::normalize_block(&current_block);
                if !sig.is_empty() {
                    signatures.push(sig);
                }
                current_block.clear();
            }
            if !current_block.is_empty() || is_start {
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
            if trimmed
                .chars()
                .all(|c| c == '^' || c == '-' || c == ' ' || c == '~' || c == '+')
            {
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

/// Trait for executing tool calls during an agent turn.
///
/// Implementors handle the actual tool dispatch (file I/O, shell commands,
/// search, etc.) and return results that are fed back into the LLM.
#[async_trait]
pub trait ToolExecutor: Send + Sync {
    /// Execute a batch of tool calls and return their results.
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult>;

    /// Run a lightweight build check and return the result.
    /// Returns `None` when build checking is not configured.
    async fn auto_build_check(&self) -> Option<AutoBuildResult> {
        None
    }

    /// Capture the current build error state as a baseline for diffing.
    async fn capture_build_baseline(&self) -> Option<BuildBaseline> {
        None
    }
}
