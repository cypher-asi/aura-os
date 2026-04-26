//! Preflight detector for the canonical "generate the full implementation of …"
//! description.

#[test]
fn preflight_decomposition_flags_full_implementation_description() {
    let hit = aura_os_server::phase7_test_support::preflight_decomposition_reason(
        "Implement NeuralKey",
        "Please generate the full implementation of `crates/foo/src/bar.rs`, \
         covering every public function and every error path.",
    )
    .expect("canonical 'generate the full implementation of …' should match");
    let (reason, target) = hit;
    assert!(
        reason.starts_with("phrase:"),
        "expected a phrase-match reason label, got {reason:?}",
    );
    assert_eq!(
        target.as_deref(),
        Some("crates/foo/src/bar.rs"),
        "preflight detector should lift the backticked target path",
    );
}
