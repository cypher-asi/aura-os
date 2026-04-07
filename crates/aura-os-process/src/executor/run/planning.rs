/// Split a node's work into sub-tasks by examining the upstream context.
/// Uses deterministic heuristics — no LLM call needed:
///   1. If upstream is a JSON array → one sub-task per element
///   2. If upstream has `---` delimited sections → one sub-task per section
///   3. If upstream has bullet/numbered lists → one sub-task per item
///   4. Otherwise → single task (no split)
fn plan_sub_tasks(node: &ProcessNode, upstream_context: &str) -> Vec<SubTaskPlan> {
    let trimmed = upstream_context.trim();
    if trimmed.is_empty() {
        return vec![SubTaskPlan {
            title: node.label.clone(),
            description: node.prompt.clone(),
        }];
    }

    if let Some(plans) = try_plan_sub_tasks_from_json_array(node, trimmed) {
        return plans;
    }

    if let Some(plans) = try_plan_sub_tasks_from_section_delimiters(node, trimmed) {
        return plans;
    }

    if let Some(plans) = try_plan_sub_tasks_from_list_lines(node, trimmed) {
        return plans;
    }

    vec![single_sub_task(node, upstream_context)]
}

fn clip_title(title: &str) -> &str {
    if title.len() > 60 {
        &title[..60]
    } else {
        title
    }
}

fn sub_task_plan_indexed_title(index: usize, short_title: &str) -> String {
    format!("#{}: {}", index + 1, short_title)
}

fn sub_task_plan_from_json_element(node: &ProcessNode, index: usize, v: &serde_json::Value) -> SubTaskPlan {
    let item_str = if let Some(s) = v.as_str() {
        s.to_string()
    } else {
        serde_json::to_string(v).unwrap_or_default()
    };
    let title = v
        .get("name")
        .or_else(|| v.get("title"))
        .and_then(|n| n.as_str())
        .unwrap_or(&item_str);
    let short_title = clip_title(title);
    SubTaskPlan {
        title: sub_task_plan_indexed_title(index, short_title),
        description: format!("{}\n\nItem:\n{}", node.prompt, item_str),
    }
}

fn try_plan_sub_tasks_from_json_array(
    node: &ProcessNode,
    trimmed: &str,
) -> Option<Vec<SubTaskPlan>> {
    if !trimmed.starts_with('[') {
        return None;
    }
    let arr = serde_json::from_str::<Vec<serde_json::Value>>(trimmed).ok()?;
    if arr.len() <= 1 {
        return None;
    }
    Some(
        arr.iter()
            .enumerate()
            .map(|(i, v)| sub_task_plan_from_json_element(node, i, v))
            .collect(),
    )
}

fn try_plan_sub_tasks_from_section_delimiters(
    node: &ProcessNode,
    trimmed: &str,
) -> Option<Vec<SubTaskPlan>> {
    let sections: Vec<&str> = trimmed
        .split("\n---\n")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if sections.len() <= 1 {
        return None;
    }
    Some(
        sections
            .iter()
            .enumerate()
            .map(|(i, section)| {
                let first_line = section.lines().next().unwrap_or("Section");
                let title = first_line.trim_start_matches('#').trim();
                let short_title = clip_title(title);
                SubTaskPlan {
                    title: sub_task_plan_indexed_title(i, short_title),
                    description: format!("{}\n\nSection:\n{}", node.prompt, section),
                }
            })
            .collect(),
    )
}

fn line_looks_like_list_item(line: &str) -> bool {
    line.starts_with("- ")
        || line.starts_with("* ")
        || (line
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
            && line.contains(". "))
}

fn try_plan_sub_tasks_from_list_lines(
    node: &ProcessNode,
    trimmed: &str,
) -> Option<Vec<SubTaskPlan>> {
    let list_items: Vec<&str> = trimmed
        .lines()
        .map(|l| l.trim())
        .filter(|l| line_looks_like_list_item(l))
        .collect();
    if list_items.len() <= 1 {
        return None;
    }
    Some(
        list_items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let cleaned = item.trim_start_matches(|c: char| {
                    c == '-' || c == '*' || c.is_ascii_digit() || c == '.' || c == ' '
                });
                let short_title = clip_title(cleaned);
                SubTaskPlan {
                    title: sub_task_plan_indexed_title(i, short_title),
                    description: format!("{}\n\nItem: {}", node.prompt, cleaned),
                }
            })
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// LLM-based sub-task planning (direct router call)
// ---------------------------------------------------------------------------

