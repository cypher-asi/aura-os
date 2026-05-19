//! Git-push failure subclassification.
//!
//! `classify_push_failure` returns one of the stable labels the
//! dev-loop's push-handling code keys on (`push_timeout`,
//! `remote_storage_exhausted`, `push_failed`). Returning `None` means
//! the reason is not push-related at all and callers should fall
//! through to their generic failure path.

/// Classify a `task_failed` reason into one of the dev-loop's
/// push-failure subclasses, or `None` for non-push failures.
///
/// Returns one of:
///
/// * `Some("push_timeout")` — push timed out at the network layer.
/// * `Some("remote_storage_exhausted")` — remote ran out of space /
///   storage quota.
/// * `Some("push_failed")` — push-related but not one of the above
///   (rejected by a hook, remote refused, ...).
/// * `None` — not push-related.
pub fn classify_push_failure(reason: &str) -> Option<&'static str> {
    let reason = reason.to_ascii_lowercase();
    if !(reason.contains("push") || reason.contains("remote")) {
        return None;
    }
    if reason.contains("timeout") || reason.contains("timed out") {
        Some("push_timeout")
    } else if reason.contains("no space") || reason.contains("storage") || reason.contains("quota")
    {
        Some("remote_storage_exhausted")
    } else {
        Some("push_failed")
    }
}
