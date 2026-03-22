use aura_link::ToolCall;

pub(super) fn looks_like_compiler_errors(output: &str) -> bool {
    let has_rust_errors = output.contains("error[E") && output.contains("-->");
    let has_generic_errors = output.contains("error:") && output.contains("-->");
    let has_ts_errors = output.contains("TS2") && output.contains("error TS");
    has_rust_errors || has_generic_errors || has_ts_errors
}

pub(super) fn format_tool_arg_hint(tc: &ToolCall) -> String {
    match tc.name.as_str() {
        "read_file" => {
            let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let start = tc.input.get("start_line").and_then(|v| v.as_u64());
            let end = tc.input.get("end_line").and_then(|v| v.as_u64());
            match (start, end) {
                (Some(s), Some(e)) => format!("{path}:{s}-{e}"),
                (Some(s), None) => format!("{path}:{s}-end"),
                (None, Some(e)) => format!("{path}:1-{e}"),
                (None, None) => path.to_string(),
            }
        }
        "write_file" | "edit_file" | "delete_file" => tc
            .input
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "list_files" => tc
            .input
            .get("directory")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "search_code" => {
            let pattern = tc
                .input
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let ctx = tc.input.get("context_lines").and_then(|v| v.as_u64());
            if let Some(c) = ctx {
                format!("{pattern}, context={c}")
            } else {
                pattern.to_string()
            }
        }
        "run_command" => tc
            .input
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}
