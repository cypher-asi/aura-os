//! Pure synthesis of a fallback `task_failed` reason string.

/// Maximum number of characters preserved from
/// [`FailureContext::last_error_excerpt`] before truncation. Picked
/// to comfortably fit a single grep line on a 200-column terminal
/// after the `error: ` prefix and the surrounding clauses.
pub const MAX_ERROR_EXCERPT_LEN: usize = 240;

/// Context bundle the caller assembles from whatever signal is
/// locally available at the `task_failed` arm. Every field is
/// `Option<String>` because in production the harness payload often
/// only carries a subset of them — the synthesizer degrades
/// gracefully when any are missing.
///
/// Kept at four fields to stay well inside the `.cursor/rules-rust.md`
/// 5-param ceiling for future helpers that take this struct by
/// value.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FailureContext {
    /// The reason string the caller already extracted from the
    /// event payload, if any. When `Some` and non-empty, the
    /// synthesizer returns it unchanged — the call site is supposed
    /// to short-circuit before invoking us, but we tolerate the
    /// belt-and-braces case so a caller cannot accidentally
    /// overwrite a real reason with a synthetic one.
    pub real_reason: Option<String>,
    /// Last `terminal_state` the loop forwarder observed for this
    /// task — typically derived from the harness's lifecycle
    /// snapshot or the local activity tracker.
    pub terminal_state: Option<String>,
    /// Name of the last tool the harness invoked before the
    /// `task_failed` arrived. Sourced from the side-effects worker's
    /// per-task state.
    pub last_tool_name: Option<String>,
    /// Tail of the last error-shaped string seen on the wire (e.g.
    /// from a `tool_result` payload with `is_error: true`).
    /// Truncated to [`MAX_ERROR_EXCERPT_LEN`] characters inside
    /// [`synthesize_failure_reason`] so callers can pass the raw
    /// value without pre-trimming.
    pub last_error_excerpt: Option<String>,
}

/// Synthesize a descriptive fallback `task_failed` reason from
/// [`FailureContext`].
///
/// Contract:
///
/// * If [`FailureContext::real_reason`] is `Some` and non-empty
///   after trimming, the trimmed value is returned unchanged.
/// * Otherwise the output is `"task failed: <terminal_state>"`
///   (defaulting to `"unknown"` when the state field is missing
///   too), optionally followed by `"; last tool <tool_name>"` and
///   `"; error: <truncated_excerpt>"` clauses for whichever extra
///   fields are present.
/// * The output is never empty. Even an all-`None` context yields
///   `"task failed: unknown"` so the persisted
///   `Task.execution_notes` always carries actionable text.
///
/// The function is `#[must_use]` so a caller cannot accidentally
/// drop the synthesized string on the floor.
#[must_use]
pub fn synthesize_failure_reason(ctx: &FailureContext) -> String {
    if let Some(reason) = ctx.real_reason.as_deref() {
        let trimmed = reason.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let state = ctx
        .terminal_state
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown");

    let mut parts = vec![format!("task failed: {state}")];

    if let Some(tool) = ctx
        .last_tool_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("last tool {tool}"));
    }

    if let Some(excerpt) = ctx.last_error_excerpt.as_deref() {
        let trimmed = excerpt.trim();
        if !trimmed.is_empty() {
            parts.push(format!(
                "error: {}",
                truncate(trimmed, MAX_ERROR_EXCERPT_LEN)
            ));
        }
    }

    parts.join("; ")
}

/// Truncate `value` to at most `max` characters, appending an
/// ellipsis when characters were dropped. Operates on `char` units
/// so it never splits a multi-byte UTF-8 sequence mid-codepoint.
fn truncate(value: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    if value.chars().count() <= max {
        return value.to_string();
    }
    let head: String = value.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
}
