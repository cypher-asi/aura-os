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
//! ## Limit values + rationale
//! Two fixed-window ceilings are enforced per `(user_id, org_id)`:
//! - [`MAX_CALLS_PER_WINDOW`] / [`WINDOW`]: a short burst ceiling (per minute).
//! - [`MAX_CALLS_PER_DAY`] / [`DAY_WINDOW`]: a slow-drip ceiling (per day) that
//!   bounds sustained low-rate abuse the per-minute window cannot catch.
//!
//! Rationale for the chosen values: platform-funded tool-actions are almost
//! always driven by an agent turn, and each such turn is itself metered LLM
//! usage — that metering is the real backpressure against runaway spend. These
//! ceilings exist to bound the *direct* `/tool-actions/` call vector (a client
//! hitting the endpoint in a loop) and to cap the blast radius of a single
//! misbehaving caller; they are deliberately generous so they never throttle
//! legitimate agent activity.
//!
//! ## Multi-node caveat (accepted for this phase)
//! The store is intentionally in-process (a `DashMap` behind a `OnceLock`), so
//! with N server instances behind a load balancer the *effective* ceilings are
//! `MAX_CALLS_PER_WINDOW × N` and `MAX_CALLS_PER_DAY × N` (each node counts
//! independently). This is accepted for this phase: the metered LLM turn is the
//! primary cost control, and these limits are a secondary guard. A shared /
//! distributed counter (e.g. Redis) is a future follow-up if per-cluster
//! precision is ever required.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use dashmap::DashMap;

/// Burst ceiling: maximum tool-action calls a single `(user_id, org_id)` may
/// make within [`WINDOW`]. See the module docs for rationale + the multi-node
/// caveat (effective limit is this × instance-count).
pub const MAX_CALLS_PER_WINDOW: u32 = 60;

/// The fixed window over which [`MAX_CALLS_PER_WINDOW`] is counted.
pub const WINDOW: Duration = Duration::from_secs(60);

/// Daily ceiling: maximum tool-action calls a single `(user_id, org_id)` may
/// make within [`DAY_WINDOW`]. Bounds sustained low-rate abuse that stays under
/// the per-minute burst limit. Same per-node / multi-node caveat applies.
pub const MAX_CALLS_PER_DAY: u32 = 1000;

/// The fixed window over which [`MAX_CALLS_PER_DAY`] is counted.
pub const DAY_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

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

impl WindowState {
    fn fresh(now: Instant) -> Self {
        Self {
            window_start: now,
            count: 0,
        }
    }
}

/// Per-key state for both the minute and day fixed windows.
#[derive(Clone, Copy, Debug)]
struct RateState {
    minute: WindowState,
    day: WindowState,
}

fn registry() -> &'static DashMap<ToolActionRateKey, RateState> {
    static REGISTRY: OnceLock<DashMap<ToolActionRateKey, RateState>> = OnceLock::new();
    REGISTRY.get_or_init(DashMap::new)
}

/// Record one call for `key` and return `true` if it is allowed (under BOTH the
/// per-minute and per-day limits for the current windows), `false` if either
/// limit is exceeded.
pub(crate) fn check(key: ToolActionRateKey) -> bool {
    check_at(
        registry(),
        key,
        Instant::now(),
        MAX_CALLS_PER_WINDOW,
        WINDOW,
        MAX_CALLS_PER_DAY,
        DAY_WINDOW,
    )
}

