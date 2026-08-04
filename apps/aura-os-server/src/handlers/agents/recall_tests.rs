use super::*;

#[test]
fn lexical_matching_requires_every_query_term() {
    let event = SessionEvent {
        event_id: aura_os_core::SessionEventId::new(),
        agent_instance_id: aura_os_core::AgentInstanceId::new(),
        project_id: aura_os_core::ProjectId::new(),
        role: ChatRole::User,
        content: "We changed the authentication refresh logic.".into(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: chrono::Utc::now(),
        in_flight: None,
        from_agent_id: None,
    };
    assert!(score_event(&event, &["authentication".into(), "refresh".into()]).is_some());
    assert!(score_event(&event, &["authentication".into(), "missing".into()]).is_none());
}

#[test]
fn credential_assignments_are_excluded_before_snippet_generation() {
    assert!(looks_sensitive(&format!(
        "api_key = {}",
        stripe_secret_fixture()
    )));
    assert!(looks_sensitive(
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"
    ));
    assert!(!looks_sensitive(
        "We should rotate the token management policy."
    ));
}

#[test]
fn common_unlabelled_credential_signatures_are_excluded() {
    for secret in [
        ["sk-", "live-", "abcdefghijklmnopqrstuvwxyz"].concat(),
        stripe_secret_fixture(),
        ["ghp_", "abcdefghijklmnopqrstuvwxyz123456"].concat(),
        ["github_", "pat_", "abcdefghijklmnopqrstuvwxyz123456"].concat(),
        ["AKIA", "ABCDEFGHIJKLMNOP"].concat(),
        ["-----BEGIN ", "PRIVATE KEY-----"].concat(),
    ] {
        assert!(
            looks_sensitive(&secret),
            "must exclude credential-like token"
        );
    }
}

#[test]
fn sensitivity_scan_uses_the_same_bounded_window_as_search() {
    let outside_search_window = format!(
        "{} api_key={}",
        "x".repeat(MAX_SEARCHABLE_CONTENT_CHARS),
        stripe_secret_fixture()
    );
    assert!(!looks_sensitive(&outside_search_window));
    assert!(looks_sensitive(&format!(
        "api_key={} before the bound",
        stripe_secret_fixture()
    )));
    assert!(!looks_sensitive(&format!(
        "api_key{}={}",
        " ".repeat(MAX_SEARCHABLE_CONTENT_CHARS * 2),
        stripe_secret_fixture(),
    )));
}

fn stripe_secret_fixture() -> String {
    ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz"].concat()
}

#[test]
fn query_validation_bounds_input() {
    assert!(normalize_query(" ").is_err());
    assert!(normalize_query("a").is_err());
    assert_eq!(
        normalize_query("Auth auth refresh").unwrap(),
        vec!["auth", "refresh"]
    );
}

#[test]
fn snippets_are_unicode_safe_and_bounded() {
    let content = "é".repeat(MAX_SNIPPET_CHARS + 20);
    let snippet = bounded_snippet(&content, 0);
    assert!(snippet.ends_with('…'));
    assert!(snippet.chars().count() <= MAX_SNIPPET_CHARS);
}

#[test]
fn snippets_center_a_late_match_without_breaking_multibyte_text() {
    let event = SessionEvent {
        event_id: aura_os_core::SessionEventId::new(),
        agent_instance_id: aura_os_core::AgentInstanceId::new(),
        project_id: aura_os_core::ProjectId::new(),
        role: ChatRole::Assistant,
        content: format!(
            "{} late-evidence-marker final context",
            "🪐 café ".repeat(900)
        ),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: chrono::Utc::now(),
        in_flight: None,
        from_agent_id: None,
    };

    let matched = score_event(&event, &["late-evidence-marker".into()])
        .expect("the late query should match within the bounded content");
    assert!(matched.snippet.contains("late-evidence-marker"));
    assert!(matched.snippet.starts_with('…'));
    assert!(matched.snippet.chars().count() <= MAX_SNIPPET_CHARS);
}

#[test]
fn a_total_candidate_read_outage_is_not_an_empty_success() {
    assert!(all_candidate_reads_failed(3, 0));
    assert!(!all_candidate_reads_failed(3, 1));
    assert!(!all_candidate_reads_failed(0, 0));

    let counts = candidate_search_counts(3, &[]);
    assert_eq!(counts.searched, 0);
    assert_eq!(counts.skipped, 3);
    assert!(all_candidate_reads_failed(3, counts.searched));
}

#[tokio::test]
async fn per_session_deadline_times_out_a_hung_read() {
    let result = await_with_timeout(Duration::from_millis(5), std::future::pending::<()>()).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn overall_deadline_preserves_partial_results_and_counts_unprocessed_candidates() {
    let outcomes = stream::iter([
        CandidateSearchOutcome::Searched(None),
        CandidateSearchOutcome::Skipped,
    ])
    .chain(stream::pending::<CandidateSearchOutcome>());
    let completed =
        collect_candidate_outcomes_until(outcomes, Instant::now() + Duration::from_millis(5)).await;
    let counts = candidate_search_counts(3, &completed);

    assert_eq!(completed.len(), 2);
    assert_eq!(counts.searched, 1);
    assert_eq!(counts.skipped, 2);
    assert!(!all_candidate_reads_failed(3, counts.searched));
}
