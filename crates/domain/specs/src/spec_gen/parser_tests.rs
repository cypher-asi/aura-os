use super::*;

// -----------------------------------------------------------------------
// parse_claude_response
// -----------------------------------------------------------------------

#[test]
fn parse_valid_json_array() {
    let input = r##"[
        {"title": "Auth module", "purpose": "Handle login", "markdown": "# Auth\nLogin flow"},
        {"title": "DB layer", "purpose": "Persistence", "markdown": "# DB\nSchema"}
    ]"##;
    let specs = parse_claude_response(input).expect("valid JSON array should parse");
    assert_eq!(specs.len(), 2);
    assert_eq!(specs[0].title, "Auth module");
    assert_eq!(specs[1].title, "DB layer");
}

#[test]
fn parse_fenced_json_block() {
    let input = r##"
Here are the specs:

```json
[{"title": "API", "purpose": "REST endpoints", "markdown": "# API\nEndpoints"}]
```

Let me know if you need changes.
"##;
    let specs = parse_claude_response(input).expect("fenced JSON should parse");
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].title, "API");
}

#[test]
fn parse_empty_array_returns_error() {
    let input = "[]";
    let err = parse_claude_response(input).expect_err("empty array should produce an error");
    let msg = format!("{err}");
    assert!(msg.contains("empty"), "expected empty error, got: {msg}");
}

#[test]
fn parse_empty_title_returns_error() {
    let input = r##"[{"title": "", "purpose": "x", "markdown": "# Content"}]"##;
    let err = parse_claude_response(input).expect_err("empty title should produce an error");
    let msg = format!("{err}");
    assert!(msg.contains("empty title"), "expected title error, got: {msg}");
}

#[test]
fn parse_empty_markdown_returns_error() {
    let input = r##"[{"title": "Spec", "purpose": "x", "markdown": "  "}]"##;
    let err = parse_claude_response(input).expect_err("empty markdown should produce an error");
    let msg = format!("{err}");
    assert!(msg.contains("empty markdown"), "expected markdown error, got: {msg}");
}

#[test]
fn parse_invalid_json_returns_error() {
    let input = "This is not JSON";
    assert!(parse_claude_response(input).is_err());
}

// -----------------------------------------------------------------------
// IncrementalSpecParser
// -----------------------------------------------------------------------

