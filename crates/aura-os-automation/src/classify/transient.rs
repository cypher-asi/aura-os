//! String classifiers for transient vs. terminal failure reasons.
//!
//! Every helper takes a borrowed `&str`, lower-cases it once, and
//! returns a `bool`. They are deliberately heuristic: providers vary
//! how they word the same underlying condition, so we accept false
//! positives over false negatives — the cost of an unnecessary retry
//! is one extra LLM call, while a missed retry can kill a long task.
//!
//! These helpers were promoted from the server-side
//! `signals::*_for_tests` shims as part of Phase G1; the test-suffixed
//! wrappers in `apps/aura-os-server/src/handlers/dev_loop/signals.rs`
//! now delegate here.

/// True when `reason` looks like a provider rate-limit or overload
/// response (HTTP 429 / 529, "overloaded", "rate_limited").
pub fn is_rate_limited(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("rate limit")
        || reason.contains("rate_limited")
        || reason.contains("429")
        || reason.contains("529")
        || reason.contains("overloaded")
}

/// True when `reason` indicates the provider rejected work because the
/// account has no remaining credits.
///
/// Terminal for dev loops: retrying or moving to the next task only
/// burns build/setup time.
pub fn is_insufficient_credits(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("insufficient credits")
        || reason.contains("insufficient_credits")
        || reason.contains("payment_required")
        || reason.contains("402 payment required")
        || (reason.contains("402") && reason.contains("payment required"))
}

/// True when `reason` looks like a transient git-push timeout.
///
/// The dev-loop treats these as non-fatal: a commit already exists
/// locally, so the task can still be marked done.
pub fn is_git_push_timeout(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("git")
        && reason.contains("push")
        && (reason.contains("timeout") || reason.contains("timed out"))
}

/// True when `reason` is classified as a transient provider internal
/// error (5xx, stream aborted, connection reset).
pub fn is_provider_internal(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("internal server error")
        || reason.contains(" 500")
        || reason.contains(" 502")
        || reason.contains(" 503")
        || reason.contains(" 504")
        || reason.contains("stream terminated")
        || reason.contains("connection reset by peer")
}

/// True when `reason` *looks* transient but the classifiers above did
/// not match it — the safety net that drives the `debug.retry_miss`
/// trigger condition.
///
/// Excludes anything already caught by [`is_rate_limited`] or
/// [`is_provider_internal`] so the safety net does not double-count.
pub fn looks_like_unclassified_transient(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    [
        "timeout",
        "temporar",
        "connection reset",
        "econnreset",
        "dns lookup failed",
        "tls handshake",
        "socket hang up",
        "unavailable",
        "try again",
    ]
    .iter()
    .any(|needle| reason.contains(needle))
        && !is_rate_limited(&reason)
        && !is_provider_internal(&reason)
}

/// True when `reason` is a terminal agent-side anti-waste signal from
/// the harness ("appears stuck", consecutive-error guard, "stopping to
/// prevent waste"). The error-event handler uses this to skip the
/// restart path because restarting a harness that has already decided
/// to stop just tight-loops on a WS reconnect.
pub fn is_agent_stuck_terminal_signal(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("appears stuck")
        || reason.contains("agent is stuck")
        || reason.contains("consecutive error")
        || reason.contains("consecutive failure")
        || reason.contains("all tool calls have returned errors")
        || reason.contains("prevent waste")
        || reason.contains("conserve budget")
}
