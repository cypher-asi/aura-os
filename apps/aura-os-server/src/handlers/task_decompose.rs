//! Shared skeleton+fill decomposition primitives.
//!
//! This module is the home of the Phase 5 preflight detection path and
//! the skeleton+fill child-task fan-out shared by both:
//!
//! * Phase 3 (`super::dev_loop`) — post-failure remediation of a
//!   truncated run.
//! * Phase 5 (`super::tasks`) — preemptive splitting at task creation
//!   when the title/description signals a likely-oversized generation.
//!
//! Keeping the fan-out in one place means the wording of the skeleton
//! and fill child prompts stays in lockstep across both call sites, and
//! the two phases can evolve the detection independently without drift
//! in how they materialise the children.
//!
//! The module is deliberately storage-agnostic: it takes a
//! [`TaskService`] reference and emits ordinary follow-up tasks via
//! [`TaskService::create_follow_up_task`], so unit tests on the
//! detection helpers don't need any async plumbing.

use aura_os_core::{Task, TaskId};
use aura_os_tasks::{TaskError, TaskService};

/// Default chunk budget for the fill-phase follow-up task. The same
/// number that Phase 3 uses when the heuristic pipeline does not carry
/// a suggestion — ~6 KB maps to roughly the 250-line cap the prompt
/// rules enforce and matches `WRITE_FILE_CHUNK_BYTES` in aura-harness.
pub(crate) const DEFAULT_PREFLIGHT_CHUNK_BYTES: usize = 6_000;

/// Result of running the Phase 5 preflight heuristic against a freshly
/// created (or about-to-be-created) task. `None` means the task looks
/// small enough to run as-is; a `Some(...)` signals the caller to fan
/// out into a skeleton+fill pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecompositionSignal {
    /// Best-effort file path extracted from the task description. The
    /// skeleton child task can still be created when this is `None` —
    /// the prompt just asks the agent to pick a path itself.
    pub(crate) target_path: Option<String>,
    /// Suggested chunk budget for the fill child task's `edit_file`
    /// calls. Always `DEFAULT_PREFLIGHT_CHUNK_BYTES` today; a field
    /// instead of a constant so future rules can escalate.
    pub(crate) estimated_chunk_bytes: usize,
    /// Short diagnostic string — either `phrase:<matched>`,
    /// `long_spec_with_write_hint`, or `explicit_size:<N>_lines`. Used
    /// for the emitted event and to annotate the child descriptions.
    pub(crate) reason: String,
}

/// Caller-site context for [`spawn_skeleton_and_fill_children`]. The
/// child-task prompt boilerplate differs slightly depending on whether
/// the split is happening after a failure (Phase 3) or before the task
/// ever runs (Phase 5), so the same function can serve both without the
/// callers duplicating the fan-out logic.
#[derive(Debug, Clone)]
pub(crate) enum DecompositionContext {
    /// Phase 3: the parent task actually ran and the harness reported a
    /// truncation / no-file-ops failure.
    PostFailure {
        /// Reason text that will be surfaced to the agent in the
        /// skeleton and fill prompts. Phase 3 always passes a fixed
        /// "truncated run" sentence; this field is kept for symmetry
        /// and future extensibility.
        #[allow(dead_code)]
        reason: String,
    },
    /// Phase 5: the parent task was just created and matched one of the
    /// preflight heuristics. The reason carried here is surfaced
    /// verbatim in the emitted `task_preflight_decomposed` event and in
    /// the child prompts.
    Preflight { reason: String },
}

impl DecompositionContext {
    /// Lead-in sentence for both child-task descriptions. Kept in one
    /// place so the Phase 3 tests assert the exact wording and Phase 5
    /// can vary it without drift.
    fn header(&self) -> String {
        match self {
            DecompositionContext::PostFailure { .. } => {
                "AUTO-DECOMPOSED from a truncated run.".to_string()
            }
            DecompositionContext::Preflight { reason } => {
                format!("AUTO-DECOMPOSED before execution due to {reason}.")
            }
        }
    }
}

