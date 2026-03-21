use super::*;

// -----------------------------------------------------------------------
// auto_correct_build_command
// -----------------------------------------------------------------------

#[test]
fn auto_correct_cargo_run() {
    assert_eq!(
        auto_correct_build_command("cargo run"),
        Some("cargo build".into())
    );
}

#[test]
fn auto_correct_cargo_run_with_args() {
    assert_eq!(
        auto_correct_build_command("cargo run --release"),
        Some("cargo build --release".into())
    );
}

#[test]
fn auto_correct_cargo_run_strips_binary_args() {
    assert_eq!(
        auto_correct_build_command("cargo run -p spectra-app -- --help"),
        Some("cargo build -p spectra-app".into())
    );
    assert_eq!(
        auto_correct_build_command("cargo run -- --port 8080"),
        Some("cargo build".into())
    );
}

#[test]
fn auto_correct_cargo_run_trailing_double_dash() {
    assert_eq!(
        auto_correct_build_command("cargo run --"),
        Some("cargo build".into())
    );
}

#[test]
fn auto_correct_npm_start() {
    assert_eq!(
        auto_correct_build_command("npm start"),
        Some("npm run build".into())
    );
}

#[test]
fn auto_correct_django_runserver() {
    assert_eq!(
        auto_correct_build_command("python manage.py runserver"),
        Some("python manage.py check".into())
    );
}

#[test]
fn auto_correct_returns_none_for_normal_build() {
    assert_eq!(auto_correct_build_command("cargo build"), None);
    assert_eq!(auto_correct_build_command("npm run build"), None);
    assert_eq!(auto_correct_build_command("make"), None);
}

// -----------------------------------------------------------------------
// infer_default_build_command
// -----------------------------------------------------------------------

#[test]
fn infer_default_build_command_rust_workspace() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("Cargo.toml"), "[workspace]").unwrap();
    assert_eq!(
        infer_default_build_command(dir.path()),
        Some("cargo check --workspace --tests".into())
    );
}

#[test]
fn infer_default_build_command_node_project() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("package.json"), "{}").unwrap();
    assert_eq!(
        infer_default_build_command(dir.path()),
        Some("npm run build --if-present".into())
    );
}

#[test]
fn infer_default_build_command_none_when_unknown() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(infer_default_build_command(dir.path()), None);
}

// -----------------------------------------------------------------------
// normalize_error_signature
// -----------------------------------------------------------------------

#[test]
fn normalize_strips_line_numbers() {
    let stderr = "error[E0308]: mismatched types\n  --> src/main.rs:52:32\n";
    let sig = normalize_error_signature(stderr);
    assert!(sig.contains("error[E0308]: mismatched types"));
    assert!(sig.contains("-->LOCATION"));
    assert!(!sig.contains(":52:32"));
}

#[test]
fn normalize_deduplicates_same_errors() {
    let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0308]: mismatched types
  --> src/main.rs:20:5
";
    let sig = normalize_error_signature(stderr);
    let lines: Vec<&str> = sig.lines().collect();
    let error_count = lines.iter().filter(|l| l.contains("E0308")).count();
    assert_eq!(error_count, 1, "duplicate errors should be deduped");
}

#[test]
fn normalize_skips_help_lines() {
    let stderr = "\
error: cannot find value `x`
help: consider importing this
For more information about this error, try `rustc --explain E0425`
";
    let sig = normalize_error_signature(stderr);
    assert!(!sig.contains("help:"));
    assert!(!sig.contains("For more information"));
}

// -----------------------------------------------------------------------
// classify_build_errors
// -----------------------------------------------------------------------

#[test]
fn classify_rust_string_literal() {
    let errors = classify_build_errors("error: unknown start of token \\u{201c}");
    assert!(errors.contains(&ErrorCategory::RustStringLiteral));
}

#[test]
fn classify_rust_missing_module() {
    let errors = classify_build_errors("error[E0583]: file not found for module `foo`");
    assert!(errors.contains(&ErrorCategory::RustMissingModule));
}

#[test]
fn classify_rust_borrow_check() {
    let errors = classify_build_errors("error[E0502]: cannot borrow `x` as mutable");
    assert!(errors.contains(&ErrorCategory::RustBorrowCheck));
}

