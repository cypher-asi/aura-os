//! `task_failed` event metadata extraction: pulls provider/model/sse-error/message-id fields out of the harness event (and the trailing reason string when needed).

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TaskFailureContext {
    pub(crate) provider_request_id: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) sse_error_type: Option<String>,
    pub(crate) message_id: Option<String>,
}

impl TaskFailureContext {
    pub(crate) fn has_any(&self) -> bool {
        self.provider_request_id.is_some()
            || self.model.is_some()
            || self.sse_error_type.is_some()
            || self.message_id.is_some()
    }

    pub(crate) fn merge_into(&self, obj: &mut serde_json::Map<String, serde_json::Value>) {
        if let Some(ref v) = self.provider_request_id {
            obj.insert(
                "provider_request_id".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(ref v) = self.model {
            obj.insert("model".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(ref v) = self.sse_error_type {
            obj.insert(
                "sse_error_type".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(ref v) = self.message_id {
            obj.insert("message_id".into(), serde_json::Value::String(v.clone()));
        }
    }
}

pub(crate) fn extract_task_failure_context(
    event: &serde_json::Value,
    reason: Option<&str>,
) -> TaskFailureContext {
    let mut ctx = TaskFailureContext::default();

    let read_str = |key: &str| -> Option<String> {
        event
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };

    ctx.provider_request_id = read_str("provider_request_id").or_else(|| read_str("request_id"));
    ctx.model = read_str("model");
    ctx.sse_error_type = read_str("sse_error_type").or_else(|| read_str("error_type"));
    ctx.message_id = read_str("message_id").or_else(|| read_str("msg_id"));

    if let Some(reason) = reason {
        let parsed = parse_failure_context_from_reason(reason);
        if ctx.provider_request_id.is_none() {
            ctx.provider_request_id = parsed.provider_request_id;
        }
        if ctx.model.is_none() {
            ctx.model = parsed.model;
        }
        if ctx.sse_error_type.is_none() {
            ctx.sse_error_type = parsed.sse_error_type;
        }
        if ctx.message_id.is_none() {
            ctx.message_id = parsed.message_id;
        }
    }

    ctx
}

fn parse_failure_context_from_reason(reason: &str) -> TaskFailureContext {
    let mut ctx = TaskFailureContext::default();

    if let (Some(open), Some(close)) = (reason.find('('), reason.find(')')) {
        if close > open {
            for raw in reason[open + 1..close].split(',') {
                let part = raw.trim();
                if let Some(value) = part.strip_prefix("model=") {
                    let value = value.trim();
                    if !value.is_empty() {
                        ctx.model = Some(value.to_string());
                    }
                } else if let Some(value) = part.strip_prefix("msg_id=") {
                    let value = value.trim();
                    if !value.is_empty() {
                        ctx.message_id = Some(value.to_string());
                    }
                } else if let Some(value) = part.strip_prefix("request_id=") {
                    let value = value.trim();
                    if !value.is_empty() {
                        ctx.provider_request_id = Some(value.to_string());
                    }
                }
            }
        }
    }

    if let Some(close) = reason.find(") :").or_else(|| reason.find("): ")) {
        let after = &reason[close + 2..];
        let after = after.trim_start_matches(|c: char| c == ':' || c.is_whitespace());
        if let Some(colon_idx) = after.find(':') {
            let candidate = after[..colon_idx].trim();
            if is_plausible_error_type(candidate) {
                ctx.sse_error_type = Some(candidate.to_string());
            }
        }
    }

    ctx
}

fn is_plausible_error_type(candidate: &str) -> bool {
    !candidate.is_empty()
        && candidate.len() <= 64
        && candidate
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}
