use std::path::Path;

use aura_core::*;

use crate::engine::build_fix::{
    classify_build_errors, error_category_guidance, parse_error_references, BuildFixAttemptRecord,
    ErrorCategory,
};
use crate::file_ops::{self, StubReport};

pub(crate) struct BuildFixPromptParams<'a> {
    pub project: &'a Project,
    pub spec: &'a Spec,
    pub task: &'a Task,
    pub session: &'a Session,
    pub codebase_snapshot: &'a str,
    pub build_command: &'a str,
    pub stderr: &'a str,
    pub stdout: &'a str,
    pub prior_notes: &'a str,
    pub prior_attempts: &'a [BuildFixAttemptRecord],
}

#[allow(dead_code, clippy::too_many_arguments)] // Convenience wrapper kept for API symmetry
pub(crate) fn build_fix_prompt(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    codebase_snapshot: &str,
    build_command: &str,
    stderr: &str,
    stdout: &str,
    prior_notes: &str,
) -> String {
    let empty: Vec<BuildFixAttemptRecord> = vec![];
    build_fix_prompt_with_history(&BuildFixPromptParams {
        project,
        spec,
        task,
        session,
        codebase_snapshot,
        build_command,
        stderr,
        stdout,
        prior_notes,
        prior_attempts: &empty,
    })
}

pub(crate) fn build_fix_prompt_with_history(params: &BuildFixPromptParams<'_>) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format_fix_header(
        params.project,
        params.spec,
        params.task,
        params.session,
        params.prior_notes,
        params.prior_attempts,
    ));

    let mut categories = classify_build_errors(params.stderr);
    let error_refs = parse_error_references(params.stderr);
    let resolved_context =
        file_ops::resolve_error_context(Path::new(&params.project.linked_folder_path), &error_refs);

    detect_api_hallucination(&error_refs, &mut categories);

    let guidance = error_category_guidance(&categories);

    prompt.push_str(&format_fix_body(
        params.build_command,
        params.stderr,
        params.stdout,
        &guidance,
        &resolved_context,
        &error_refs,
        params.project,
        params.codebase_snapshot,
    ));

    prompt
}

fn format_fix_header(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    prior_notes: &str,
    prior_attempts: &[BuildFixAttemptRecord],
) -> String {
    let mut header = String::new();

    header.push_str(&format!(
        "# Project: {}\n{}\n\n",
        project.name, project.description
    ));
    header.push_str(&format!(
        "# Spec: {}\n{}\n\n",
        spec.title, spec.markdown_contents
    ));
    header.push_str(&format!("# Task: {}\n{}\n\n", task.title, task.description));

    if !session.summary_of_previous_context.is_empty() {
        header.push_str(&format!(
            "# Previous Context Summary\n{}\n\n",
            session.summary_of_previous_context
        ));
    }

    if !prior_notes.is_empty() {
        header.push_str(&format!(
            "# Notes from Initial Implementation\n{}\n\n",
            prior_notes
        ));
    }

    if !prior_attempts.is_empty() {
        header.push_str("# Previous Fix Attempts (all failed)\nThe following fixes were already attempted and did NOT solve the problem. You MUST try a fundamentally different approach.\n\n");
        for (i, attempt) in prior_attempts.iter().enumerate() {
            header.push_str(&format!("## Attempt {}\n", i + 1));
            if !attempt.changes_summary.is_empty() {
                header.push_str(&format!("Changes made:\n{}\n", attempt.changes_summary));
            } else if !attempt.files_changed.is_empty() {
                header.push_str("Files changed:\n");
                for f in &attempt.files_changed {
                    header.push_str(&format!("- {f}\n"));
                }
            }
            header.push_str(&format!("Error:\n```\n{}\n```\n\n", attempt.stderr));
        }
    }

    header
}

fn detect_api_hallucination(
    error_refs: &file_ops::ErrorReferences,
    categories: &mut Vec<ErrorCategory>,
) {
    let mut type_counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (t, _) in &error_refs.methods_not_found {
        *type_counts.entry(t.as_str()).or_insert(0) += 1;
    }
    if type_counts.values().any(|&c| c >= 3) || error_refs.wrong_arg_counts.len() >= 3 {
        categories.push(ErrorCategory::RustApiHallucination);
    }
}

