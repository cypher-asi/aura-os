//! Registry of active loops and their activity snapshots.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use dashmap::DashMap;
use thiserror::Error;
use tokio::sync::Mutex;

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_os_events::{
    DomainEvent, EventHub, LoopActivity, LoopActivityChanged, LoopId, LoopLifecycle, LoopStatus,
};

/// Minimum gap between successive `LoopActivityChanged` publishes from the
/// same loop when the underlying status is unchanged. Matches the 4 Hz
/// budget documented in the crate-level rustdoc. Status transitions and
/// terminal lifecycle events bypass the throttle.
const ACTIVITY_PUBLISH_INTERVAL: Duration = Duration::from_millis(250);

/// Errors produced by the loop registry.
#[derive(Debug, Error)]
pub enum LoopRegistryError {
    /// The requested loop id is not registered.
    #[error("loop not registered: {0}")]
    NotFound(String),
}

/// Lightweight snapshot used by `GET /api/loops` and tests.
#[derive(Clone, Debug)]
pub struct LoopSnapshot {
    /// Identity of the loop.
    pub loop_id: LoopId,
    /// Current activity state.
    pub activity: LoopActivity,
}

/// Per-loop tracking state stored in the registry.
struct LoopEntry {
    activity: LoopActivity,
    /// Mutex guards transitions so concurrent `record_*` calls publish
    /// events in a consistent order.
    write_lock: Arc<Mutex<()>>,
    /// Millis-since-epoch of the last published
    /// `LoopActivityChanged` event for this loop. Used by
    /// [`LoopHandle::transition`] to enforce the ~4 Hz publish budget
    /// when the status has not changed. Shared via `Arc` so the handle
    /// can update it without re-acquiring the DashMap write slot while
    /// holding `write_lock`.
    last_published_ms: Arc<AtomicI64>,
}

/// Registry of all active loops in the process.
///
/// Cheap to clone (`Arc`-backed); meant to live on `AppState`.
#[derive(Clone)]
pub struct LoopRegistry {
    inner: Arc<LoopRegistryInner>,
}

struct LoopRegistryInner {
    hub: EventHub,
    entries: DashMap<LoopId, LoopEntry>,
}

impl LoopRegistry {
    /// Build a registry that publishes activity events into `hub`.
    #[must_use]
    pub fn new(hub: EventHub) -> Self {
        Self {
            inner: Arc::new(LoopRegistryInner {
                hub,
                entries: DashMap::new(),
            }),
        }
    }

    /// Open a new loop. Inserts a `Starting` activity entry and emits
    /// a [`DomainEvent::LoopOpened`] to the hub.
    pub fn open(&self, loop_id: LoopId) -> LoopHandle {
        let now = Utc::now();
        let activity = LoopActivity::starting(now);
        // Seed `last_published_ms` with the open timestamp so that the
        // very first `transition` after `open()` publishes immediately
        // (the status will have changed from `Starting`), while also
        // giving the throttle a sensible baseline.
        let last_published_ms = Arc::new(AtomicI64::new(now.timestamp_millis()));
        self.inner.entries.insert(
            loop_id.clone(),
            LoopEntry {
                activity: activity.clone(),
                write_lock: Arc::new(Mutex::new(())),
                last_published_ms,
            },
        );
        self.inner
            .hub
            .publish(DomainEvent::LoopOpened(LoopLifecycle {
                loop_id: loop_id.clone(),
                activity,
                at: now,
            }));
        LoopHandle {
            registry: self.clone(),
            loop_id,
            closed: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Snapshot every loop matching the predicate. Used by
    /// `GET /api/loops` and aggregation selectors.
    #[must_use]
    pub fn snapshot_where<F>(&self, predicate: F) -> Vec<LoopSnapshot>
    where
        F: Fn(&LoopId) -> bool,
    {
        self.inner
            .entries
            .iter()
            .filter(|entry| predicate(entry.key()))
            .map(|entry| LoopSnapshot {
                loop_id: entry.key().clone(),
                activity: entry.value().activity.clone(),
            })
            .collect()
    }

    /// Snapshot of a single loop, if registered.
    #[must_use]
    pub fn snapshot_one(&self, loop_id: &LoopId) -> Option<LoopSnapshot> {
        self.inner.entries.get(loop_id).map(|entry| LoopSnapshot {
            loop_id: loop_id.clone(),
            activity: entry.value().activity.clone(),
        })
    }

    /// Total registered loops. Useful for tests / metrics.
    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.entries.len()
    }

    /// `true` when the registry has no live loops.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.entries.is_empty()
    }
}

