mod fixtures;

use aura_engine::file_ops::Replacement;
use aura_engine::*;

use fixtures::make_temp_base;

// ---------------------------------------------------------------------------
// Path validation tests
// ---------------------------------------------------------------------------

#[test]
fn path_validation_accepts_valid_path() {
    let (_dir, base) = make_temp_base();
    std::fs::write(base.join("test.txt"), "hello").unwrap();

    let result = aura_engine::file_ops::validate_path(&base, &base.join("test.txt"));
    assert!(result.is_ok());
}

#[test]
fn path_validation_rejects_escape() {
    let (_dir, base) = make_temp_base();

    let escape_path = base.join("..").join("..").join("etc").join("passwd");
    let result = aura_engine::file_ops::validate_path(&base, &escape_path);
    assert!(result.is_err());
    match result.unwrap_err() {
        EngineError::PathEscape(_) => {}
        other => panic!("Expected PathEscape, got: {other:?}"),
    }
}

#[test]
fn path_validation_accepts_new_file_in_existing_dir() {
    let (_dir, base) = make_temp_base();

    let result = aura_engine::file_ops::validate_path(&base, &base.join("new_file.rs"));
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// File operations tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn apply_file_ops_creates_file() {
    let (_dir, base) = make_temp_base();

    let ops = vec![FileOp::Create {
        path: "hello.txt".into(),
        content: "Hello, world!".into(),
    }];

    file_ops::apply_file_ops(&base, &ops).await.unwrap();
    let content = std::fs::read_to_string(base.join("hello.txt")).unwrap();
    assert_eq!(content, "Hello, world!");
}

#[tokio::test]
async fn apply_file_ops_creates_nested_dirs() {
    let (_dir, base) = make_temp_base();

    let ops = vec![FileOp::Create {
        path: "src/nested/file.rs".into(),
        content: "fn nested() {}".into(),
    }];

    file_ops::apply_file_ops(&base, &ops).await.unwrap();
    assert!(base.join("src/nested/file.rs").exists());
}

#[tokio::test]
async fn apply_file_ops_modifies_file() {
    let (_dir, base) = make_temp_base();
    std::fs::write(base.join("existing.txt"), "old content").unwrap();

    let ops = vec![FileOp::Modify {
        path: "existing.txt".into(),
        content: "new content".into(),
    }];

    file_ops::apply_file_ops(&base, &ops).await.unwrap();
    let content = std::fs::read_to_string(base.join("existing.txt")).unwrap();
    assert_eq!(content, "new content");
}

#[tokio::test]
async fn apply_file_ops_deletes_file() {
    let (_dir, base) = make_temp_base();
    std::fs::write(base.join("doomed.txt"), "bye").unwrap();

    let ops = vec![FileOp::Delete {
        path: "doomed.txt".into(),
    }];

    file_ops::apply_file_ops(&base, &ops).await.unwrap();
    assert!(!base.join("doomed.txt").exists());
}

#[tokio::test]
async fn apply_file_ops_delete_nonexistent_is_ok() {
    let (_dir, base) = make_temp_base();

    let ops = vec![FileOp::Delete {
        path: "nonexistent.txt".into(),
    }];

    file_ops::apply_file_ops(&base, &ops).await.unwrap();
}

// ---------------------------------------------------------------------------
// SearchReplace file operations tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn apply_search_replace_single_replacement() {
    let (_dir, base) = make_temp_base();
    std::fs::write(base.join("lib.rs"), "fn old_name() {\n    42\n}\n").unwrap();

    let ops = vec![FileOp::SearchReplace {
        path: "lib.rs".into(),
        replacements: vec![Replacement {
            search: "fn old_name()".into(),
            replace: "fn new_name()".into(),
        }],
    }];

    file_ops::apply_file_ops(&base, &ops).await.unwrap();
    let content = std::fs::read_to_string(base.join("lib.rs")).unwrap();
    assert!(content.contains("fn new_name()"));
    assert!(!content.contains("fn old_name()"));
    assert!(content.contains("42"), "untouched code should be preserved");
}