#[allow(clippy::too_many_arguments)]
fn format_fix_body(
    build_command: &str,
    stderr: &str,
    stdout: &str,
    guidance: &str,
    resolved_context: &str,
    error_refs: &file_ops::ErrorReferences,
    project: &Project,
    codebase_snapshot: &str,
) -> String {
    let mut body = String::new();

    body.push_str(&format!(
        "# Build/Test Verification FAILED\n\
         The command `{}` failed after the previous file operations were applied.\n\
         You MUST fix ALL errors below.\n\n",
        build_command
    ));

    if !guidance.is_empty() {
        body.push_str(&format!(
            "## Error Analysis & Required Fix Strategy\n{}\n",
            guidance
        ));
    }

    let truncated_stderr = truncate_prompt_output(stderr, 8000);
    body.push_str(&format!("## stderr\n```\n{}\n```\n\n", truncated_stderr));

    if !stdout.is_empty() {
        let truncated_stdout = truncate_prompt_output(stdout, 4000);
        body.push_str(&format!("## stdout\n```\n{}\n```\n\n", truncated_stdout));
    }

    if error_refs.methods_not_found.len() > 3 {
        body.push_str(
            "WARNING: You are calling 3+ methods that do not exist. You MUST use ONLY \
             the methods listed in the \"Actual API Reference\" section below. Do NOT \
             invent or guess method names.\n\n",
        );
    }

    if !resolved_context.is_empty() {
        body.push_str(resolved_context);
        body.push('\n');
    }

    let error_source_files = file_ops::resolve_error_source_files(
        Path::new(&project.linked_folder_path),
        error_refs,
        file_ops::ERROR_SOURCE_BUDGET,
    );
    if !error_source_files.is_empty() {
        body.push_str(&error_source_files);
        body.push('\n');
    }

    if !codebase_snapshot.is_empty() {
        body.push_str(&format!(
            "# Current Codebase Files (after previous changes)\n{}\n",
            codebase_snapshot
        ));
    }

    body
}

fn truncate_prompt_output(s: &str, max_chars: usize) -> String {
    if s.len() <= max_chars {
        return s.to_string();
    }
    let half = max_chars / 2;
    let start = &s[..half];
    let end = &s[s.len() - half..];
    format!(
        "{start}\n\n... (truncated {0} bytes) ...\n\n{end}",
        s.len() - max_chars
    )
}