#[allow(clippy::too_many_arguments)]
fn check_at(
    map: &DashMap<ToolActionRateKey, RateState>,
    key: ToolActionRateKey,
    now: Instant,
    max_per_minute: u32,
    minute_window: Duration,
    max_per_day: u32,
    day_window: Duration,
) -> bool {
    let mut entry = map.entry(key).or_insert(RateState {
        minute: WindowState::fresh(now),
        day: WindowState::fresh(now),
    });

    // Roll over each window independently if it has elapsed.
    if now.duration_since(entry.minute.window_start) >= minute_window {
        entry.minute = WindowState::fresh(now);
    }
    if now.duration_since(entry.day.window_start) >= day_window {
        entry.day = WindowState::fresh(now);
    }

    // Reject if EITHER ceiling is already reached; do not consume a slot from
    // the other window when we reject, so a rejected call is not double-counted.
    if entry.minute.count >= max_per_minute || entry.day.count >= max_per_day {
        return false;
    }

    entry.minute.count += 1;
    entry.day.count += 1;
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

    const MIN: Duration = Duration::from_secs(60);
    const DAY: Duration = Duration::from_secs(24 * 60 * 60);

    #[test]
    fn under_limit_calls_pass_then_excess_blocks() {
        let map = DashMap::new();
        let key = fresh_key("limit");
        let now = Instant::now();
        // Day ceiling high so the minute ceiling is the one under test.
        for _ in 0..3 {
            assert!(check_at(&map, key.clone(), now, 3, MIN, 1000, DAY));
        }
        assert!(!check_at(&map, key, now, 3, MIN, 1000, DAY));
    }

    #[test]
    fn window_resets_after_elapsed() {
        let map = DashMap::new();
        let key = fresh_key("reset");
        let now = Instant::now();
        assert!(check_at(&map, key.clone(), now, 1, MIN, 1000, DAY));
        assert!(!check_at(&map, key.clone(), now, 1, MIN, 1000, DAY));
        let later = now + MIN;
        assert!(check_at(&map, key, later, 1, MIN, 1000, DAY));
    }

    #[test]
    fn daily_cap_blocks_even_when_minute_window_keeps_resetting() {
        // Slow-drip abuse: stay under the per-minute burst by spacing calls one
        // minute apart, and confirm the daily ceiling still stops it.
        let map = DashMap::new();
        let key = fresh_key("daily");
        let mut now = Instant::now();
        let max_per_day = 3;
        for _ in 0..max_per_day {
            // Each call is in a fresh minute window, so the minute limit (high)
            // never trips — only the day counter accumulates.
            assert!(check_at(&map, key.clone(), now, 100, MIN, max_per_day, DAY));
            now += MIN;
        }
        // Day ceiling reached; still within the same day window → blocked.
        assert!(!check_at(
            &map,
            key.clone(),
            now,
            100,
            MIN,
            max_per_day,
            DAY
        ));

        // After the day window elapses, calls are allowed again.
        let next_day = now + DAY;
        assert!(check_at(&map, key, next_day, 100, MIN, max_per_day, DAY));
    }

    #[test]
    fn rejected_call_does_not_consume_the_other_window() {
        // If the minute window is exhausted, a rejected call must not burn a
        // day-window slot (and vice versa).
        let map = DashMap::new();
        let key = fresh_key("no-double-count");
        let now = Instant::now();
        // Exhaust the minute window (limit 1); day limit generous.
        assert!(check_at(&map, key.clone(), now, 1, MIN, 1000, DAY));
        // Next call rejected by the minute ceiling.
        assert!(!check_at(&map, key.clone(), now, 1, MIN, 1000, DAY));
        // After the minute rolls over, we should still have 999 day slots left
        // (only one successful call was ever counted), so 999 more succeed.
        let later = now + MIN;
        for _ in 0..999 {
            assert!(check_at(&map, key.clone(), later, 1000, MIN, 1000, DAY));
        }
        // The 1000th day slot is now used; the next is blocked by the day cap.
        assert!(!check_at(&map, key, later, 1000, MIN, 1000, DAY));
    }

    #[test]
    fn distinct_keys_are_independent() {
        let map = DashMap::new();
        let now = Instant::now();
        let key_a = ToolActionRateKey::new("user-a", "org-1");
        let key_b_other_user = ToolActionRateKey::new("user-b", "org-1");
        let key_a_other_org = ToolActionRateKey::new("user-a", "org-2");

        assert!(check_at(&map, key_a.clone(), now, 1, MIN, 1000, DAY));
        assert!(!check_at(&map, key_a, now, 1, MIN, 1000, DAY));
        // Same org, different user is unaffected.
        assert!(check_at(&map, key_b_other_user, now, 1, MIN, 1000, DAY));
        // Same user, different org is unaffected.
        assert!(check_at(&map, key_a_other_org, now, 1, MIN, 1000, DAY));
    }
}
