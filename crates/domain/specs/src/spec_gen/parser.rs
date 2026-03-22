use chrono::Utc;
use serde::{Deserialize, Serialize};

use aura_core::*;
use aura_core::extract_fenced_json;

use crate::error::SpecGenError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSpecOutput {
    pub title: String,
    pub purpose: String,
    pub markdown: String,
}

/// Parses a leading "NN:" or "N:" from a spec title (e.g. "05: Requirements..." or "1: Core Domain").
/// Returns the logical spec number for use as order_index so display order matches the intended numbering.
pub fn order_index_from_spec_title(title: &str) -> Option<u32> {
    let t = title.trim();
    let colon = t.find(':')?;
    let prefix = t.get(..colon)?;
    let num_str = prefix.trim();
    if num_str.is_empty() {
        return None;
    }
    num_str.parse::<u32>().ok()
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
        .map(|(i, r)| {
            let order_index = order_index_from_spec_title(&r.title).unwrap_or(i as u32);
            Spec {
                spec_id: SpecId::new(),
                project_id: *project_id,
                title: r.title,
                order_index,
                markdown_contents: format!("## Purpose\n\n{}\n\n{}", r.purpose, r.markdown),
                created_at: now,
                updated_at: now,
            }
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

        if let Some(task) = parse_task_row(&cells, project_id, spec_id, tasks.len(), now) {
            tasks.push(task);
        }
    }

    tasks
}

fn parse_task_row(
    cells: &[&str],
    project_id: &ProjectId,
    spec_id: &SpecId,
    fallback_index: usize,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<Task> {
    if cells.len() < 3 {
        return None;
    }
    let id_str = cells[0];
    let title = cells[1];
    let description = cells[2..].join(" | ");

    let order_index = id_str
        .split('.')
        .nth(1)
        .and_then(|n| n.trim().parse::<u32>().ok())
        .unwrap_or(fallback_index as u32);

    Some(Task {
        task_id: TaskId::new(),
        project_id: *project_id,
        spec_id: *spec_id,
        title: title.to_string(),
        description,
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
    })
}

#[cfg(test)]
#[path = "parser_tests.rs"]
mod tests;