const PLANNING_MODEL: &str = "claude-haiku-4-5";
const PLANNING_MAX_TOKENS: u32 = 4096;
const PLANNING_CONTEXT_CHAR_LIMIT: usize = 12_000;

const PLANNING_SYSTEM_PROMPT: &str = "\
You are a task planner for an AI process engine. Each sub-task you produce will be \
executed by a separate AI coding agent that has access to shell commands and file \
read/write tools in an empty workspace directory.\n\n\
Rules:\n\
- If the work is genuinely a single atomic task, return a single-element array.\n\
- Each sub-task description MUST contain concrete, operational steps — not just a topic.\n\
- Preserve any tool-specific references from the original prompt (CLI commands like `tvly`, \
API calls, specific tools). The executing agent needs to know WHAT to run.\n\
- Do NOT instruct agents to build software projects (no Cargo.toml, package.json, etc.). \
Agents should run commands and write output files directly.\n\
- Each sub-task writes its results to a file. Keep outputs as plain text or JSON.\n\
- Sub-tasks must be independent and parallelizable — don't reference other sub-tasks.\n\n\
Respond ONLY with a JSON array, no markdown fences:\n\
[{\"title\": \"short title\", \"description\": \"step-by-step instructions for this sub-task\"}]";

fn truncate_planning_upstream_context(upstream_context: &str) -> String {
    let mut context = upstream_context.to_string();
    if context.len() > PLANNING_CONTEXT_CHAR_LIMIT {
        context.truncate(PLANNING_CONTEXT_CHAR_LIMIT);
        context.push_str("\n[truncated]");
    }
    context
}

fn build_planning_llm_request_body(node: &ProcessNode, context: &str) -> serde_json::Value {
    let user_message = format!(
        "Task: {}\n\nPrompt:\n{}\n\nUpstream context:\n{}",
        node.label, node.prompt, context,
    );
    serde_json::json!({
        "model": PLANNING_MODEL,
        "max_tokens": PLANNING_MAX_TOKENS,
        "system": PLANNING_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_message}],
    })
}

async fn post_planning_llm_messages(
    http: &reqwest::Client,
    router_url: &str,
    token: &str,
    req_body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let resp = http
        .post(format!("{router_url}/v1/messages"))
        .bearer_auth(token)
        .json(req_body)
        .send()
        .await
        .map_err(|e| format!("LLM planning request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM planning returned {status}: {body}"));
    }

    resp.json()
        .await
        .map_err(|e| format!("parsing LLM planning response: {e}"))
}

fn planning_assistant_text_from_response(body: &serde_json::Value) -> &str {
    body.get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("[]")
}

fn strip_json_markdown_fence(text: &str) -> &str {
    let cleaned = text.trim();
    if cleaned.starts_with("```") {
        cleaned
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        cleaned
    }
}

fn parse_sub_task_plans_from_llm_json(text: &str) -> Result<Vec<SubTaskPlan>, String> {
    let json_str = strip_json_markdown_fence(text);
    let plans: Vec<SubTaskPlan> = serde_json::from_str(json_str)
        .map_err(|e| format!("failed to parse planning JSON: {e}"))?;
    if plans.is_empty() {
        return Err("LLM returned empty plan".into());
    }
    Ok(plans)
}

async fn plan_sub_tasks_via_llm(
    http: &reqwest::Client,
    router_url: &str,
    token: &str,
    node: &ProcessNode,
    upstream_context: &str,
) -> Result<Vec<SubTaskPlan>, String> {
    let context = truncate_planning_upstream_context(upstream_context);
    let req_body = build_planning_llm_request_body(node, &context);
    let body = post_planning_llm_messages(http, router_url, token, &req_body).await?;
    let text = planning_assistant_text_from_response(&body);
    parse_sub_task_plans_from_llm_json(text)
}
