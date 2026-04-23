//! Process-wide cooldown guard for orbit "no space left on device"
//! failures.
//!
//! Background: when orbit (`https://orbit-sfvu.onrender.com`, a remote
//! git-hosting service) hits `ENOSPC` on its filesystem, a `git push`
//! reaches the client as:
//!
//! ```text
//! remote: fatal: write error: No space left on device
//! error: remote unpack failed: index-pack abnormal exit
//! error: RPC failed; curl 18 transfer closed with outstanding read data remaining
//! ```
//!
//! The harness wraps that as `Commit+push failed: remote storage
//! exhausted on git push...`, [`crate::handlers::dev_loop::classify_push_failure`]
//! maps it to [`PushFailureClass::RemoteStorageExhausted`], and the
//! task completes via the `push_deferred` path.
//!
//! Without backpressure, every retry pushes another pack at orbit's
//! already-full rootfs, leaves another quarantine/tmp_pack_* directory
//! behind, and makes the next push more likely to fail — that is why
//! "this keeps happening".
//!
//! This guard gives the event forwarder a single flip to say
//! "orbit reported ENOSPC for <base_url> at <Instant>", plus a
//! cheap lookup to ask "are we still inside the cooldown window?".
//! The emitted `push_deferred` event carries the remaining cooldown
//! so the UI can tell the user when retries will resume.
//!
//! [`PushFailureClass::RemoteStorageExhausted`]: crate::handlers::dev_loop
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;

/// Default cooldown after an orbit ENOSPC failure.
///
/// Long enough that a human can notice + free space on orbit before
/// retries resume, short enough that a transient disk pressure event
/// doesn't block push for the rest of the day. Tunable via
/// `AURA_ORBIT_ENOSPC_COOLDOWN_SECS` in [`OrbitCapacityGuard::from_env`].
const DEFAULT_COOLDOWN: Duration = Duration::from_secs(15 * 60);

/// Abstraction over `Instant::now()` so cooldown tests can advance
/// time deterministically instead of sleeping.
pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

/// Production clock: delegates straight to [`Instant::now`].
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Per-orbit-host ENOSPC cooldown tracker.
///
/// Keyed by the orbit `base_url` (e.g. `https://orbit-sfvu.onrender.com`)
/// so multi-orbit deployments don't penalise one orbit for another's
/// storage pressure. Values are the `Instant` the most recent ENOSPC
/// was observed; the guard is tripped if
/// `now - tripped_at < cooldown`.
pub struct OrbitCapacityGuard {
    tripped_at: RwLock<HashMap<String, Instant>>,
    cooldown: Duration,
    clock: Arc<dyn Clock>,
}

impl OrbitCapacityGuard {
    /// Build a guard with [`DEFAULT_COOLDOWN`] and the wall clock.
    pub fn new() -> Self {
        Self::with_config(DEFAULT_COOLDOWN, Arc::new(SystemClock))
    }

    /// Build a guard using `AURA_ORBIT_ENOSPC_COOLDOWN_SECS` when set
    /// (non-empty, parses as `u64`). Setting it to `0` effectively
    /// disables the cooldown: every check returns `None` because
    /// `now - tripped_at` is always `>= 0`.
    pub fn from_env() -> Self {
        let cooldown = std::env::var("AURA_ORBIT_ENOSPC_COOLDOWN_SECS")
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(DEFAULT_COOLDOWN);
        Self::with_config(cooldown, Arc::new(SystemClock))
    }

    /// Construct with an explicit cooldown and clock. Primarily exposed
    /// for tests that need a frozen `FakeClock`.
    pub fn with_config(cooldown: Duration, clock: Arc<dyn Clock>) -> Self {
        Self {
            tripped_at: RwLock::new(HashMap::new()),
            cooldown,
            clock,
        }
    }

    /// Record that orbit just reported ENOSPC (or another
    /// remote-storage-exhausted class) for the host `base_url` points
    /// at. Subsequent callers within the cooldown window will see
    /// [`Self::cooldown_remaining`] return `Some(_)`.
    pub async fn trip(&self, base_url: &str) {
        let key = normalize_base_url(base_url);
        let mut guard = self.tripped_at.write().await;
        guard.insert(key, self.clock.now());
    }