#[test]
fn classify_npm_dependency() {
    let errors = classify_build_errors("Error: Cannot find module 'express'");
    assert!(errors.contains(&ErrorCategory::NpmDependency));
}

#[test]
fn classify_npm_typescript() {
    let errors = classify_build_errors("error TS2304: Cannot find name 'foo'");
    assert!(errors.contains(&ErrorCategory::NpmTypeScript));
}

#[test]
fn classify_generic_syntax() {
    let errors = classify_build_errors("syntax error near unexpected token");
    assert!(errors.contains(&ErrorCategory::GenericSyntax));
}

#[test]
fn classify_unknown_fallback() {
    let errors = classify_build_errors("something completely unknown happened");
    assert!(errors.contains(&ErrorCategory::Unknown));
}

#[test]
fn classify_multiple_categories() {
    let stderr = "error[E0599]: no method named `foo`\nerror[E0502]: cannot borrow `x`";
    let errors = classify_build_errors(stderr);
    assert!(errors.contains(&ErrorCategory::RustMissingMethod));
    assert!(errors.contains(&ErrorCategory::RustBorrowCheck));
}

// -----------------------------------------------------------------------
// normalize_error_signature – stagnation detection
// -----------------------------------------------------------------------

#[test]
fn normalize_same_error_different_lines_produces_same_sig() {
    let stderr_v1 = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
   |
10 |     let x: i32 = \"hello\";
   |                  ^^^^^^^ expected `i32`, found `&str`
";
    let stderr_v2 = "\
error[E0308]: mismatched types
  --> src/main.rs:42:5
   |
42 |     let x: i32 = \"hello\";
   |                  ^^^^^^^ expected `i32`, found `&str`
";
    assert_eq!(
        normalize_error_signature(stderr_v1),
        normalize_error_signature(stderr_v2),
    );
}

#[test]
fn normalize_different_errors_produce_different_sigs() {
    let sig_a = normalize_error_signature("error[E0308]: mismatched types\n");
    let sig_b = normalize_error_signature("error[E0599]: no method named `foo`\n");
    assert_ne!(sig_a, sig_b);
}

#[test]
fn stagnation_detected_after_three_consecutive_identical_sigs() {
    let sig = normalize_error_signature("error[E0308]: mismatched types\n  --> src/lib.rs:1:1\n");
    let prior = vec![
        BuildFixAttemptRecord { stderr: String::new(), error_signature: sig.clone(), files_changed: vec![] },
        BuildFixAttemptRecord { stderr: String::new(), error_signature: sig.clone(), files_changed: vec![] },
    ];
    let consecutive = prior.iter().rev().take_while(|a| a.error_signature == sig).count();
    assert!(consecutive >= 2, "should detect stagnation (3 total: 2 prior + current)");
}

#[test]
fn stagnation_not_triggered_with_interleaved_different_error() {
    let sig_a = normalize_error_signature("error[E0308]: mismatched types\n");
    let sig_b = normalize_error_signature("error[E0599]: no method named `foo`\n");
    let prior = vec![
        BuildFixAttemptRecord { stderr: String::new(), error_signature: sig_a.clone(), files_changed: vec![] },
        BuildFixAttemptRecord { stderr: String::new(), error_signature: sig_b.clone(), files_changed: vec![] },
    ];
    let consecutive = prior.iter().rev().take_while(|a| a.error_signature == sig_a).count();
    assert_eq!(consecutive, 0, "different last error breaks the streak");
}

// -----------------------------------------------------------------------
// parse_error_references
// -----------------------------------------------------------------------

#[test]
fn parse_refs_extracts_type_names() {
    let stderr = "error[E0599]: no method named `foo` found for struct `MyStruct`";
    let refs = parse_error_references(stderr);
    assert!(refs.types_referenced.contains(&"MyStruct".to_string()));
}

#[test]
fn parse_refs_extracts_missing_fields() {
    let stderr = "error[E0063]: missing field `name` in initializer of `aura_core::Task`";
    let refs = parse_error_references(stderr);
    assert!(refs.missing_fields.iter().any(|(t, f)| t == "Task" && f == "name"));
}