#[test]
fn incremental_parser_single_object() {
    let mut parser = IncrementalSpecParser::new();
    let objects = parser.feed(r#"[{"title":"A","purpose":"p","markdown":"m"}]"#);
    assert_eq!(objects.len(), 1);
    let parsed: RawSpecOutput = serde_json::from_str(&objects[0]).expect("parsed object should deserialize");
    assert_eq!(parsed.title, "A");
}

#[test]
fn incremental_parser_multiple_objects() {
    let mut parser = IncrementalSpecParser::new();
    let objects = parser.feed(
        r#"[{"title":"A","purpose":"p","markdown":"m"},{"title":"B","purpose":"q","markdown":"n"}]"#,
    );
    assert_eq!(objects.len(), 2);
}

#[test]
fn incremental_parser_handles_braces_in_strings() {
    let mut parser = IncrementalSpecParser::new();
    let objects = parser.feed(
        r#"[{"title":"T","purpose":"p","markdown":"code: { x } end"}]"#,
    );
    assert_eq!(objects.len(), 1);
    let parsed: RawSpecOutput = serde_json::from_str(&objects[0]).expect("parsed object should deserialize");
    assert!(parsed.markdown.contains("{ x }"));
}

#[test]
fn incremental_parser_handles_escaped_quotes() {
    let mut parser = IncrementalSpecParser::new();
    let objects = parser.feed(
        r#"[{"title":"T","purpose":"p","markdown":"say \"hello\""}]"#,
    );
    assert_eq!(objects.len(), 1);
}

#[test]
fn incremental_parser_chunked_delivery() {
    let mut parser = IncrementalSpecParser::new();
    let r1 = parser.feed(r#"[{"title":"A","purpo"#);
    assert!(r1.is_empty());
    let r2 = parser.feed(r#"se":"p","markdown":"m"}"#);
    assert_eq!(r2.len(), 1);
}

// -----------------------------------------------------------------------
// order_index_from_spec_title
// -----------------------------------------------------------------------

#[test]
fn order_index_from_spec_title_parses_nn_prefix() {
    assert_eq!(order_index_from_spec_title("05: Requirements Ingestion"), Some(5));
    assert_eq!(order_index_from_spec_title("02: RocksDB Storage Layer"), Some(2));
    assert_eq!(order_index_from_spec_title("1: Core Domain"), Some(1));
    assert_eq!(order_index_from_spec_title("01: Core Domain Types"), Some(1));
}

#[test]
fn order_index_from_spec_title_no_prefix_returns_none() {
    assert_eq!(order_index_from_spec_title("Requirements Ingestion"), None);
    assert_eq!(order_index_from_spec_title("First"), None);
}

// -----------------------------------------------------------------------
// raw_to_specs
// -----------------------------------------------------------------------

#[test]
fn raw_to_specs_creates_valid_specs() {
    let pid = ProjectId::new();
    let raw = vec![
        RawSpecOutput {
            title: "First".into(),
            purpose: "Do X".into(),
            markdown: "# Details\nStuff".into(),
        },
        RawSpecOutput {
            title: "Second".into(),
            purpose: "Do Y".into(),
            markdown: "# More\nOther".into(),
        },
    ];
    let specs = raw_to_specs(&pid, raw);
    assert_eq!(specs.len(), 2);
    assert_eq!(specs[0].title, "First");
    assert_eq!(specs[0].order_index, 0);
    assert_eq!(specs[0].project_id, pid);
    assert!(specs[0].markdown_contents.contains("## Purpose"));
    assert!(specs[0].markdown_contents.contains("Do X"));
    assert_eq!(specs[1].order_index, 1);
}

#[test]
fn raw_to_specs_uses_title_order_index_when_present() {
    let pid = ProjectId::new();
    let raw = vec![
        RawSpecOutput {
            title: "05: Fifth".into(),
            purpose: "P".into(),
            markdown: "M".into(),
        },
        RawSpecOutput {
            title: "02: Second".into(),
            purpose: "P".into(),
            markdown: "M".into(),
        },
        RawSpecOutput {
            title: "01: First".into(),
            purpose: "P".into(),
            markdown: "M".into(),
        },
    ];
    let specs = raw_to_specs(&pid, raw);
    assert_eq!(specs[0].order_index, 5);
    assert_eq!(specs[1].order_index, 2);
    assert_eq!(specs[2].order_index, 1);
}

// -----------------------------------------------------------------------
// parse_tasks_from_markdown
// -----------------------------------------------------------------------

#[test]
fn parse_tasks_basic_table() {
    let pid = ProjectId::new();
    let sid = SpecId::new();
    let markdown = r#"
## Tasks

| ID | Title | Description |
|----|-------|-------------|
| S1.1 | Create models | Define database models |
| S1.2 | Add routes | Set up REST endpoints |
| S1.3 | Write tests | Unit test coverage |

## Notes
Some other content.
"#;
    let tasks = parse_tasks_from_markdown(&pid, &sid, markdown);
    assert_eq!(tasks.len(), 3);
    assert_eq!(tasks[0].title, "Create models");
    assert_eq!(tasks[0].description, "Define database models");
    assert_eq!(tasks[0].order_index, 1);
    assert_eq!(tasks[1].title, "Add routes");
    assert_eq!(tasks[1].order_index, 2);
    assert_eq!(tasks[2].title, "Write tests");
    assert_eq!(tasks[2].order_index, 3);
}

#[test]
fn parse_tasks_empty_when_no_table() {
    let pid = ProjectId::new();
    let sid = SpecId::new();
    let markdown = "# Spec\n\nJust some text without tasks.";
    let tasks = parse_tasks_from_markdown(&pid, &sid, markdown);
    assert!(tasks.is_empty());
}

#[test]
fn parse_tasks_stops_at_next_section() {
    let pid = ProjectId::new();
    let sid = SpecId::new();
    let markdown = r#"
## Tasks

| ID | Title | Desc |
|----|-------|------|
| S1.1 | Only one | A single task |

## Implementation Notes

Some notes here.
"#;
    let tasks = parse_tasks_from_markdown(&pid, &sid, markdown);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].title, "Only one");
}

#[test]
fn parse_tasks_sets_project_and_spec_ids() {
    let pid = ProjectId::new();
    let sid = SpecId::new();
    let markdown = r#"
## Tasks

| ID | Title | Desc |
|----|-------|------|
| S1.1 | T1 | D1 |
"#;
    let tasks = parse_tasks_from_markdown(&pid, &sid, markdown);
    assert_eq!(tasks[0].project_id, pid);
    assert_eq!(tasks[0].spec_id, sid);
    assert_eq!(tasks[0].status, TaskStatus::Ready);
}

// -----------------------------------------------------------------------
// extract_fenced_json (via parse_claude_response)
// -----------------------------------------------------------------------

#[test]
fn fenced_json_without_lang_tag() {
    let input = "Here:\n```\n[{\"title\":\"T\",\"purpose\":\"p\",\"markdown\":\"content\"}]\n```";
    let specs = parse_claude_response(input).expect("bare fenced JSON should parse");
    assert_eq!(specs.len(), 1);
}

// -----------------------------------------------------------------------
// repair_partial_json
// -----------------------------------------------------------------------

#[test]
fn repair_partial_json_complete_object() {
    let input = r#"{"title":"A","purpose":"p","markdown":"m"}"#;
    let repaired = repair_partial_json(input);
    let _: serde_json::Value = serde_json::from_str(&repaired).expect("complete JSON should parse");
}

#[test]
fn repair_partial_json_unterminated_string() {
    let input = r##"{"title":"Auth module","purpose":"Handle auth","markdown":"# Auth\nLogin"##;
    let repaired = repair_partial_json(input);
    let v: serde_json::Value = serde_json::from_str(&repaired).expect("repaired JSON should parse");
    assert_eq!(v["title"].as_str().unwrap(), "Auth module");
    assert!(v["markdown"].as_str().unwrap().starts_with("# Auth"));
}

#[test]
fn repair_partial_json_trailing_comma() {
    let input = r##"{"title":"A","purpose":"p","markdown":"m","##;
    let repaired = repair_partial_json(input);
    let v: serde_json::Value = serde_json::from_str(&repaired).expect("trailing comma should be fixed");
    assert_eq!(v["title"].as_str().unwrap(), "A");
}

#[test]
fn repair_partial_json_empty_returns_empty() {
    assert_eq!(repair_partial_json(""), "");
    assert_eq!(repair_partial_json("  "), "");
}

// -----------------------------------------------------------------------
// IncrementalSpecParser::best_effort_partial
// -----------------------------------------------------------------------

#[test]
fn best_effort_partial_returns_none_when_not_in_object() {
    let parser = IncrementalSpecParser::new();
    assert!(parser.best_effort_partial().is_none());
}

#[test]
fn best_effort_partial_returns_none_for_short_buffer() {
    let mut parser = IncrementalSpecParser::new();
    parser.feed(r##"[{"ti"##);
    assert!(parser.best_effort_partial().is_none());
}

#[test]
fn best_effort_partial_returns_none_when_title_empty() {
    let mut parser = IncrementalSpecParser::new();
    parser.feed(r##"[{"title":"","purpose":"p"##);
    assert!(parser.best_effort_partial().is_none());
}

#[test]
fn best_effort_partial_title_only_no_other_fields() {
    let mut parser = IncrementalSpecParser::new();
    parser.feed(r##"[{"title":"Core Domain Types"##);
    let partial = parser.best_effort_partial().expect("title-only should succeed");
    assert_eq!(partial.title, "Core Domain Types");
    assert_eq!(partial.purpose, "", "purpose should default to empty");
    assert_eq!(partial.markdown, "", "markdown should default to empty");
}

#[test]
fn best_effort_partial_title_and_purpose_no_markdown() {
    let mut parser = IncrementalSpecParser::new();
    parser.feed(r##"[{"title":"Auth Module","purpose":"Handle login and session mgmt"##);
    let partial = parser.best_effort_partial().expect("title+purpose should succeed");
    assert_eq!(partial.title, "Auth Module");
    assert_eq!(partial.purpose, "Handle login and session mgmt");
    assert_eq!(partial.markdown, "", "markdown should default to empty");
}

#[test]
fn best_effort_partial_returns_partial_spec_with_all_fields() {
    let mut parser = IncrementalSpecParser::new();
    parser.feed(r##"[{"title":"Auth Module","purpose":"Handle login","markdown":"# Auth\nSome content"##);
    let partial = parser.best_effort_partial().expect("should produce partial");
    assert_eq!(partial.title, "Auth Module");
    assert_eq!(partial.purpose, "Handle login");
    assert!(partial.markdown.contains("# Auth"));
}

#[test]
fn best_effort_partial_resets_after_complete_object() {
    let mut parser = IncrementalSpecParser::new();
    let completed = parser.feed(
        r##"[{"title":"A","purpose":"p","markdown":"m"},{"title":"B","purpose":"q","markdown":"# St"##,
    );
    assert_eq!(completed.len(), 1);
    let partial = parser.best_effort_partial().expect("should see partial for second object");
    assert_eq!(partial.title, "B");
    assert!(partial.markdown.starts_with("# St"));
}

// -----------------------------------------------------------------------
// repair_partial_json
// -----------------------------------------------------------------------

#[test]
fn repair_dangling_backslash_in_string() {
    let repaired = repair_partial_json("{\"title\": \"line1\\");
    let val: serde_json::Value = serde_json::from_str(&repaired).expect("should parse");
    assert_eq!(val["title"], "line1");
}

#[test]
fn repair_double_backslash_at_end() {
    let repaired = repair_partial_json("{\"title\": \"path\\\\");
    let val: serde_json::Value = serde_json::from_str(&repaired).expect("should parse");
    assert_eq!(val["title"], "path\\");
}

#[test]
fn repair_newline_escape_in_markdown() {
    let input = "{\"title\": \"Spec\", \"markdown\": \"# Head\\nBody text";
    let repaired = repair_partial_json(input);
    let val: serde_json::Value = serde_json::from_str(&repaired).expect("should parse");
    assert!(val["markdown"].as_str().unwrap().contains("Head"));
}

#[test]
fn repair_trailing_comma() {
    let repaired = repair_partial_json(r#"{"title": "A","#);
    let val: serde_json::Value = serde_json::from_str(&repaired).expect("should parse");
    assert_eq!(val["title"], "A");
}

#[test]
fn repair_empty_returns_empty() {
    assert_eq!(repair_partial_json(""), "");
    assert_eq!(repair_partial_json("  "), "");
}

#[test]
fn best_effort_partial_with_dangling_backslash() {
    let mut parser = IncrementalSpecParser::new();
    let input = "[{\"title\": \"Auth\", \"purpose\": \"handle auth\", \"markdown\": \"# Auth\\n## Details\\";
    parser.feed(input);
    let partial = parser.best_effort_partial().expect("should produce partial despite dangling backslash");
    assert_eq!(partial.title, "Auth");
    assert!(partial.markdown.contains("Details"));
}
