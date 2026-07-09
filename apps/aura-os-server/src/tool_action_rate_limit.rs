//! Per-user rate limiter for platform-funded Web Search (A-C1b).
//!
//! `POST /api/orgs/:org_id/tool-actions/brave_search_*` dispatches Aura's
//! platform-funded Web Search calls. Without a ceiling an authenticated member
//! could loop the endpoint and rack up unmetered platform cost. This module owns
//! a small in-process fixed-window limiter keyed on `(user_id, bucket)` so a
//! user's subscription allowance follows them across workspaces instead of
//! multiplying once per org. A noisy caller cannot throttle a different user
//! or future tool bucket.
//!
//! Each [`ToolActionRateLimiter`] owns a shared `DashMap` cloned with the
//! application state. It is intentionally in-process (single-node) —
//! distributed enforcement is out of scope for this phase.
//!
//! ## Limit values + rationale
//! Two fixed-window ceilings are enforced per user:
//! - [`MAX_CALLS_PER_WINDOW`] / [`WINDOW`]: a short burst ceiling (per minute).
//! - [`MAX_CALLS_PER_DAY`] / [`DAY_WINDOW`]: a slow-drip ceiling (per day) that
//!   bounds sustained low-rate abuse the per-minute window cannot catch.
//!
//! Rationale for the chosen values: Web Search is metered independently from the
//! LLM turn, so the defaults are intentionally conservative. Paid tiers get
//! larger search quotas, but the bucket stays separate from ordinary org tools
//! such as GitHub, Notion, and Slack.
//!
//! ## Multi-node caveat (accepted for this phase)
//! The store is intentionally in-process, so
//! with N server instances behind a load balancer the *effective* ceilings are
//! `MAX_CALLS_PER_WINDOW × N` and `MAX_CALLS_PER_DAY × N` (each node counts
//! independently). This is accepted for this phase: the metered LLM turn is the
//! primary cost control, and these limits are a secondary guard. A shared /
//! distributed counter (e.g. Redis) is a future follow-up if per-cluster
//! precision is ever required.

use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;

/// Burst ceiling: maximum Web Search calls a single user may
/// make within [`WINDOW`]. See the module docs for rationale + the multi-node
/// caveat (effective limit is this × instance-count).
pub const MAX_CALLS_PER_WINDOW: u32 = 5;

/// The fixed window over which [`MAX_CALLS_PER_WINDOW`] is counted.
pub const WINDOW: Duration = Duration::from_secs(60);

/// Daily ceiling: maximum Web Search calls a single user may
/// make within [`DAY_WINDOW`]. Bounds sustained low-rate abuse that stays under
/// the per-minute burst limit. Same per-node / multi-node caveat applies.
pub const MAX_CALLS_PER_DAY: u32 = 50;

/// The fixed window over which [`MAX_CALLS_PER_DAY`] is counted.
pub const DAY_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ToolActionRateLimits {
    pub max_calls_per_window: u32,
    pub window: Duration,
    pub max_calls_per_day: u32,
    pub day_window: Duration,
}

impl ToolActionRateLimits {
    pub(crate) const fn new(max_calls_per_window: u32, max_calls_per_day: u32) -> Self {
        Self {
            max_calls_per_window,
            window: WINDOW,
            max_calls_per_day,
            day_window: DAY_WINDOW,
        }
    }
}

pub(crate) const DEFAULT_LIMITS: ToolActionRateLimits =
    ToolActionRateLimits::new(MAX_CALLS_PER_WINDOW, MAX_CALLS_PER_DAY);
pub(crate) const PRO_LIMITS: ToolActionRateLimits = ToolActionRateLimits::new(15, 250);
pub(crate) const CRUSADER_LIMITS: ToolActionRateLimits = ToolActionRateLimits::new(30, 1_000);
pub(crate) const SAGE_LIMITS: ToolActionRateLimits = ToolActionRateLimits::new(60, 5_000);

pub(crate) fn limits_for_billing_plan(plan: Option<&str>) -> ToolActionRateLimits {
    match plan.map(normalize_plan_name).as_deref() {
        Some("sage") | Some("enterprise") => SAGE_LIMITS,
        Some("crusader") => CRUSADER_LIMITS,
        Some("pro") | Some("standard") => PRO_LIMITS,
        _ => DEFAULT_LIMITS,
    }
}

fn normalize_plan_name(plan: &str) -> String {
    plan.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) struct ToolActionRateKey {
    pub user_id: String,
    pub bucket: String,
}