/// RAII handle for a single registered loop.
///
/// Drop semantics: if the handle is dropped without an explicit
/// terminal call (`mark_completed` / `mark_failed` / `mark_cancelled`),
/// the loop is force-cancelled and a `LoopEnded` event with status
/// `Cancelled` is emitted. This prevents zombie loops in the UI when
/// a handler returns early.
///
/// Terminal methods (`mark_completed` / `mark_failed` /
/// `mark_cancelled`) take `&self` and use an atomic `closed` flag so
/// the handle can be shared across tasks (e.g. via `Arc<LoopHandle>`).
/// Calling a terminal method twice is a no-op after the first call.
pub struct LoopHandle {
    registry: LoopRegistry,
    loop_id: LoopId,
    closed: Arc<AtomicBool>,
}

impl LoopHandle {
    /// Identity of the loop this handle owns.
    #[must_use]
    pub fn loop_id(&self) -> &LoopId {
        &self.loop_id
    }

    /// Apply a transition closure to this loop's activity.
    ///
    /// Publishes a [`DomainEvent::LoopActivityChanged`] event after the
    /// closure runs, subject to a ~4 Hz per-loop throttle
    /// ([`ACTIVITY_PUBLISH_INTERVAL`]). The throttle is bypassed when:
    ///
    /// * the coarse [`LoopStatus`] changes (we never drop a status
    ///   transition — the UI spinner depends on it), or
    /// * the new status is terminal (transition is about to become a
    ///   `LoopEnded` anyway, so emit the final snapshot immediately).
    ///
    /// When a publish is suppressed the mutation is still applied to
    /// the stored `LoopActivity` and `last_event_at` is refreshed, so
    /// subsequent snapshots and watchdog checks see the latest state.
    pub async fn transition<F>(&self, mutator: F)
    where
        F: FnOnce(&mut LoopActivity),
    {
        let (lock, last_published_ms) = match self.registry.inner.entries.get(&self.loop_id) {
            Some(entry) => (
                entry.value().write_lock.clone(),
                entry.value().last_published_ms.clone(),
            ),
            None => return,
        };
        let _guard = lock.lock().await;
        let (snapshot, prev_status) = {
            let mut entry = match self.registry.inner.entries.get_mut(&self.loop_id) {
                Some(entry) => entry,
                None => return,
            };
            let prev_status = entry.value().activity.status;
            mutator(&mut entry.value_mut().activity);
            entry.value_mut().activity.touch(Utc::now());
            (entry.value().activity.clone(), prev_status)
        };

        let now_ms = Utc::now().timestamp_millis();
        let status_changed = snapshot.status != prev_status;
        let status_is_terminal = snapshot.status.is_terminal();
        let last_ms = last_published_ms.load(Ordering::Relaxed);
        let elapsed_ms = now_ms.saturating_sub(last_ms);
        let bypass = status_changed || status_is_terminal;
        if !bypass && elapsed_ms < ACTIVITY_PUBLISH_INTERVAL.as_millis() as i64 {
            return;
        }
        last_published_ms.store(now_ms, Ordering::Relaxed);
        self.registry
            .inner
            .hub
            .publish(DomainEvent::LoopActivityChanged(LoopActivityChanged {
                loop_id: self.loop_id.clone(),
                activity: snapshot,
            }));
    }

    /// Convenience: set the running status and an optional progress
    /// percent / step hint.
    pub async fn mark_running(&self, percent: Option<f32>, step: Option<String>) {
        self.transition(|activity| {
            activity.status = LoopStatus::Running;
            if let Some(p) = percent {
                activity.percent = Some(p.clamp(0.0, 1.0));
            }
            activity.current_step = step;
        })
        .await;
    }

    /// Convenience: mark this loop as awaiting a tool result.
    pub async fn mark_waiting_tool(&self, tool: &str) {
        let step = Some(format!("tool: {tool}"));
        self.transition(|activity| {
            activity.status = LoopStatus::WaitingTool;
            activity.current_step = step;
        })
        .await;
    }

    /// Convenience: bind a task id to this loop's activity.
    pub async fn set_current_task(&self, task_id: Option<TaskId>) {
        self.transition(|activity| {
            activity.current_task_id = task_id;
        })
        .await;
    }

    /// Mark this loop completed and remove it from the registry.
    pub async fn mark_completed(&self) {
        self.close_with(LoopStatus::Completed, Some(1.0)).await;
    }

