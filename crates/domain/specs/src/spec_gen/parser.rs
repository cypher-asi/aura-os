use chrono::Utc;
use serde::{Deserialize, Serialize};

use aura_core::*;

use crate::error::SpecGenError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSpecOutput {
    pub title: String,
    pub purpose: String,
    pub markdown: String,
}

/// Extracts complete JSON objects from a streaming character sequence.
///
/// Designed for Claude responses that are JSON arrays of spec objects (`[{...}, {...}]`).
/// Tracks brace depth, string boundaries, and escape sequences to correctly detect
/// when each top-level `{...}` object is complete, even when `{` or `}` appear inside
/// JSON string values (e.g. in markdown content).
pub(crate) struct IncrementalSpecParser {
    in_string: bool,
    escape_next: bool,
    brace_depth: i32,
    current_object: String,
    in_object: bool,
}

impl IncrementalSpecParser {
    pub fn new() -> Self {
        Self {
            in_string: false,
            escape_next: false,
            brace_depth: 0,
            current_object: String::new(),
            in_object: false,
        }
    }

    pub fn feed(&mut self, text: &str) -> Vec<String> {
        let mut complete_objects = Vec::new();

        for ch in text.chars() {
            if self.in_object {
                self.current_object.push(ch);
            }

            if self.escape_next {
                self.escape_next = false;
                continue;
            }

            if self.in_string {
                match ch {
                    '\\' => self.escape_next = true,
                    '"' => self.in_string = false,
                    _ => {}
                }
                continue;
            }

            match ch {
                '"' => self.in_string = true,
                '{' => {
                    if self.brace_depth == 0 {
                        self.in_object = true;
                        self.current_object.clear();
                        self.current_object.push(ch);
                    }
                    self.brace_depth += 1;
                }
                '}' => {
                    self.brace_depth -= 1;
                    if self.brace_depth == 0 && self.in_object {
                        self.in_object = false;
                        complete_objects.push(std::mem::take(&mut self.current_object));
                    }
                }
                _ => {}
            }
        }

        complete_objects
    }
}

pub(crate) fn parse_claude_response(
    response: &str,
) -> Result<Vec<RawSpecOutput>, SpecGenError> {
    let trimmed = response.trim();

    if let Ok(specs) = serde_json::from_str::<Vec<RawSpecOutput>>(trimmed) {
        return validate_raw_specs(specs);
    }

    if let Some(json_str) = extract_fenced_json(trimmed) {
        if let Ok(specs) = serde_json::from_str::<Vec<RawSpecOutput>>(&json_str) {
            return validate_raw_specs(specs);
        }
    }

    Err(SpecGenError::ParseError(format!(
        "failed to parse Claude response as JSON array of specs. Response: {}",
        &trimmed[..trimmed.len().min(500)]
    )))
}

fn extract_fenced_json(text: &str) -> Option<String> {
    let start_markers = ["```json", "```"];
    for marker in &start_markers {
        if let Some(start) = text.find(marker) {
            let after_marker = start + marker.len();
            if let Some(end) = text[after_marker..].find("```") {
                return Some(text[after_marker..after_marker + end].trim().to_string());
            }
        }
    }
    None
}

fn validate_raw_specs(specs: Vec<RawSpecOutput>) -> Result<Vec<RawSpecOutput>, SpecGenError> {
    if specs.is_empty() {
        return Err(SpecGenError::ParseError(
            "Claude returned an empty spec array".into(),
        ));
    }
    for (i, spec) in specs.iter().enumerate() {
        if spec.title.trim().is_empty() {
            return Err(SpecGenError::ParseError(format!(
                "spec at index {i} has an empty title"
            )));
        }
        if spec.markdown.trim().is_empty() {
            return Err(SpecGenError::ParseError(format!(
                "spec at index {i} has empty markdown"
            )));
        }
    }
    Ok(specs)
}

pub(crate) fn raw_to_specs(project_id: &ProjectId, raw: Vec<RawSpecOutput>) -> Vec<Spec> {
    let now = Utc::now();
    raw.into_iter()
        .enumerate()
        .map(|(i, r)| Spec {
            spec_id: SpecId::new(),
            project_id: *project_id,
            title: r.title,
            order_index: i as u32,
            markdown_contents: format!("## Purpose\n\n{}\n\n{}", r.purpose, r.markdown),
            created_at: now,
            updated_at: now,
        })
        .collect()
}

pub(crate) fn parse_tasks_from_markdown(
    project_id: &ProjectId,
    spec_id: &SpecId,
    markdown: &str,
) -> Vec<Task> {
    let now = Utc::now();
    let mut tasks = Vec::new();
    let mut in_task_section = false;
    let mut header_seen = false;
    let mut separator_seen = false;

    for line in markdown.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('#') && trimmed.to_lowercase().contains("task") {
            in_task_section = true;
            header_seen = false;
            separator_seen = false;
            continue;
        }

        if in_task_section && trimmed.starts_with('#') && !trimmed.to_lowercase().contains("task") {
            break;
        }

        if !in_task_section || trimmed.is_empty() || !trimmed.starts_with('|') {
            continue;
        }

        if !header_seen {
            header_seen = true;
            continue;
        }
        if !separator_seen {
            separator_seen = true;
            continue;
        }

        let cells: Vec<&str> = trimmed
            .split('|')
            .map(|c| c.trim())
            .filter(|c| !c.is_empty())
            .collect();

        if cells.len() >= 3 {
            let id_str = cells[0];
            let title = cells[1];
            let description = cells[2..].join(" | ");

            let order_index = id_str
                .split('.')
                .nth(1)
                .and_then(|n| n.trim().parse::<u32>().ok())
                .unwrap_or(tasks.len() as u32);

            tasks.push(Task {
                task_id: TaskId::new(),
                project_id: *project_id,
                spec_id: *spec_id,
                title: title.to_string(),
                description: description.to_string(),
                status: TaskStatus::Ready,
                order_index,
                dependency_ids: vec![],
                parent_task_id: None,
                assigned_agent_instance_id: None,
                completed_by_agent_instance_id: None,
                session_id: None,
                execution_notes: String::new(),
                files_changed: vec![],
                live_output: String::new(),
                build_steps: vec![],
                test_steps: vec![],
                user_id: None,
                model: None,
                total_input_tokens: 0,
                total_output_tokens: 0,
                created_at: now,
                updated_at: now,
            });
        }
    }

    tasks
}

#[cfg(test)]
mod tests {
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
}
