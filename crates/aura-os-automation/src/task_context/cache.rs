//! Bounded `(TaskId, version)`-keyed cache for [`super::TaskContext`]
//! payloads.
//!
//! The cache is intentionally simple: a `Mutex<IndexMap<...>>` where
//! the insertion order doubles as the eviction order. We do not need
//! true LRU semantics because the call site is always "an agent
//! turn just asked for one task's context" — the working set is
//! tiny (a handful of tasks per run). Capping at
//! [`MAX_CACHE_ENTRIES`] is enough to prevent unbounded growth on a
//! long-lived server while keeping the hot keys resident.
//!
//! Versioning is supplied by the caller (typically the storage row's
//! `updated_at` timestamp folded into a `u64`); a bump on the
//! underlying task automatically invalidates the cache because the
//! key changes.

use std::sync::{Arc, Mutex};

use aura_os_core::TaskId;
use indexmap::IndexMap;

use super::resolver::TaskContext;

/// Soft cap on resident entries before the oldest-by-insertion is
/// dropped. Sized to comfortably hold the working set of an active
/// dev-loop run (per-task + dependencies + recently-completed
/// neighbours) without growing indefinitely on a server that has
/// served thousands of distinct tasks since boot.
pub const MAX_CACHE_ENTRIES: usize = 128;

/// Composite key the cache uses to invalidate stale entries when a
/// task's `updated_at` (or any monotone-per-task counter) bumps.
type CacheKey = (TaskId, u64);

/// Inner shared map. Owning the alias here keeps the
/// `Arc<Mutex<IndexMap<...>>>` field type inside the
/// `clippy::type-complexity` ceiling.
type CacheMap = IndexMap<CacheKey, Arc<TaskContext>>;

/// Bounded cache mapping `(TaskId, task_version)` to a shared
/// [`TaskContext`] payload.
///
/// All public methods take `&self`; cloning is cheap (it bumps the
/// inner [`Arc`]). Suitable for stashing on `AppState` as a
/// per-process singleton.
#[derive(Debug, Clone, Default)]
pub struct TaskContextCache {
    inner: Arc<Mutex<CacheMap>>,
}

impl TaskContextCache {
    /// Construct a fresh empty cache.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Look up a cached entry. Returns the shared `Arc` so the
    /// caller can serialize without copying the inner struct.
    #[must_use]
    pub fn get(&self, task_id: TaskId, version: u64) -> Option<Arc<TaskContext>> {
        let guard = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.get(&(task_id, version)).cloned()
    }

    /// Insert a fresh entry. If the resulting size exceeds
    /// [`MAX_CACHE_ENTRIES`] the oldest entry by insertion order is
    /// evicted. Re-inserting an existing key updates the value
    /// in-place without changing eviction order — the caller has
    /// already paid the fetch cost so we treat the entry as fresh.
    pub fn insert(&self, task_id: TaskId, version: u64, context: Arc<TaskContext>) {
        let mut guard = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.insert((task_id, version), context);
        while guard.len() > MAX_CACHE_ENTRIES {
            // `shift_remove_index(0)` keeps the remaining order
            // stable so the next eviction picks the next-oldest
            // entry, which is the FIFO contract documented in the
            // module-level doc.
            guard.shift_remove_index(0);
        }
    }

    /// Number of resident entries. Lock-protected; intended for
    /// tests and metrics, not hot-path usage.
    #[must_use]
    pub fn len(&self) -> usize {
        match self.inner.lock() {
            Ok(guard) => guard.len(),
            Err(poisoned) => poisoned.into_inner().len(),
        }
    }

    /// `true` when no entries are resident. See [`Self::len`].
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