    /// Mark this loop failed and remove it from the registry. The
    /// optional `reason` is embedded in the final `current_step` so
    /// UI tooltips can surface a short description of the failure.
    pub async fn mark_failed(&self, reason: Option<String>) {
        self.close_with_step(
            LoopStatus::Failed,
            None,
            reason.or_else(|| Some("failed".into())),
        )
        .await;
    }

    /// Mark this loop cancelled and remove it from the registry.
    pub async fn mark_cancelled(&self) {
        self.close_with(LoopStatus::Cancelled, None).await;
    }

    async fn close_with(&self, status: LoopStatus, percent: Option<f32>) {
        self.close_with_step(status, percent, None).await;
    }

    async fn close_with_step(
        &self,
        status: LoopStatus,
        percent: Option<f32>,
        step: Option<String>,
    ) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        let snapshot = {
            let mut entry = match self.registry.inner.entries.get_mut(&self.loop_id) {
                Some(entry) => entry,
                None => return,
            };
            entry.value_mut().activity.status = status;
            if let Some(p) = percent {
                entry.value_mut().activity.percent = Some(p);
            }
            if step.is_some() {
                entry.value_mut().activity.current_step = step;
            }
            entry.value_mut().activity.touch(Utc::now());
            entry.value().activity.clone()
        };
        self.registry.inner.entries.remove(&self.loop_id);
        self.registry
            .inner
            .hub
            .publish(DomainEvent::LoopEnded(LoopLifecycle {
                loop_id: self.loop_id.clone(),
                activity: snapshot,
                at: Utc::now(),
            }));
    }
}

impl Drop for LoopHandle {
    fn drop(&mut self) {
        // Only the LAST drop of the shared `closed` flag should trigger
        // the force-cancel path, otherwise each `Arc<LoopHandle>` clone
        // would race on close. `Arc::strong_count` on the inner flag
        // tells us if there is another reference still alive.
        if Arc::strong_count(&self.closed) > 1 {
            return;
        }
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some((_, entry)) = self.registry.inner.entries.remove(&self.loop_id) {
            let mut activity = entry.activity;
            activity.status = LoopStatus::Cancelled;
            activity.last_event_at = Utc::now();
            self.registry
                .inner
                .hub
                .publish(DomainEvent::LoopEnded(LoopLifecycle {
                    loop_id: self.loop_id.clone(),
                    activity,
                    at: Utc::now(),
                }));
            tracing::warn!(
                loop_id = self.loop_id.short(),
                "LoopHandle dropped without explicit terminal mark; treating as cancelled"
            );
        }
    }
}

/// Helper: build a predicate that matches loops belonging to `project`.
pub fn loops_in_project(project: ProjectId) -> impl Fn(&LoopId) -> bool {
    move |loop_id| loop_id.project_id == Some(project)
}

