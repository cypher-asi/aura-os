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
    let specs = parse_claude_response(input).unwrap();
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
    let specs = parse_claude_response(input).unwrap();
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].title, "API");
}

#[test]
fn parse_empty_array_returns_error() {
    let input = "[]";
    let err = parse_claude_response(input).unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("empty"), "expected empty error, got: {msg}");
}

#[test]
fn parse_empty_title_returns_error() {
    let input = r##"[{"title": "", "purpose": "x", "markdown": "# Content"}]"##;
    let err = parse_claude_response(input).unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("empty title"), "expected title error, got: {msg}");
}

#[test]
fn parse_empty_markdown_returns_error() {
    let input = r##"[{"title": "Spec", "purpose": "x", "markdown": "  "}]"##;
    let err = parse_claude_response(input).unwrap_err();
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
    let parsed: RawSpecOutput = serde_json::from_str(&objects[0]).unwrap();
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
    let parsed: RawSpecOutput = serde_json::from_str(&objects[0]).unwrap();
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
    let specs = parse_claude_response(input).unwrap();
    assert_eq!(specs.len(), 1);
}