impl ToolActionRateKey {
    pub(crate) fn new(user_id: impl Into<String>, bucket: impl Into<String>) -> Self {
        Self {
            user_id: user_id.into(),
            bucket: bucket.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RateLimitExceeded {
    pub max_calls: u32,
    pub window: Duration,
    pub retry_after: Duration,
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

#[derive(Clone, Default)]
pub struct ToolActionRateLimiter {
    registry: Arc<DashMap<ToolActionRateKey, RateState>>,
}

impl ToolActionRateLimiter {
    pub(crate) fn check_with_limits(
        &self,
        key: ToolActionRateKey,
        limits: ToolActionRateLimits,
    ) -> Result<(), RateLimitExceeded> {
        check_at(
            &self.registry,
            key,
            Instant::now(),
            limits.max_calls_per_window,
            limits.window,
            limits.max_calls_per_day,
            limits.day_window,
        )
    }
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
) -> Result<(), RateLimitExceeded> {
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

    // Prefer reporting the daily ceiling when both are exhausted so clients do
    // not retry after one minute when the real reset is much later. Rejected
    // calls consume neither window.
    if entry.day.count >= max_per_day {
        return Err(RateLimitExceeded {
            max_calls: max_per_day,
            window: day_window,
            retry_after: day_window.saturating_sub(now.duration_since(entry.day.window_start)),
        });
    }
    if entry.minute.count >= max_per_minute {
        return Err(RateLimitExceeded {
            max_calls: max_per_minute,
            window: minute_window,
            retry_after: minute_window
                .saturating_sub(now.duration_since(entry.minute.window_start)),
        });
    }

    entry.minute.count += 1;
    entry.day.count += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_key(tag: &str) -> ToolActionRateKey {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        ToolActionRateKey::new(format!("user-{tag}-{nonce}"), "web_search")
    }

    const MIN: Duration = Duration::from_secs(60);
    const DAY: Duration = Duration::from_secs(24 * 60 * 60);

    #[test]
    fn billing_plans_resolve_to_higher_limit_profiles() {
        assert_eq!(limits_for_billing_plan(None), DEFAULT_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("mortal")), DEFAULT_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("free")), DEFAULT_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Pro")), PRO_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("standard")), PRO_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Crusader")), CRUSADER_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Sage")), SAGE_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Enterprise")), SAGE_LIMITS);
    }

    #[test]
    fn under_limit_calls_pass_then_excess_blocks() {
        let map = DashMap::new();
        let key = fresh_key("limit");
        let now = Instant::now();
        // Day ceiling high so the minute ceiling is the one under test.
        for _ in 0..3 {
            assert!(check_at(&map, key.clone(), now, 3, MIN, 1000, DAY).is_ok());
        }
        let exceeded = check_at(&map, key, now, 3, MIN, 1000, DAY).unwrap_err();
        assert_eq!(exceeded.max_calls, 3);
        assert_eq!(exceeded.window, MIN);
        assert_eq!(exceeded.retry_after, MIN);
    }

    #[test]
    fn window_resets_after_elapsed() {
        let map = DashMap::new();
        let key = fresh_key("reset");
        let now = Instant::now();
        assert!(check_at(&map, key.clone(), now, 1, MIN, 1000, DAY).is_ok());
        assert!(check_at(&map, key.clone(), now, 1, MIN, 1000, DAY).is_err());
        let later = now + MIN;
        assert!(check_at(&map, key, later, 1, MIN, 1000, DAY).is_ok());
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
            assert!(check_at(&map, key.clone(), now, 100, MIN, max_per_day, DAY).is_ok());
            now += MIN;
        }
        // Day ceiling reached; still within the same day window → blocked.
        let exceeded = check_at(&map, key.clone(), now, 100, MIN, max_per_day, DAY).unwrap_err();
        assert_eq!(exceeded.max_calls, max_per_day);
        assert_eq!(exceeded.window, DAY);
        assert_eq!(exceeded.retry_after, DAY - (MIN * max_per_day));

        // After the day window elapses, calls are allowed again.
        let next_day = now + DAY;
        assert!(check_at(&map, key, next_day, 100, MIN, max_per_day, DAY).is_ok());
    }

    #[test]
    fn rejected_call_does_not_consume_the_other_window() {
        // If the minute window is exhausted, a rejected call must not burn a
        // day-window slot (and vice versa).
        let map = DashMap::new();
        let key = fresh_key("no-double-count");
        let now = Instant::now();
        // Exhaust the minute window (limit 1); day limit generous.
        assert!(check_at(&map, key.clone(), now, 1, MIN, 1000, DAY).is_ok());
        // Next call rejected by the minute ceiling.
        assert!(check_at(&map, key.clone(), now, 1, MIN, 1000, DAY).is_err());
        // After the minute rolls over, we should still have 999 day slots left
        // (only one successful call was ever counted), so 999 more succeed.
        let later = now + MIN;
        for _ in 0..999 {
            assert!(check_at(&map, key.clone(), later, 1000, MIN, 1000, DAY).is_ok());
        }
        // The 1000th day slot is now used; the next is blocked by the day cap.
        assert!(check_at(&map, key, later, 1000, MIN, 1000, DAY).is_err());
    }

    #[test]
    fn distinct_keys_are_independent() {
        let map = DashMap::new();
        let now = Instant::now();
        let key_a = ToolActionRateKey::new("user-a", "web_search");
        let key_b_other_user = ToolActionRateKey::new("user-b", "web_search");
        let key_a_other_bucket = ToolActionRateKey::new("user-a", "other_tool");

        assert!(check_at(&map, key_a.clone(), now, 1, MIN, 1000, DAY).is_ok());
        assert!(check_at(&map, key_a, now, 1, MIN, 1000, DAY).is_err());
        // Different users and future tool buckets remain independent.
        assert!(check_at(&map, key_b_other_user, now, 1, MIN, 1000, DAY).is_ok());
        assert!(check_at(&map, key_a_other_bucket, now, 1, MIN, 1000, DAY).is_ok());
    }
}