/// Scan `title` + `description` for signals that the task is likely to
/// produce an oversized single-turn write, and return a
/// [`DecompositionSignal`] describing how to split it.
///
/// Heuristics (case-insensitive, first-match wins):
///
/// 1. Any of a small set of "generate a complete …" / "full
///    implementation" phrases in the combined text.
/// 2. A description longer than 4 000 chars that also contains
///    `write_file` or a backticked file path.
/// 3. A description with a fenced code block (` ``` `) that also
///    mentions an explicit size ≥ 400 lines ("500+ lines", "300 lines",
///    "~1000 lines", or a "1000 tokens" count interpreted as a line
///    budget).
///
/// Returns `None` when the task looks fine as-is. Intentionally
/// conservative — false negatives fall through to the existing Phase 3
/// post-failure safety net.
pub(crate) fn detect_preflight_decomposition(
    title: &str,
    description: &str,
) -> Option<DecompositionSignal> {
    let haystack = format!("{title}\n{description}");
    let lower = haystack.to_ascii_lowercase();

    const PHRASES: &[&str] = &[
        "generate a complete",
        "generate the full",
        "full implementation",
        "implement the entire",
        "write the complete",
        "all functions for",
        "complete module",
        "comprehensive test suite",
        "all tests for",
        "full file",
    ];
    for phrase in PHRASES {
        if lower.contains(phrase) {
            return Some(DecompositionSignal {
                target_path: extract_target_path(description),
                estimated_chunk_bytes: DEFAULT_PREFLIGHT_CHUNK_BYTES,
                reason: format!("phrase:{phrase}"),
            });
        }
    }

    if description.chars().count() > 4_000
        && (lower.contains("write_file") || contains_backticked_path(description))
    {
        return Some(DecompositionSignal {
            target_path: extract_target_path(description),
            estimated_chunk_bytes: DEFAULT_PREFLIGHT_CHUNK_BYTES,
            reason: "long_spec_with_write_hint".to_string(),
        });
    }

    if description.contains("```") {
        if let Some(lines) = parse_explicit_line_count(&lower) {
            if lines >= 400 {
                return Some(DecompositionSignal {
                    target_path: extract_target_path(description),
                    estimated_chunk_bytes: DEFAULT_PREFLIGHT_CHUNK_BYTES,
                    reason: format!("explicit_size:{lines}_lines"),
                });
            }
        }
    }

    None
}

/// Test-only wrapper around [`detect_preflight_decomposition`] that
/// collapses the private [`DecompositionSignal`] into its public
/// facets (reason label + extracted target path) so Phase 7
/// integration tests can assert on both without the signal type
/// leaking out of the crate.
///
/// Returns `None` when the inputs don't trigger the preflight
/// heuristic.
pub(crate) fn preflight_decomposition_reason_for_tests(
    title: &str,
    description: &str,
) -> Option<(String, Option<String>)> {
    let sig = detect_preflight_decomposition(title, description)?;
    Some((sig.reason, sig.target_path))
}

/// Known code-file extensions the path extractor looks for. Kept
/// narrow on purpose — extension noise (`.lock`, `.toml`, `.txt`, …)
/// mostly yields paths that the agent shouldn't be regenerating as a
/// "skeleton", so surfacing them would be worse than surfacing nothing.
const CODE_EXTENSIONS: &[&str] = &[".rs", ".ts", ".tsx", ".js", ".py", ".go", ".java", ".md"];

/// Return the first backticked token in `description` that looks like a
/// path with one of the known code extensions, or a bare unquoted path
/// with such an extension, or `None`.
fn extract_target_path(description: &str) -> Option<String> {
    if let Some(path) = first_backticked_code_path(description) {
        return Some(path);
    }
    first_bare_code_path(description)
}

/// True if the description contains any ``backticked`` span with a
/// known code extension. Used for the long-spec heuristic's tie-breaker
/// — if we have a backticked path the task almost certainly targets a
/// file even when it doesn't literally say `write_file`.
fn contains_backticked_path(description: &str) -> bool {
    first_backticked_code_path(description).is_some()
}

/// Extract the first backticked substring that ends with one of
/// [`CODE_EXTENSIONS`]. The matcher is deliberately small: walk the
/// string, remember each `` ` `` position, and at each closing backtick
/// check whether the span is a path.
fn first_backticked_code_path(description: &str) -> Option<String> {
    let bytes = description.as_bytes();
    let mut start: Option<usize> = None;
    for (idx, &b) in bytes.iter().enumerate() {
        if b == b'`' {
            match start {
                None => start = Some(idx + 1),
                Some(s) => {
                    let span = &description[s..idx];
                    if is_code_path(span) {
                        return Some(span.to_string());
                    }
                    start = None;
                }
            }
        }
    }
    None
}

