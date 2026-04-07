fn execute_ignition(node: &ProcessNode) -> Result<String, ProcessError> {
    let mut parts = Vec::new();

    if !node.prompt.is_empty() {
        parts.push(node.prompt.clone());
    }

    if !node.config.is_null() && node.config != serde_json::Value::Object(Default::default()) {
        parts.push(format!(
            "## Configuration\n\n```json\n{}\n```",
            serde_json::to_string_pretty(&node.config).unwrap_or_default()
        ));
    }

    Ok(parts.join("\n\n"))
}

async fn execute_subprocess(
    node: &ProcessNode,
    upstream_context: &str,
    executor: &ProcessExecutor,
    parent_run_id: &ProcessRunId,
) -> Result<NodeResult, ProcessError> {
    let child_process_id_str = node
        .config
        .get("child_process_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            ProcessError::Execution("SubProcess node missing 'child_process_id' in config".into())
        })?;

    let child_process_id: ProcessId = child_process_id_str.parse().map_err(|_| {
        ProcessError::Execution(format!("Invalid child_process_id: {child_process_id_str}"))
    })?;

    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(1200);

    info!(
        node_id = %node.node_id,
        child_process_id = %child_process_id,
        "SubProcess: triggering child process"
    );

    let input = if upstream_context.is_empty() {
        node.prompt.clone()
    } else if node.prompt.is_empty() {
        upstream_context.to_string()
    } else {
        format!("{}\n\n---\n\n{}", upstream_context, node.prompt)
    };

    let child_run = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        executor.trigger_and_await(
            &child_process_id,
            ProcessRunTrigger::Manual,
            Some(input),
            Some(*parent_run_id),
        ),
    )
    .await
    .map_err(|_| {
        ProcessError::Execution(format!(
        "SubProcess timed out after {timeout_secs}s waiting for child process {child_process_id}"
    ))
    })??;

    let output = child_run.output.unwrap_or_default();
    let display = format!(
        "SubProcess completed (child run {}): {} bytes output",
        child_run.run_id,
        output.len()
    );

    let mut token_usage = None;
    if let (Some(inp), Some(out)) = (child_run.total_input_tokens, child_run.total_output_tokens) {
        token_usage = Some(NodeTokenUsage {
            input_tokens: inp,
            output_tokens: out,
            model: None,
        });
    }

    Ok(NodeResult {
        downstream_output: output,
        display_output: Some(display),
        token_usage,
        content_blocks: None,
    })
}

/// Try to recover a JSON array from mixed upstream text (e.g. sub-task
/// outputs joined by `---` separators with possible error lines).
fn extract_json_array_from_mixed(text: &str) -> Option<Vec<serde_json::Value>> {
    // Split on the standard sub-task separator and parse each section independently.
    let sections: Vec<&str> = text.split("\n\n---\n\n").collect();
    if sections.len() > 1 {
        let mut all_items = Vec::new();
        for section in &sections {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(section.trim()) {
                all_items.extend(arr);
            }
        }
        if !all_items.is_empty() {
            return Some(all_items);
        }
    }

    // Scan for the first valid `[…]` JSON array anywhere in the text.
    for (start, ch) in text.char_indices() {
        if ch == '[' {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&text[start..]) {
                return Some(arr);
            }
        }
    }

    None
}

fn extract_json_array_from_value(
    value: &serde_json::Value,
    preferred_keys: &[&str],
) -> Result<Option<Vec<serde_json::Value>>, String> {
    match value {
        serde_json::Value::Array(items) => Ok(Some(items.clone())),
        serde_json::Value::Object(map) => {
            for key in preferred_keys {
                if let Some(candidate) = map.get(*key) {
                    return match candidate {
                        serde_json::Value::Array(items) => Ok(Some(items.clone())),
                        _ => Err(format!(
                            "ForEach: object key `{key}` exists but is not a JSON array"
                        )),
                    };
                }
            }

            Ok(None)
        }
        _ => Ok(None),
    }
}

fn parse_foreach_json_array(
    upstream_context: &str,
    json_array_key: Option<&str>,
) -> Result<Vec<serde_json::Value>, ProcessError> {
    let trimmed = upstream_context.trim();
    let mut checked_keys = Vec::new();

    if let Some(key) = json_array_key.filter(|key| !key.trim().is_empty()) {
        checked_keys.push(key.trim().to_string());
    }
    if !checked_keys.iter().any(|key| key == "entries") {
        checked_keys.push("entries".to_string());
    }

    if let Ok(parsed_value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let key_refs = checked_keys.iter().map(String::as_str).collect::<Vec<_>>();
        match extract_json_array_from_value(&parsed_value, &key_refs) {
            Ok(Some(items)) => return Ok(items),
            Ok(None) => {
                if let serde_json::Value::Object(map) = &parsed_value {
                    let available_keys = map.keys().cloned().collect::<Vec<_>>().join(", ");
                    return Err(ProcessError::Execution(format!(
                        "ForEach: upstream JSON is an object, but none of these keys contain an array: {}. Available keys: {}",
                        checked_keys.join(", "),
                        if available_keys.is_empty() {
                            "(none)".to_string()
                        } else {
                            available_keys
                        }
                    )));
                }
            }
            Err(message) => return Err(ProcessError::Execution(message)),
        }
    }

    serde_json::from_str::<Vec<serde_json::Value>>(trimmed)
        .or_else(|_| {
            extract_json_array_from_mixed(trimmed)
                .ok_or_else(|| serde_json::from_str::<serde_json::Value>("!").unwrap_err())
        })
        .map_err(|_| {
            let key_hint = if checked_keys.is_empty() {
                String::new()
            } else {
                format!(
                    " or a JSON object containing an array under one of: {}",
                    checked_keys.join(", ")
                )
            };
            ProcessError::Execution(format!(
                "ForEach: upstream does not contain a valid JSON array{key_hint}"
            ))
        })
}

fn apply_foreach_max_items(items: &mut Vec<String>, max_items: Option<usize>) {
    if let Some(limit) = max_items.filter(|limit| *limit > 0) {
        items.truncate(limit);
    }
}