/// Build a prompt that tells the agent to replace stub/placeholder code with
/// real implementations.
pub(crate) fn build_stub_fix_prompt(stub_reports: &[StubReport]) -> String {
    let mut prompt = String::from(
        "STOP: Your implementation compiles but contains stub/placeholder code that must be \
         filled in. The following locations have incomplete implementations:\n\n",
    );

    for report in stub_reports {
        prompt.push_str(&format!(
            "- {}:{} -- {}\n  ```\n  {}\n  ```\n\n",
            report.path, report.line, report.pattern, report.context,
        ));
    }

    prompt.push_str(
        "Replace ALL stubs with real, working implementations. Read the spec and codebase \
         to understand what each function should do, then implement it fully.\n\
         Do NOT use todo!(), unimplemented!(), Default::default() as a placeholder, or \
         ignore function parameters with _ prefixes.\n\
         After fixing, verify the build still passes, then call task_done.\n",
    );

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_ops::{ErrorReferences, StubPattern};
    use aura_core::testutil::*;

    #[test]
    fn test_build_fix_prompt_contains_error_output() {
        let project = make_project("test", "/tmp/test");
        let spec = make_spec("spec content");
        let task = make_task("Fix build", "Fix the build errors");
        let session = make_session();
        let prompt = build_fix_prompt(
            &project,
            &spec,
            &task,
            &session,
            "",
            "cargo build",
            "error[E0308]: mismatched types",
            "Compiling test v0.1.0",
            "initial notes",
        );
        assert!(
            prompt.contains("error[E0308]"),
            "stderr should be in prompt"
        );
        assert!(
            prompt.contains("Compiling test"),
            "stdout should be in prompt"
        );
    }

    #[test]
    fn test_build_fix_prompt_contains_task_and_spec() {
        let project = make_project("myproj", "/tmp/proj");
        let spec = make_spec("implement login flow");
        let task = make_task("Add login handler", "Create the login endpoint");
        let session = make_session();
        let prompt = build_fix_prompt(
            &project,
            &spec,
            &task,
            &session,
            "",
            "cargo build",
            "error: cannot find function",
            "",
            "",
        );
        assert!(
            prompt.contains("Add login handler"),
            "task title should be in prompt"
        );
        assert!(
            prompt.contains("implement login flow"),
            "spec content should be in prompt"
        );
    }

    #[test]
    fn test_build_fix_prompt_with_history_includes_prior_attempts() {
        let project = make_project("test", "/tmp/test");
        let spec = make_spec("spec");
        let task = make_task("Fix it", "Fix");
        let session = make_session();
        let prior = vec![BuildFixAttemptRecord {
            stderr: "first error".into(),
            error_signature: "sig1".into(),
            files_changed: vec!["src/main.rs".into()],
            changes_summary: "changed main".into(),
        }];
        let params = BuildFixPromptParams {
            project: &project,
            spec: &spec,
            task: &task,
            session: &session,
            codebase_snapshot: "",
            build_command: "cargo build",
            stderr: "second error",
            stdout: "",
            prior_notes: "",
            prior_attempts: &prior,
        };
        let prompt = build_fix_prompt_with_history(&params);
        assert!(
            prompt.contains("Previous Fix Attempts"),
            "should mention prior attempts"
        );
        assert!(
            prompt.contains("first error"),
            "prior error should be included"
        );
        assert!(
            prompt.contains("changed main"),
            "prior changes should be included"
        );
    }

    #[test]
    fn test_build_fix_prompt_with_history_empty_prior() {
        let project = make_project("test", "/tmp/test");
        let spec = make_spec("spec");
        let task = make_task("Fix", "Fix");
        let session = make_session();
        let params = BuildFixPromptParams {
            project: &project,
            spec: &spec,
            task: &task,
            session: &session,
            codebase_snapshot: "",
            build_command: "cargo build",
            stderr: "some error",
            stdout: "",
            prior_notes: "",
            prior_attempts: &[],
        };
        let prompt = build_fix_prompt_with_history(&params);
        assert!(
            !prompt.contains("Previous Fix Attempts"),
            "no prior section when empty"
        );
    }

    #[test]
    fn test_detect_api_hallucination_flags_method_not_found() {
        let mut categories = vec![];
        let refs = ErrorReferences {
            types_referenced: vec![],
            methods_not_found: vec![
                ("MyStruct".into(), "method_a".into()),
                ("MyStruct".into(), "method_b".into()),
                ("MyStruct".into(), "method_c".into()),
            ],
            missing_fields: vec![],
            source_locations: vec![],
            wrong_arg_counts: vec![],
        };
        detect_api_hallucination(&refs, &mut categories);
        assert!(categories
            .iter()
            .any(|c| matches!(c, ErrorCategory::RustApiHallucination)));
    }

    #[test]
    fn test_truncate_prompt_output_within_limit() {
        let short = "hello world";
        let result = truncate_prompt_output(short, 1000);
        assert_eq!(result, short);
    }

    #[test]
    fn test_truncate_prompt_output_over_limit() {
        let long = "x".repeat(10_000);
        let result = truncate_prompt_output(&long, 200);
        assert!(result.len() < long.len());
        assert!(result.contains("truncated"));
    }

    #[test]
    fn test_build_stub_fix_prompt_single_report() {
        let reports = vec![StubReport {
            path: "src/lib.rs".into(),
            line: 42,
            pattern: StubPattern::TodoMacro,
            context: "fn do_thing() { todo!() }".into(),
        }];
        let prompt = build_stub_fix_prompt(&reports);
        assert!(prompt.contains("src/lib.rs:42"));
        assert!(prompt.contains("todo!()"));
        assert!(prompt.contains("stub/placeholder"));
    }

    #[test]
    fn test_build_stub_fix_prompt_multiple_reports() {
        let reports = vec![
            StubReport {
                path: "a.rs".into(),
                line: 1,
                pattern: StubPattern::TodoMacro,
                context: "ctx1".into(),
            },
            StubReport {
                path: "b.rs".into(),
                line: 2,
                pattern: StubPattern::UnimplementedMacro,
                context: "ctx2".into(),
            },
        ];
        let prompt = build_stub_fix_prompt(&reports);
        assert!(prompt.contains("a.rs:1"));
        assert!(prompt.contains("b.rs:2"));
        assert!(prompt.contains("ctx1"));
        assert!(prompt.contains("ctx2"));
    }
}