/// Scan `description` for an unquoted token ending in a code extension.
/// Splits on ASCII whitespace and common punctuation so commas / full
/// stops don't leak into the returned path. Returns the first match.
fn first_bare_code_path(description: &str) -> Option<String> {
    for raw in description.split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')'))
    {
        let trimmed = raw.trim_matches(|c: char| matches!(c, '.' | ':' | '"' | '\'' | '`'));
        if trimmed.len() < 3 {
            continue;
        }
        if is_code_path(trimmed) && trimmed.contains('/') {
            return Some(trimmed.to_string());
        }
    }
    None
}

/// Match rules: ends in a known code extension, contains no whitespace,
/// and is short enough to plausibly be a path (arbitrarily capped at
/// 200 bytes).
fn is_code_path(span: &str) -> bool {
    if span.is_empty() || span.len() > 200 || span.chars().any(char::is_whitespace) {
        return false;
    }
    let lower = span.to_ascii_lowercase();
    CODE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

/// Look for an explicit size annotation in an already-lowercased
/// haystack. Accepts patterns like `"500+ lines"`, `"300 lines"`,
/// `"~1000 lines"`, or `"1000 tokens"`. Returns the matched number.
///
/// Implementation is a simple manual scan rather than a regex to keep
/// the dependency footprint unchanged.
fn parse_explicit_line_count(lower: &str) -> Option<usize> {
    const KEYWORDS: &[&str] = &["lines", "line", "tokens", "token"];
    for kw in KEYWORDS {
        let mut search_from = 0;
        while let Some(rel) = lower[search_from..].find(kw) {
            let pos = search_from + rel;
            // Step back through whitespace + '+' + '~' to find the
            // preceding number.
            let mut cursor = pos;
            while cursor > 0
                && matches!(
                    lower.as_bytes()[cursor - 1],
                    b' ' | b'\t' | b'\n' | b'+' | b'~'
                )
            {
                cursor -= 1;
            }
            let end = cursor;
            while cursor > 0 && lower.as_bytes()[cursor - 1].is_ascii_digit() {
                cursor -= 1;
            }
            if cursor < end {
                if let Ok(n) = lower[cursor..end].parse::<usize>() {
                    return Some(n);
                }
            }
            search_from = pos + kw.len();
        }
    }
    None
}

/// Create the shared skeleton + fill follow-up pair for either the
/// Phase 3 post-failure path or the Phase 5 preflight path.
///
/// Skeleton depends on nothing, fill depends on skeleton — so the
/// existing scheduler orders them correctly with no extra wiring. The
/// prompt header line rotates based on `context` (see
/// [`DecompositionContext::header`]).
///
/// `path` is optional because the Phase 5 preflight detector can match
/// before a concrete file path is mentioned in the description. When
/// `None`, the skeleton prompt asks the agent to pick a path itself
/// instead of naming one.
pub(crate) async fn spawn_skeleton_and_fill_children(
    task_service: &TaskService,
    parent: &Task,
    path: Option<&str>,
    chunk_bytes: usize,
    context: DecompositionContext,
) -> Result<Vec<TaskId>, TaskError> {
    let header = context.header();
    let original_title = parent.title.clone();
    let original_description = parent.description.clone();

    let path_clause = match path {
        Some(p) => format!("in `{p}`"),
        None => "in ONE file of your choosing (pick a clear path)".to_string(),
    };
    let skeleton_title = format!("{original_title} [skeleton]");
    let skeleton_description = format!(
        "{header}\n\n\
         Create ONLY a module doc + imports + one public stub {path_clause}.\n\
         Call `write_file` exactly once, then `task_done`.\n\n\
         Original task description:\n\
         {original_description}"
    );
    let skeleton = task_service
        .create_follow_up_task(parent, skeleton_title, skeleton_description, Vec::new())
        .await?;

    let fill_title = format!("{original_title} [fill]");
    let fill_path_clause = match path {
        Some(p) => format!("The file `{p}` already exists as a skeleton."),
        None => "The skeleton file was created by the previous task.".to_string(),
    };
    let fill_description = format!(
        "{header} Depends on the skeleton task above.\n\n\
         {fill_path_clause} Use `edit_file` exclusively to add the\n\
         remaining logic in chunks of <= {chunk_bytes} bytes per call,\n\
         and aim for <= 3 edits total.\n\n\
         Original task description:\n\
         {original_description}"
    );
    let fill = task_service
        .create_follow_up_task(parent, fill_title, fill_description, vec![skeleton.task_id])
        .await?;

    Ok(vec![skeleton.task_id, fill.task_id])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_matches_full_implementation_phrase() {
        let sig = detect_preflight_decomposition(
            "Build module",
            "Please provide a full implementation of the NeuralKey type in `crates/core/src/key.rs`.",
        )
        .expect("expected a match for 'full implementation'");
        assert_eq!(sig.reason, "phrase:full implementation");
        assert_eq!(sig.estimated_chunk_bytes, DEFAULT_PREFLIGHT_CHUNK_BYTES);
        assert_eq!(
            sig.target_path.as_deref(),
            Some("crates/core/src/key.rs"),
            "should pull the backticked path out of the description"
        );
    }

    #[test]
    fn detect_matches_long_spec_with_write_hint() {
        // Build a long description that does NOT include any of the
        // phrase-list triggers, so the long-spec branch is what fires.
        let body =
            "Details: ".to_string() + &"we need to handle various edge cases here. ".repeat(120);
        let description = format!(
            "{body}\nYou MUST call write_file once for `apps/server/src/main.rs` with the whole thing."
        );
        assert!(
            description.chars().count() > 4_000,
            "test fixture must exceed the 4k char threshold"
        );
        let sig = detect_preflight_decomposition("Task", &description)
            .expect("expected a match on the long-spec path");
        assert_eq!(sig.reason, "long_spec_with_write_hint");
        assert_eq!(sig.target_path.as_deref(), Some("apps/server/src/main.rs"));
    }

    #[test]
    fn detect_matches_explicit_line_count() {
        let description = "Write the module body. Here is the target shape:\n\
             ```rust\n\
             pub struct Foo;\n\
             ```\n\
             Target roughly 500+ lines total across the file.";
        let sig = detect_preflight_decomposition("Task", description)
            .expect("expected a match on the explicit-size path");
        assert_eq!(sig.reason, "explicit_size:500_lines");
    }

    #[test]
    fn detect_ignores_short_plain_spec() {
        assert!(detect_preflight_decomposition(
            "Fix typo in README",
            "Correct the spelling of 'recieve' to 'receive' in the top paragraph."
        )
        .is_none());
    }

    #[test]
    fn detect_extracts_backticked_rust_path() {
        let sig = detect_preflight_decomposition(
            "Add helpers",
            "Please generate a complete set of helpers in `crates/utils/src/time.rs` \
             following the existing conventions.",
        )
        .expect("phrase 'generate a complete' should match");
        assert_eq!(sig.target_path.as_deref(), Some("crates/utils/src/time.rs"));
    }

    #[test]
    fn detect_ignores_small_explicit_size() {
        let description = "Add a tiny helper:\n```rust\nfn f() {}\n```\nAbout 20 lines.";
        assert!(
            detect_preflight_decomposition("x", description).is_none(),
            "20 lines is well under the 400-line threshold"
        );
    }

    #[test]
    fn detect_phrase_is_case_insensitive() {
        let sig = detect_preflight_decomposition(
            "TASK",
            "Please WRITE THE COMPLETE module for us in `src/lib.rs`.",
        )
        .expect("case-insensitive phrase match");
        assert_eq!(sig.reason, "phrase:write the complete");
    }

    #[test]
    fn header_differs_between_contexts() {
        let post = DecompositionContext::PostFailure {
            reason: "n/a".into(),
        };
        let pre = DecompositionContext::Preflight {
            reason: "phrase:full implementation".into(),
        };
        assert!(post.header().contains("from a truncated run"));
        assert!(pre.header().contains("before execution"));
        assert!(pre.header().contains("full implementation"));
    }
}
