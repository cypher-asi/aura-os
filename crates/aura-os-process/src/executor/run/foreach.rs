async fn execute_foreach(
    node: &ProcessNode,
    upstream_context: &str,
    executor: &ProcessExecutor,
    project_id: &ProjectId,
    parent_run_id: &ProcessRunId,
    run_base_input_tokens: u64,
    run_base_output_tokens: u64,
    run_base_cost_usd: f64,
) -> Result<NodeResult, ProcessError> {
    let child_process_id_str = node
        .config
        .get("child_process_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            ProcessError::Execution("ForEach node missing 'child_process_id' in config".into())
        })?;

    let child_process_id: ProcessId = child_process_id_str.parse().map_err(|_| {
        ProcessError::Execution(format!("Invalid child_process_id: {child_process_id_str}"))
    })?;

    let max_concurrency = node
        .config
        .get("max_concurrency")
        .and_then(|v| v.as_u64())
        .unwrap_or(3) as usize;
    let max_items = node
        .config
        .get("max_items")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .filter(|v| *v > 0);

    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(1800);

    let iterator_mode = node
        .config
        .get("iterator_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("json_array");

    let item_variable = node
        .config
        .get("item_variable_name")
        .and_then(|v| v.as_str())
        .unwrap_or("item");
    let item_projection = resolve_foreach_item_projection(&node.config);
    let compact_input_framing = node
        .config
        .get("compact_input_framing")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let json_array_key = node.config.get("json_array_key").and_then(|v| v.as_str());

    let mut items: Vec<String> = match iterator_mode {
        "json_array" => {
            let parsed = parse_foreach_json_array(upstream_context, json_array_key)?;
            parsed
                .iter()
                .map(|v| {
                    let value = project_foreach_item_value(v, item_projection.as_deref());
                    if let Some(s) = value.as_str() {
                        s.to_string()
                    } else {
                        serde_json::to_string(&value).unwrap_or_default()
                    }
                })
                .collect()
        }
        "line_delimited" => upstream_context
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect(),
        _ => {
            let sep = node
                .config
                .get("separator")
                .and_then(|v| v.as_str())
                .unwrap_or("\n");
            upstream_context
                .split(sep)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
    };
    apply_foreach_max_items(&mut items, max_items);

    if items.is_empty() {
        return Ok(NodeResult {
            downstream_output: "[]".to_string(),
            display_output: Some("ForEach: no items to iterate".to_string()),
            token_usage: None,
            content_blocks: None,
        });
    }

    info!(
        node_id = %node.node_id,
        child_process_id = %child_process_id,
        items = items.len(),
        max_items = max_items.map(|value| value as u64),
        max_concurrency,
        "ForEach: starting iteration"
    );

    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
    let executor = executor.clone();
    let parent_run_id = *parent_run_id;
    let prompt_template = node.prompt.clone();
    let progress_state = Arc::new(Mutex::new(ParentProgressMirrorState {
        base_input_tokens: run_base_input_tokens,
        base_output_tokens: run_base_output_tokens,
        base_cost_usd: run_base_cost_usd,
        child_runs: HashMap::new(),
    }));

    let mut handles = Vec::with_capacity(items.len());

    for (idx, item) in items.iter().enumerate() {
        let sem = semaphore.clone();
        let exec = executor.clone();
        let cpid = child_process_id;
        let prid = parent_run_id;
        let parent_project_id = project_id.to_string();
        let parent_process_id = node.process_id.to_string();
        let parent_run_id_str = parent_run_id.to_string();
        let parent_node_id = node.node_id.to_string();
        let progress_state = progress_state.clone();
        let item = item.clone();
        let prompt = prompt_template.clone();
        let item_var = item_variable.to_string();

        handles.push(tokio::spawn(async move {
            let _permit = sem
                .acquire()
                .await
                .map_err(|e| ProcessError::Execution(format!("ForEach semaphore error: {e}")))?;

            let input =
                build_foreach_child_input(&item_var, idx, &item, &prompt, compact_input_framing);

            exec.trigger_and_await_with_parent_mirror(
                &cpid,
                ProcessRunTrigger::Manual,
                Some(input),
                Some(prid),
                Some(ParentStreamMirrorContext {
                    project_id: parent_project_id,
                    task_id: format!("foreach:{}", parent_node_id),
                    process_id: parent_process_id,
                    run_id: parent_run_id_str,
                    node_id: parent_node_id,
                    item_label: format!("{item_var} #{}", idx + 1),
                    progress_state: progress_state.clone(),
                }),
            )
            .await
        }));
    }

    let timeout_result =
        tokio::time::timeout(Duration::from_secs(timeout_secs), async {
            let mut results = Vec::with_capacity(handles.len());
            for handle in handles {
                results.push(handle.await.map_err(|e| {
                    ProcessError::Execution(format!("ForEach task join error: {e}"))
                })?);
            }
            Ok::<Vec<Result<ProcessRun, ProcessError>>, ProcessError>(results)
        })
        .await;

    let child_results = match timeout_result {
        Ok(Ok(results)) => results,
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            return Err(ProcessError::Execution(format!(
                "ForEach timed out after {timeout_secs}s"
            )))
        }
    };

    let mut outputs = Vec::new();
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut failures = 0;

    for (idx, result) in child_results.into_iter().enumerate() {
        match result {
            Ok(run) => {
                total_input += run.total_input_tokens.unwrap_or(0);
                total_output += run.total_output_tokens.unwrap_or(0);
                let raw_output = run
                    .output
                    .unwrap_or_else(|| format!("(no output for item #{idx})"));
                outputs.push(compact_node_output(
                    &node.config,
                    &raw_output,
                    OutputCompactionMode::Auto,
                    "max_child_output_chars",
                ));
            }
            Err(e) => {
                failures += 1;
                outputs.push(format!("(error for item #{}: {})", idx, e));
            }
        }
    }

    let collect_mode = node
        .config
        .get("collect_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("json_array");

    let downstream = match collect_mode {
        "json_array" => {
            let arr: Vec<serde_json::Value> = outputs
                .iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect();
            serde_json::to_string(&arr).unwrap_or_else(|_| outputs.join("\n\n---\n\n"))
        }
        _ => outputs.join("\n\n---\n\n"),
    };

    let display = format!(
        "ForEach completed: {} items, {} failures, {} input tokens, {} output tokens",
        items.len(),
        failures,
        total_input,
        total_output
    );

    let token_usage = if total_input > 0 || total_output > 0 {
        Some(NodeTokenUsage {
            input_tokens: total_input,
            output_tokens: total_output,
            model: None,
        })
    } else {
        None
    };

    Ok(NodeResult {
        downstream_output: downstream,
        display_output: Some(display),
        token_usage,
        content_blocks: None,
    })
}
