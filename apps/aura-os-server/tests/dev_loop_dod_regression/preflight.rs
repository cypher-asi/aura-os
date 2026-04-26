//! Workspace preflight regressions.

use std::fs;

use aura_os_server::phase7_test_support as tsp;
use tempfile::TempDir;

#[test]
fn preflight_rejects_missing_workspace_path_without_repo_url() {
    let tmp = TempDir::new().expect("tempdir");
    let missing = tmp.path().join("does-not-exist");
    let err = tsp::preflight_local_workspace(missing.to_str().unwrap(), None)
        .expect_err("missing directory must be rejected");
    // The remediation hint should name the missing path so the UI can
    // tell the user what to create.
    assert!(
        err.contains(missing.file_name().unwrap().to_str().unwrap()),
        "preflight error should mention the offending path, got: {err}"
    );
}

#[test]
fn preflight_rejects_empty_workspace_without_repo_url() {
    let tmp = TempDir::new().expect("tempdir");
    let err = tsp::preflight_local_workspace(tmp.path().to_str().unwrap(), None)
        .expect_err("empty directory must be rejected when no repo URL is set");
    assert!(
        !err.is_empty(),
        "preflight must return a non-empty remediation hint"
    );
}

#[test]
fn preflight_tolerates_empty_workspace_when_repo_url_is_set() {
    let tmp = TempDir::new().expect("tempdir");
    // Simulate a freshly-provisioned project directory where the
    // automaton will clone `git_repo_url` on first run.
    tsp::preflight_local_workspace(
        tmp.path().to_str().unwrap(),
        Some("https://example.com/acme/zero.git"),
    )
    .expect("empty workspace with configured repo URL should bootstrap");
}

#[test]
fn preflight_rejects_empty_string_path_even_with_repo_url() {
    // Defence-in-depth: an empty configured path is always a bug,
    // regardless of whether a repo URL is set.
    let err = tsp::preflight_local_workspace("", Some("https://example.com/acme/zero.git"))
        .expect_err("empty project path must always be rejected");
    assert!(err.to_lowercase().contains("workspace"));
}

#[test]
fn preflight_accepts_initialised_git_workspace() {
    let tmp = TempDir::new().expect("tempdir");
    fs::create_dir(tmp.path().join(".git")).expect("mkdir .git");
    fs::write(tmp.path().join("README.md"), "# hello\n").expect("seed a file");
    tsp::preflight_local_workspace(tmp.path().to_str().unwrap(), None)
        .expect("a workspace with .git and content must pass preflight");
}
