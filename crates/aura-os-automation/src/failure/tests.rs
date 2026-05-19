//! Unit tests for [`super::synthesize::synthesize_failure_reason`].

use super::synthesize::{synthesize_failure_reason, FailureContext, MAX_ERROR_EXCERPT_LEN};

fn empty_ctx() -> FailureContext {
    FailureContext::default()
}

#[test]
fn all_none_yields_stable_unknown_string() {
    assert_eq!(
        synthesize_failure_reason(&empty_ctx()),
        "task failed: unknown"
    );
}

#[test]
fn never_returns_empty_string_even_when_inputs_blank() {
    let ctx = FailureContext {
        real_reason: Some(String::new()),
        terminal_state: Some("   ".to_string()),
        last_tool_name: Some(String::new()),
        last_error_excerpt: Some("\n\n".to_string()),
    };
    let synthesized = synthesize_failure_reason(&ctx);
    assert!(
        !synthesized.is_empty(),
        "synthesizer must never return an empty string; got {synthesized:?}",
    );
    assert!(synthesized.starts_with("task failed: unknown"));
}

#[test]
fn real_reason_takes_precedence_over_other_fields() {
    let ctx = FailureContext {
        real_reason: Some("  upstream returned 503 Service Unavailable  ".to_string()),
        terminal_state: Some("crashed".to_string()),
        last_tool_name: Some("edit_file".to_string()),
        last_error_excerpt: Some("Connection reset".to_string()),
    };
    assert_eq!(
        synthesize_failure_reason(&ctx),
        "upstream returned 503 Service Unavailable",
    );
}

#[test]
fn empty_real_reason_falls_through_to_synthesis() {
    let ctx = FailureContext {
        real_reason: Some("   ".to_string()),
        terminal_state: Some("stalled".to_string()),
        ..empty_ctx()
    };
    assert_eq!(synthesize_failure_reason(&ctx), "task failed: stalled");
}

#[test]
fn terminal_state_appears_in_lead_clause() {
    let ctx = FailureContext {
        terminal_state: Some("crashed".to_string()),
        ..empty_ctx()
    };
    assert!(synthesize_failure_reason(&ctx).contains("task failed: crashed"));
}

#[test]
fn includes_last_tool_clause_when_present() {
    let ctx = FailureContext {
        terminal_state: Some("crashed".to_string()),
        last_tool_name: Some("run_command".to_string()),
        ..empty_ctx()
    };
    assert_eq!(
        synthesize_failure_reason(&ctx),
        "task failed: crashed; last tool run_command",
    );
}

#[test]
fn includes_error_excerpt_when_present() {
    let ctx = FailureContext {
        terminal_state: Some("crashed".to_string()),
        last_error_excerpt: Some("Connection reset by peer".to_string()),
        ..empty_ctx()
    };
    assert_eq!(
        synthesize_failure_reason(&ctx),
        "task failed: crashed; error: Connection reset by peer",
    );
}

#[test]
fn truncates_long_error_excerpts() {
    let long_excerpt = "x".repeat(MAX_ERROR_EXCERPT_LEN + 50);
    let ctx = FailureContext {
        terminal_state: Some("crashed".to_string()),
        last_error_excerpt: Some(long_excerpt.clone()),
        ..empty_ctx()
    };
    let synthesized = synthesize_failure_reason(&ctx);
    let excerpt_part = synthesized
        .split("error: ")
        .nth(1)
        .expect("synthesized string carries the error excerpt clause");
    assert_eq!(
        excerpt_part.chars().count(),
        MAX_ERROR_EXCERPT_LEN,
        "truncated excerpt must use exactly MAX_ERROR_EXCERPT_LEN chars",
    );
    assert!(
        excerpt_part.ends_with('…'),
        "truncated excerpt must end with the ellipsis marker; got {excerpt_part:?}",
    );
}

#[test]
fn combines_all_clauses_in_documented_order() {
    let ctx = FailureContext {
        real_reason: None,
        terminal_state: Some("stalled".to_string()),
        last_tool_name: Some("read_file".to_string()),
        last_error_excerpt: Some("ENOENT".to_string()),
    };
    assert_eq!(
        synthesize_failure_reason(&ctx),
        "task failed: stalled; last tool read_file; error: ENOENT",
    );
}

#[test]
fn handles_multibyte_excerpt_without_panicking() {
    // Truncation operates on char units, not bytes, so a long
    // multi-byte string must not split mid-codepoint.
    let long_multibyte = "é".repeat(MAX_ERROR_EXCERPT_LEN + 50);
    let ctx = FailureContext {
        terminal_state: Some("stalled".to_string()),
        last_error_excerpt: Some(long_multibyte),
        ..empty_ctx()
    };
    let synthesized = synthesize_failure_reason(&ctx);
    assert!(synthesized.contains("error: "));
    assert!(synthesized.ends_with('…'));
}