#[test]
fn parse_refs_extracts_methods_not_found() {
    let stderr = "error[E0599]: no method named `do_thing` found for struct `MyService`";
    let refs = parse_error_references(stderr);
    assert!(refs.methods_not_found.iter().any(|(t, m)| t == "MyService" && m == "do_thing"));
}

#[test]
fn parse_refs_extracts_source_locations() {
    let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:42:5
error[E0308]: mismatched types
  --> src/lib.rs:10:12
";
    let refs = parse_error_references(stderr);
    assert!(refs.source_locations.contains(&("src/main.rs".into(), 42)));
    assert!(refs.source_locations.contains(&("src/lib.rs".into(), 10)));
}

#[test]
fn parse_refs_extracts_wrong_arg_counts() {
    let stderr = "error[E0061]: this function takes 2 arguments but 3 arguments were supplied";
    let refs = parse_error_references(stderr);
    assert!(!refs.wrong_arg_counts.is_empty());
    assert!(refs.wrong_arg_counts[0].contains("expected 2"));
}

#[test]
fn parse_refs_empty_stderr() {
    let refs = parse_error_references("");
    assert!(refs.types_referenced.is_empty());
    assert!(refs.missing_fields.is_empty());
    assert!(refs.methods_not_found.is_empty());
    assert!(refs.source_locations.is_empty());
    assert!(refs.wrong_arg_counts.is_empty());
}

// -----------------------------------------------------------------------
// parse_individual_error_signatures
// -----------------------------------------------------------------------

#[test]
fn parse_individual_splits_multi_error_stderr() {
    let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
   |
10 |     let x: i32 = \"hello\";
   |                  ^^^^^^^ expected `i32`, found `&str`

error[E0599]: no method named `foo` found for struct `Bar`
  --> src/lib.rs:42:9
";
    let sigs = parse_individual_error_signatures(stderr);
    assert_eq!(sigs.len(), 2, "should split into two distinct error signatures");
}

#[test]
fn parse_individual_deduplicates_identical_errors() {
    let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0308]: mismatched types
  --> src/main.rs:20:5
";
    let sigs = parse_individual_error_signatures(stderr);
    assert_eq!(sigs.len(), 1, "identical errors on different lines should dedup to one");
}

#[test]
fn parse_individual_empty_stderr() {
    let sigs = parse_individual_error_signatures("");
    assert!(sigs.is_empty());
}

#[test]
fn parse_individual_no_error_prefix() {
    let sigs = parse_individual_error_signatures("warning: unused variable\n");
    assert!(sigs.is_empty() || sigs.iter().all(|s| s.is_empty()),
        "non-error output should produce no meaningful signatures");
}

// -----------------------------------------------------------------------
// build baseline filtering logic
// -----------------------------------------------------------------------

#[test]
fn baseline_filters_all_preexisting_errors() {
    let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0599]: no method named `foo` found for struct `Bar`
  --> src/lib.rs:42:9
";
    let baseline = parse_individual_error_signatures(stderr);
    let current = parse_individual_error_signatures(stderr);
    let new_errors: std::collections::HashSet<_> = current.difference(&baseline).cloned().collect();
    assert!(new_errors.is_empty(), "all errors are pre-existing, none should be new");
}

#[test]
fn baseline_detects_new_errors_mixed_with_preexisting() {
    let baseline_stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
";
    let current_stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0599]: no method named `foo` found for struct `Bar`
  --> src/lib.rs:42:9
";
    let baseline = parse_individual_error_signatures(baseline_stderr);
    let current = parse_individual_error_signatures(current_stderr);
    let new_errors: std::collections::HashSet<_> = current.difference(&baseline).cloned().collect();
    assert_eq!(new_errors.len(), 1, "should detect exactly one new error");
}

#[test]
fn empty_baseline_means_no_filtering() {
    let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
";
    let baseline: std::collections::HashSet<String> = std::collections::HashSet::new();
    let current = parse_individual_error_signatures(stderr);
    let new_errors: std::collections::HashSet<_> = current.difference(&baseline).cloned().collect();
    assert_eq!(new_errors.len(), current.len(), "with empty baseline, all errors are new");
}
