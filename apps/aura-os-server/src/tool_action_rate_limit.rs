//! Per-user/per-org rate limiter for platform-funded tool-actions (A-C1b).
//!
//! `POST /api/orgs/:org_id/tool-actions/:tool_name` dispatches platform-funded
//! provider calls (e.g. Brave web search) that cost real money per invocation.
//! Without a ceiling an authenticated member could loop the endpoint and rack
//! up unmetered platform cost. This module owns a small in-process fixed-window
//! limiter keyed on `(user_id, org_id)` so a single noisy caller cannot exhaust
//! the budget — and crucially cannot throttle a *different* user or org.
//!
//! The store mirrors `log_throttle`: a process-wide `DashMap` behind a
//! `OnceLock`. It is intentionally in-process (single-node) — distributed
//! enforcement is out of scope for this phase.
//!
//! ## Limit values (DECISION POINT — placeholder pending maintainer confirmation)
//! `MAX_CALLS_PER_WINDOW` / `WINDOW` below are conservative placeholders. They
//! MUST be confirmed with the maintainer before this ships to production; the
//! constants are marked so the value is easy to locate and change.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use dashmap::DashMap;

/// DECISION POINT (placeholder — confirm with maintainer): maximum number of
/// tool-action calls a single `(user_id, org_id)` may make within [`WINDOW`].
pub const MAX_CALLS_PER_WINDOW: u32 = 60;

/// DECISION POINT (placeholder — confirm with maintainer): the fixed window
/// over which [`MAX_CALLS_PER_WINDOW`] is counted.
pub const WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) struct ToolActionRateKey {
    pub user_id: String,
    pub org_id: String,
}

impl ToolActionRateKey {
    pub(crate) fn new(user_id: impl Into<String>, org_id: impl Into<String>) -> Self {
        Self {
            user_id: user_id.into(),
            org_id: org_id.into(),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct WindowState {
    window_start: Instant,
    count: u32,
}

fn registry() -> &'static DashMap<ToolActionRateKey, WindowState> {
    static REGISTRY: OnceLock<DashMap<ToolActionRateKey, WindowState>> = OnceLock::new();
    REGISTRY.get_or_init(DashMap::new)
}

/// Record one call for `key` and return `true` if it is allowed (under the
/// limit for the current window), `false` if it exceeds the limit.
pub(crate) fn check(key: ToolActionRateKey) -> bool {
    check_at(
        registry(),
        key,
        Instant::now(),
        MAX_CALLS_PER_WINDOW,
        WINDOW,
    )
}

fn check_at(
    map: &DashMap<ToolActionRateKey, WindowState>,
    key: ToolActionRateKey,
    now: Instant,
    max_calls: u32,
    window: Duration,
) -> bool {
    let mut entry = map.entry(key).or_insert(WindowState {
        window_start: now,
        count: 0,
    });
    if now.duration_since(entry.window_start) >= window {
        entry.window_start = now;
        entry.count = 0;
    }
    if entry.count >= max_calls {
        return false;
    }
    entry.count += 1;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_key(tag: &str) -> ToolActionRateKey {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        ToolActionRateKey::new(format!("user-{tag}-{nonce}"), format!("org-{tag}-{nonce}"))
    }

    #[test]
    fn under_limit_calls_pass_then_excess_blocks() {
        let map = DashMap::new();
        let key = fresh_key("limit");
        let now = Instant::now();
        for _ in 0..3 {
            assert!(check_at(&map, key.clone(), now, 3, Duration::from_secs(60)));
        }
        assert!(!check_at(&map, key, now, 3, Duration::from_secs(60)));
    }

    #[test]
    fn window_resets_after_elapsed() {
        let map = DashMap::new();
        let key = fresh_key("reset");
        let now = Instant::now();
        assert!(check_at(&map, key.clone(), now, 1, Duration::from_secs(60)));
        assert!(!check_at(
            &map,
            key.clone(),
            now,
            1,
            Duration::from_secs(60)
        ));
        let later = now + Duration::from_secs(60);
        assert!(check_at(&map, key, later, 1, Duration::from_secs(60)));
    }

    #[test]
    fn distinct_keys_are_independent() {
        let map = DashMap::new();
        let now = Instant::now();
        let key_a = ToolActionRateKey::new("user-a", "org-1");
        let key_b_other_user = ToolActionRateKey::new("user-b", "org-1");
        let key_a_other_org = ToolActionRateKey::new("user-a", "org-2");

        assert!(check_at(
            &map,
            key_a.clone(),
            now,
            1,
            Duration::from_secs(60)
        ));
        assert!(!check_at(&map, key_a, now, 1, Duration::from_secs(60)));
        // Same org, different user is unaffected.
        assert!(check_at(
            &map,
            key_b_other_user,
            now,
            1,
            Duration::from_secs(60)
        ));
        // Same user, different org is unaffected.
        assert!(check_at(
            &map,
            key_a_other_org,
            now,
            1,
            Duration::from_secs(60)
        ));
    }
}