/// Helper: build a predicate that matches loops belonging to `instance`.
pub fn loops_in_instance(instance: AgentInstanceId) -> impl Fn(&LoopId) -> bool {
    move |loop_id| loop_id.agent_instance_id == Some(instance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentId, AgentInstanceId, ProjectId, UserId};
    use aura_os_events::{LoopKind, SubscriptionFilter, Topic};

    fn fresh_loop_id(project: ProjectId, instance: AgentInstanceId, kind: LoopKind) -> LoopId {
        LoopId::new(
            UserId::new(),
            Some(project),
            Some(instance),
            AgentId::new(),
            kind,
        )
    }

    #[tokio::test]
    async fn opening_a_loop_emits_loop_opened() {
        let hub = EventHub::new();
        let registry = LoopRegistry::new(hub.clone());
        let project = ProjectId::new();
        let (_g, mut rx) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
        let loop_id = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Chat);
        let _handle = registry.open(loop_id.clone());

        let evt = rx.recv().await.expect("opened");
        assert!(matches!(evt, DomainEvent::LoopOpened(p) if p.loop_id == loop_id));
        assert_eq!(registry.len(), 1);
    }

    #[tokio::test]
    async fn dropping_handle_without_terminal_publishes_cancelled() {
        let hub = EventHub::new();
        let registry = LoopRegistry::new(hub.clone());
        let project = ProjectId::new();
        let (_g, mut rx) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
        {
            let loop_id = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Automation);
            let _h = registry.open(loop_id);
        }
        let opened = rx.recv().await.unwrap();
        assert!(matches!(opened, DomainEvent::LoopOpened(_)));
        let ended = rx.recv().await.unwrap();
        match ended {
            DomainEvent::LoopEnded(p) => assert_eq!(p.activity.status, LoopStatus::Cancelled),
            other => panic!("expected LoopEnded, got {other:?}"),
        }
        assert_eq!(registry.len(), 0);
    }

    #[tokio::test]
    async fn transitions_publish_activity_changed() {
        let hub = EventHub::new();
        let registry = LoopRegistry::new(hub.clone());
        let project = ProjectId::new();
        let (_g, mut rx) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
        let handle = registry.open(fresh_loop_id(
            project,
            AgentInstanceId::new(),
            LoopKind::TaskRun,
        ));

        // Drain the LoopOpened.
        let _ = rx.recv().await;

        handle
            .mark_running(Some(0.25), Some("thinking".into()))
            .await;

        let evt = rx.recv().await.unwrap();
        match evt {
            DomainEvent::LoopActivityChanged(p) => {
                assert_eq!(p.activity.status, LoopStatus::Running);
                assert_eq!(p.activity.percent, Some(0.25));
                assert_eq!(p.activity.current_step.as_deref(), Some("thinking"));
            }
            other => panic!("expected LoopActivityChanged, got {other:?}"),
        }
        handle.mark_completed().await;
        let evt = rx.recv().await.unwrap();
        assert!(
            matches!(evt, DomainEvent::LoopEnded(p) if p.activity.status == LoopStatus::Completed)
        );
        assert_eq!(registry.len(), 0);
    }

    #[tokio::test]
    async fn transition_throttles_same_status_updates() {
        use std::time::Duration as StdDuration;

        let hub = EventHub::new();
        let registry = LoopRegistry::new(hub.clone());
        let project = ProjectId::new();
        let (_g, mut rx) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
        let handle = registry.open(fresh_loop_id(
            project,
            AgentInstanceId::new(),
            LoopKind::Chat,
        ));

        // Drain the LoopOpened.
        let _ = rx.recv().await;

        // First transition into Running: status changes, so it bypasses
        // the throttle and publishes immediately.
        handle
            .mark_running(Some(0.1), Some("thinking".into()))
            .await;
        let first = rx.recv().await.unwrap();
        assert!(matches!(first, DomainEvent::LoopActivityChanged(_)));

        // A burst of same-status transitions within the throttle window
        // should NOT publish more events.
        for i in 0..20 {
            handle
                .transition(|activity| {
                    activity.percent = Some(0.1 + (i as f32) * 0.01);
                })
                .await;
        }
        let drained = tokio::time::timeout(StdDuration::from_millis(50), rx.recv()).await;
        assert!(
            drained.is_err(),
            "throttle must suppress same-status updates within the 250ms window"
        );

        // A real status change (Running -> WaitingTool) must bypass the
        // throttle and publish immediately, even while we're still
        // inside the 250ms window.
        handle.mark_waiting_tool("read_file").await;
        let after_status_change = tokio::time::timeout(StdDuration::from_millis(50), rx.recv())
            .await
            .expect("status change must bypass throttle")
            .expect("event");
        match after_status_change {
            DomainEvent::LoopActivityChanged(p) => {
                assert_eq!(p.activity.status, LoopStatus::WaitingTool);
            }
            other => panic!("expected LoopActivityChanged, got {other:?}"),
        }

        // After the throttle window elapses, a same-status transition
        // publishes again.
        tokio::time::sleep(ACTIVITY_PUBLISH_INTERVAL + StdDuration::from_millis(50)).await;
        handle
            .transition(|activity| {
                activity.current_step = Some("tool: read_file (still)".into());
            })
            .await;
        let after_window = tokio::time::timeout(StdDuration::from_millis(100), rx.recv())
            .await
            .expect("throttle must release after window")
            .expect("event");
        assert!(matches!(after_window, DomainEvent::LoopActivityChanged(_)));

        handle.mark_completed().await;
        let end = rx.recv().await.unwrap();
        assert!(matches!(end, DomainEvent::LoopEnded(_)));
    }

    #[tokio::test]
    async fn snapshot_filters_by_project() {
        let hub = EventHub::new();
        let registry = LoopRegistry::new(hub);
        let p1 = ProjectId::new();
        let p2 = ProjectId::new();
        let l1 = registry.open(fresh_loop_id(p1, AgentInstanceId::new(), LoopKind::Chat));
        let _l2 = registry.open(fresh_loop_id(p2, AgentInstanceId::new(), LoopKind::Chat));

        let snap = registry.snapshot_where(loops_in_project(p1));
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].loop_id, *l1.loop_id());
    }
}
