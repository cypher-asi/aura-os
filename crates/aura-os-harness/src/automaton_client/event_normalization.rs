const GENERIC_MILESTONE_EVENT_TYPES: &[&str] =
    &["milestone", "sync_milestone", "git_sync_milestone"];
const GIT_COMMITTED: &str = "git_committed";
const GIT_COMMIT_FAILED: &str = "git_commit_failed";
const GIT_PUSHED: &str = "git_pushed";
const GIT_PUSH_FAILED: &str = "git_push_failed";

fn canonical_git_event_type(value: &str) -> Option<&'static str> {
    match value {
        GIT_COMMITTED | "git_commit" | "commit" => Some(GIT_COMMITTED),
        GIT_COMMIT_FAILED | "git_commit_error" | "commit_failed" => Some(GIT_COMMIT_FAILED),
        GIT_PUSHED | "git_push" | "push" => Some(GIT_PUSHED),
        GIT_PUSH_FAILED | "git_push_error" | "push_failed" => Some(GIT_PUSH_FAILED),
        _ => None,
    }
}

fn is_git_like_payload(value: &serde_json::Value) -> bool {
    value.get("commit_sha").is_some()
        || value.get("branch").is_some()
        || value.get("remote").is_some()
        || value.get("push_id").is_some()
        || value.get("commits").is_some()
}

fn normalized_milestone_git_event(
    event: &serde_json::Value,
) -> Option<(&'static str, serde_json::Value)> {
    let mut candidates: Vec<serde_json::Value> = vec![event.clone()];
    for key in ["milestone", "sync", "git", "commit", "push"] {
        if let Some(value) = event.get(key) {
            candidates.push(value.clone());
        }
    }

    for candidate in &candidates {
        if let Some(kind) = candidate
            .get("event_type")
            .or_else(|| candidate.get("kind"))
            .or_else(|| candidate.get("type"))
            .and_then(|v| v.as_str())
            .and_then(canonical_git_event_type)
        {
            return Some((kind, candidate.clone()));
        }
    }

    for candidate in candidates {
        if !candidate.is_object() || !is_git_like_payload(&candidate) {
            continue;
        }
        if candidate.get("reason").is_some() || candidate.get("error").is_some() {
            if candidate.get("branch").is_some()
                || candidate.get("remote").is_some()
                || candidate.get("push_id").is_some()
            {
                return Some((GIT_PUSH_FAILED, candidate));
            }
            return Some((GIT_COMMIT_FAILED, candidate));
        }
        if candidate.get("branch").is_some()
            || candidate.get("remote").is_some()
            || candidate.get("push_id").is_some()
            || candidate.get("commits").is_some()
        {
            return Some((GIT_PUSHED, candidate));
        }
        if candidate.get("commit_sha").is_some() {
            return Some((GIT_COMMITTED, candidate));
        }
    }

    None
}

fn copy_if_missing(target: &mut serde_json::Value, source: &serde_json::Value, key: &str) {
    if target.get(key).is_none() {
        if let Some(value) = source.get(key) {
            target[key] = value.clone();
        }
    }
}

pub(super) fn normalize_automaton_event(mut event: serde_json::Value) -> serde_json::Value {
    let Some(event_type) = event.get("type").and_then(|t| t.as_str()) else {
        return event;
    };
    if !GENERIC_MILESTONE_EVENT_TYPES.contains(&event_type) {
        return event;
    }
    let Some((canonical_type, payload)) = normalized_milestone_git_event(&event) else {
        return event;
    };

    event["type"] = serde_json::Value::String(canonical_type.to_string());
    for key in [
        "commit_sha",
        "branch",
        "remote",
        "reason",
        "error",
        "summary",
        "push_id",
        "commit_ids",
        "commits",
    ] {
        copy_if_missing(&mut event, &payload, key);
    }
    event
}
