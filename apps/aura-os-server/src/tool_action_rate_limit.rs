//! In-process per-user quota enforcement for Aura-funded Web Search.
//!
//! Minute and daily fixed windows apply across all of a user's orgs. Because
//! counters are process-local, production must remain single-instance until the
//! quota store moves to shared infrastructure.

use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;

pub const MORTAL_CALLS_PER_MINUTE: u32 = 5;
const MINUTE_WINDOW: Duration = Duration::from_secs(60);
const MORTAL_CALLS_PER_DAY: u32 = 50;
const DAILY_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WebSearchRateLimits {
    pub calls_per_minute: u32,
    pub calls_per_day: u32,
}

impl WebSearchRateLimits {
    pub(crate) const fn new(calls_per_minute: u32, calls_per_day: u32) -> Self {
        Self {
            calls_per_minute,
            calls_per_day,
        }
    }
}

pub(crate) const MORTAL_LIMITS: WebSearchRateLimits =
    WebSearchRateLimits::new(MORTAL_CALLS_PER_MINUTE, MORTAL_CALLS_PER_DAY);
pub(crate) const PRO_LIMITS: WebSearchRateLimits = WebSearchRateLimits::new(15, 250);
pub(crate) const CRUSADER_LIMITS: WebSearchRateLimits = WebSearchRateLimits::new(30, 1_000);
pub(crate) const SAGE_LIMITS: WebSearchRateLimits = WebSearchRateLimits::new(60, 5_000);

pub(crate) fn limits_for_billing_plan(plan: Option<&str>) -> WebSearchRateLimits {
    match plan.map(normalize_plan_name).as_deref() {
        Some("sage") | Some("enterprise") => SAGE_LIMITS,
        Some("crusader") => CRUSADER_LIMITS,
        Some("pro") | Some("standard") => PRO_LIMITS,
        _ => MORTAL_LIMITS,
    }
}

fn normalize_plan_name(plan: &str) -> String {
    plan.trim().to_ascii_lowercase()
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

#[derive(Clone, Copy, Debug)]
struct RateState {
    minute: WindowState,
    day: WindowState,
}

#[derive(Clone, Default)]
pub struct WebSearchRateLimiter {
    registry: Arc<DashMap<String, RateState>>,
}

impl WebSearchRateLimiter {
    pub(crate) fn check_with_limits(
        &self,
        user_id: String,
        limits: WebSearchRateLimits,
    ) -> Result<(), RateLimitExceeded> {
        check_at(&self.registry, user_id, Instant::now(), limits)
    }
}

fn check_at(
    map: &DashMap<String, RateState>,
    user_id: String,
    now: Instant,
    limits: WebSearchRateLimits,
) -> Result<(), RateLimitExceeded> {
    let mut entry = map.entry(user_id).or_insert(RateState {
        minute: WindowState::fresh(now),
        day: WindowState::fresh(now),
    });

    if now.duration_since(entry.minute.window_start) >= MINUTE_WINDOW {
        entry.minute = WindowState::fresh(now);
    }
    if now.duration_since(entry.day.window_start) >= DAILY_WINDOW {
        entry.day = WindowState::fresh(now);
    }

    // Prefer reporting the daily ceiling when both are exhausted so clients do
    // not retry after one minute when the real reset is much later. Rejected
    // calls consume neither window.
    if entry.day.count >= limits.calls_per_day {
        return Err(RateLimitExceeded {
            max_calls: limits.calls_per_day,
            window: DAILY_WINDOW,
            retry_after: DAILY_WINDOW.saturating_sub(now.duration_since(entry.day.window_start)),
        });
    }
    if entry.minute.count >= limits.calls_per_minute {
        return Err(RateLimitExceeded {
            max_calls: limits.calls_per_minute,
            window: MINUTE_WINDOW,
            retry_after: MINUTE_WINDOW
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

    #[test]
    fn billing_plans_resolve_to_higher_limit_profiles() {
        assert_eq!(limits_for_billing_plan(None), MORTAL_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("mortal")), MORTAL_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("free")), MORTAL_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Pro")), PRO_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("standard")), PRO_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Crusader")), CRUSADER_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Sage")), SAGE_LIMITS);
        assert_eq!(limits_for_billing_plan(Some("Enterprise")), SAGE_LIMITS);
    }

    #[test]
    fn under_limit_calls_pass_then_excess_blocks() {
        let map = DashMap::new();
        let now = Instant::now();
        let limits = WebSearchRateLimits::new(3, 100);
        for _ in 0..3 {
            assert!(check_at(&map, "user".to_string(), now, limits).is_ok());
        }
        let exceeded = check_at(&map, "user".to_string(), now, limits).unwrap_err();
        assert_eq!(exceeded.max_calls, 3);
        assert_eq!(exceeded.window, MINUTE_WINDOW);
        assert_eq!(exceeded.retry_after, MINUTE_WINDOW);
    }

    #[test]
    fn window_resets_after_elapsed() {
        let map = DashMap::new();
        let now = Instant::now();
        let limits = WebSearchRateLimits::new(1, 100);
        assert!(check_at(&map, "user".to_string(), now, limits).is_ok());
        assert!(check_at(&map, "user".to_string(), now, limits).is_err());
        assert!(check_at(&map, "user".to_string(), now + MINUTE_WINDOW, limits).is_ok());
    }

    #[test]
    fn daily_cap_blocks_even_when_minute_window_keeps_resetting() {
        let map = DashMap::new();
        let mut now = Instant::now();
        let limits = WebSearchRateLimits::new(1, 3);
        for _ in 0..limits.calls_per_day {
            assert!(check_at(&map, "user".to_string(), now, limits).is_ok());
            now += MINUTE_WINDOW;
        }
        let exceeded = check_at(&map, "user".to_string(), now, limits).unwrap_err();
        assert_eq!(exceeded.max_calls, limits.calls_per_day);
        assert_eq!(exceeded.window, DAILY_WINDOW);
        assert_eq!(
            exceeded.retry_after,
            DAILY_WINDOW - (MINUTE_WINDOW * limits.calls_per_day)
        );

        assert!(check_at(&map, "user".to_string(), now + DAILY_WINDOW, limits).is_ok());
    }

    #[test]
    fn rejected_call_does_not_consume_the_other_window() {
        let map = DashMap::new();
        let now = Instant::now();
        let limits = WebSearchRateLimits::new(1, 3);
        assert!(check_at(&map, "user".to_string(), now, limits).is_ok());
        assert!(check_at(&map, "user".to_string(), now, limits).is_err());

        let second_minute = now + MINUTE_WINDOW;
        assert!(check_at(&map, "user".to_string(), second_minute, limits).is_ok());
        let third_minute = second_minute + MINUTE_WINDOW;
        assert!(check_at(&map, "user".to_string(), third_minute, limits).is_ok());
        assert!(check_at(&map, "user".to_string(), third_minute, limits).is_err());
    }

    #[test]
    fn users_have_independent_quotas() {
        let map = DashMap::new();
        let now = Instant::now();
        let limits = WebSearchRateLimits::new(1, 100);

        assert!(check_at(&map, "user-a".to_string(), now, limits).is_ok());
        assert!(check_at(&map, "user-a".to_string(), now, limits).is_err());
        assert!(check_at(&map, "user-b".to_string(), now, limits).is_ok());
    }
}