    /// Returns the remaining cooldown when `base_url` is currently
    /// gated, or `None` when the host is free to push.
    ///
    /// Also eagerly expires stale entries so the map doesn't grow
    /// unboundedly across long-running processes that rotate between
    /// many orbit hosts.
    pub async fn cooldown_remaining(&self, base_url: &str) -> Option<Duration> {
        let key = normalize_base_url(base_url);
        let now = self.clock.now();
        {
            let guard = self.tripped_at.read().await;
            if let Some(&tripped) = guard.get(&key) {
                if let Some(remaining) = self
                    .cooldown
                    .checked_sub(now.saturating_duration_since(tripped))
                {
                    if !remaining.is_zero() {
                        return Some(remaining);
                    }
                }
            } else {
                return None;
            }
        }
        let mut guard = self.tripped_at.write().await;
        guard.remove(&key);
        None
    }

    /// Explicitly clear the cooldown for `base_url`. Called when a
    /// successful push lands for that host so the next push is never
    /// gated by a stale ENOSPC record.
    pub async fn clear(&self, base_url: &str) {
        let key = normalize_base_url(base_url);
        let mut guard = self.tripped_at.write().await;
        guard.remove(&key);
    }

    /// Exposed for metrics / debug endpoints.
    pub fn cooldown(&self) -> Duration {
        self.cooldown
    }
}

impl Default for OrbitCapacityGuard {
    fn default() -> Self {
        Self::new()
    }
}

/// Normalise an orbit base URL so the guard is keyed consistently
/// regardless of trailing slashes or case differences between callers
/// (a project row may carry `https://orbit.example.com/`, while the
/// `ORBIT_BASE_URL` env value may be stored without the trailing
/// slash).
fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    trimmed.to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Frozen clock whose `now()` returns an `Instant` the test can
    /// advance explicitly. Built on top of an anchor `Instant` captured
    /// at construction because `Instant` cannot be synthesised from a
    /// raw seconds offset in stable Rust.
    struct FakeClock {
        anchor: Instant,
        offset: Mutex<Duration>,
    }

    impl FakeClock {
        fn new() -> Self {
            Self {
                anchor: Instant::now(),
                offset: Mutex::new(Duration::ZERO),
            }
        }

        fn advance(&self, by: Duration) {
            let mut slot = self.offset.lock().unwrap();
            *slot += by;
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            let offset = *self.offset.lock().unwrap();
            self.anchor + offset
        }
    }

    #[tokio::test]
    async fn untripped_guard_returns_no_cooldown() {
        let guard = OrbitCapacityGuard::new();
        assert!(guard
            .cooldown_remaining("https://orbit.example.com")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn tripped_guard_reports_remaining_cooldown_until_window_closes() {
        let clock = Arc::new(FakeClock::new());
        let guard =
            OrbitCapacityGuard::with_config(Duration::from_secs(60), clock.clone() as Arc<_>);

        guard.trip("https://orbit.example.com").await;

        // Immediately after tripping the full cooldown is reported.
        let remaining = guard
            .cooldown_remaining("https://orbit.example.com")
            .await
            .expect("cooldown must be active");
        assert!(remaining <= Duration::from_secs(60));
        assert!(remaining > Duration::from_secs(59));

        // Halfway through, remaining drops proportionally.
        clock.advance(Duration::from_secs(30));
        let remaining = guard
            .cooldown_remaining("https://orbit.example.com")
            .await
            .expect("cooldown still active at t=30s");
        assert!(remaining <= Duration::from_secs(30));

        // After the full window elapses the guard auto-clears.
        clock.advance(Duration::from_secs(31));
        assert!(
            guard
                .cooldown_remaining("https://orbit.example.com")
                .await
                .is_none(),
            "cooldown must expire at t >= cooldown"
        );
    }

    #[tokio::test]
    async fn guard_is_keyed_per_host_and_normalizes_trailing_slash_and_case() {
        let guard = OrbitCapacityGuard::new();

        guard.trip("https://Orbit.Example.com/").await;

        // Same host with different casing / trailing slash still hits
        // the gated entry.
        assert!(guard
            .cooldown_remaining("https://orbit.example.com")
            .await
            .is_some());

        // A sibling orbit is untouched.
        assert!(guard
            .cooldown_remaining("https://other-orbit.example.com")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn clear_removes_existing_cooldown() {
        let guard = OrbitCapacityGuard::new();
        guard.trip("https://orbit.example.com").await;
        assert!(guard
            .cooldown_remaining("https://orbit.example.com")
            .await
            .is_some());
        guard.clear("https://orbit.example.com").await;
        assert!(guard
            .cooldown_remaining("https://orbit.example.com")
            .await
            .is_none());
    }
}