#[tokio::test]
async fn apply_search_replace_multiple_replacements() {
    let (_dir, base) = make_temp_base();
    std::fs::write(
        base.join("main.rs"),
        "fn alpha() { 1 }\nfn beta() { 2 }\nfn gamma() { 3 }\n",
    )
    .unwrap();

    let ops = vec![FileOp::SearchReplace {
        path: "main.rs".into(),
        replacements: vec![
            Replacement {
                search: "fn alpha() { 1 }".into(),
                replace: "fn alpha() { 10 }".into(),
            },
            Replacement {
                search: "fn gamma() { 3 }".into(),
                replace: "fn gamma() { 30 }".into(),
            },
        ],
    }];

    file_ops::apply_file_ops(&base, &ops).await.unwrap();
    let content = std::fs::read_to_string(base.join("main.rs")).unwrap();
    assert!(content.contains("fn alpha() { 10 }"));
    assert!(
        content.contains("fn beta() { 2 }"),
        "beta should be untouched"
    );
    assert!(content.contains("fn gamma() { 30 }"));
}

#[tokio::test]
async fn apply_search_replace_fails_when_not_found() {
    let (_dir, base) = make_temp_base();
    std::fs::write(base.join("lib.rs"), "fn existing() {}\n").unwrap();

    let ops = vec![FileOp::SearchReplace {
        path: "lib.rs".into(),
        replacements: vec![Replacement {
            search: "fn nonexistent()".into(),
            replace: "fn replaced()".into(),
        }],
    }];

    let err = file_ops::apply_file_ops(&base, &ops).await.unwrap_err();
    match err {
        EngineError::Parse(msg) => {
            assert!(
                msg.contains("not found"),
                "error should mention not found: {msg}"
            );
        }
        other => panic!("Expected Parse error, got: {other:?}"),
    }
}

#[tokio::test]
async fn apply_search_replace_fails_on_duplicate_match() {
    let (_dir, base) = make_temp_base();
    std::fs::write(base.join("lib.rs"), "fn foo() { 1 }\nfn foo() { 2 }\n").unwrap();

    let ops = vec![FileOp::SearchReplace {
        path: "lib.rs".into(),
        replacements: vec![Replacement {
            search: "fn foo()".into(),
            replace: "fn bar()".into(),
        }],
    }];

    let err = file_ops::apply_file_ops(&base, &ops).await.unwrap_err();
    match err {
        EngineError::Parse(msg) => {
            assert!(
                msg.contains("matched 2 times"),
                "error should mention duplicate: {msg}"
            );
        }
        other => panic!("Expected Parse error, got: {other:?}"),
    }
}

#[tokio::test]
async fn apply_search_replace_file_not_found() {
    let (_dir, base) = make_temp_base();

    let ops = vec![FileOp::SearchReplace {
        path: "missing.rs".into(),
        replacements: vec![Replacement {
            search: "x".into(),
            replace: "y".into(),
        }],
    }];

    let err = file_ops::apply_file_ops(&base, &ops).await.unwrap_err();
    match err {
        EngineError::Io(msg) => {
            assert!(
                msg.contains("missing.rs"),
                "error should mention the file: {msg}"
            );
        }
        other => panic!("Expected Io error, got: {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Codebase reading tests
// ---------------------------------------------------------------------------

#[test]
fn read_relevant_files_collects_source_files() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path();
    std::fs::create_dir_all(base.join("src")).unwrap();
    std::fs::write(base.join("src/main.rs"), "fn main() {}").unwrap();
    std::fs::write(base.join("Cargo.toml"), "[package]\nname = \"test\"").unwrap();

    let result = file_ops::read_relevant_files(&base.to_string_lossy(), 100_000).unwrap();
    assert!(result.contains("main.rs"));
    assert!(result.contains("fn main()"));
    assert!(result.contains("Cargo.toml"));
}

#[test]
fn read_relevant_files_skips_git_dir() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path();
    std::fs::create_dir_all(base.join(".git/objects")).unwrap();
    std::fs::write(base.join(".git/objects/test.rs"), "secret").unwrap();
    std::fs::write(base.join("src.rs"), "pub fn x() {}").unwrap();

    let result = file_ops::read_relevant_files(&base.to_string_lossy(), 100_000).unwrap();
    assert!(!result.contains("secret"));
    assert!(result.contains("pub fn x()"));
}

#[test]
fn read_relevant_files_respects_size_cap() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path();

    let big_content = "x".repeat(60_000);
    std::fs::write(base.join("big.rs"), &big_content).unwrap();
    std::fs::write(base.join("small.rs"), "fn small() {}").unwrap();

    let result = file_ops::read_relevant_files(&base.to_string_lossy(), 1_000).unwrap();
    assert!(result.len() < 2_000);
}
