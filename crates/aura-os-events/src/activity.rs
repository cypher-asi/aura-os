//! Loop activity status used by the unified progress indicator.
//!
//! [`LoopActivity`] is the single source of truth for "is loop X
//! running, and how far through is it?". The same shape is published
//! over [`crate::DomainEvent::LoopActivityChanged`] events and returned
//! by the `GET /api/loops` snapshot endpoint, so the UI never has to
//! reconcile two divergent representations.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use aura_os_core::TaskId;

/// Coarse-grained loop state for UI rendering. The progress indicator
/// renders a spinner whenever the status is in the active set
/// (`Starting`, `Running`, `WaitingTool`, `Compacting`).
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopStatus {
    /// Loop is being opened (harness session connecting / config sent).
    Starting,
    /// Loop is actively making progress.
    Running,
    /// Loop is awaiting a tool call result (still active).
    WaitingTool,
    /// Loop is performing context compaction.
    Compacting,
    /// Loop has not emitted an event in a while; treat as "still
    /// active but might be wedged" for UI purposes (greyed spinner).
    Stalled,
    /// Loop completed normally.
    Completed,
    /// Loop ended with an error.
    Failed,
    /// Loop was explicitly cancelled by the user.
    Cancelled,
}

impl LoopStatus {
    /// `true` when the loop is in an active state (the UI should
    /// render a spinner).
    #[must_use]
    pub fn is_active(self) -> bool {
        matches!(
            self,
            LoopStatus::Starting
                | LoopStatus::Running
                | LoopStatus::WaitingTool
                | LoopStatus::Compacting
                | LoopStatus::Stalled
        )
    }

    /// `true` when the loop has reached a terminal state.
    #[must_use]
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            LoopStatus::Completed | LoopStatus::Failed | LoopStatus::Cancelled
        )
    }
}

/// Snapshot of a single loop's activity. Published whenever the status
/// or progress changes (rate-limited to ~4 Hz at the publisher).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoopActivity {
    /// Current coarse status.
    pub status: LoopStatus,
    /// Progress fraction in `0.0..=1.0` when known. `None` means
    /// indeterminate; the UI renders a spinning ring.
    pub percent: Option<f32>,
    /// Wall-clock time the loop started.
    pub started_at: DateTime<Utc>,
    /// Wall-clock time of the most recent event in this loop. Used by
    /// the watchdog to detect stalled loops.
    pub last_event_at: DateTime<Utc>,
    /// Task id the loop is currently working on, if any.
    pub current_task_id: Option<TaskId>,
    /// Human-readable hint about the current step (`"thinking"`,
    /// `"tool: read_file"`, `"compacting"`, …). UI tooltip only.
    pub current_step: Option<String>,
}

impl LoopActivity {
    /// Build a fresh activity for a brand-new loop.
    #[must_use]
    pub fn starting(now: DateTime<Utc>) -> Self {
        Self {
            status: LoopStatus::Starting,
            percent: Some(0.0),
            started_at: now,
            last_event_at: now,
            current_task_id: None,
            current_step: Some("connecting".to_string()),
        }
    }

    /// Mark this activity as having just emitted an event at `now`.
    pub fn touch(&mut self, now: DateTime<Utc>) {
        self.last_event_at = now;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_states_are_active() {
        assert!(LoopStatus::Starting.is_active());
        assert!(LoopStatus::Running.is_active());
        assert!(LoopStatus::WaitingTool.is_active());
        assert!(LoopStatus::Compacting.is_active());
        assert!(LoopStatus::Stalled.is_active());
    }

    #[test]
    fn terminal_states_are_terminal() {
        assert!(LoopStatus::Completed.is_terminal());
        assert!(LoopStatus::Failed.is_terminal());
        assert!(LoopStatus::Cancelled.is_terminal());
    }

    #[test]
    fn active_and_terminal_are_disjoint() {
        for status in [
            LoopStatus::Starting,
            LoopStatus::Running,
            LoopStatus::WaitingTool,
            LoopStatus::Compacting,
            LoopStatus::Stalled,
            LoopStatus::Completed,
            LoopStatus::Failed,
            LoopStatus::Cancelled,
        ] {
            assert!(!(status.is_active() && status.is_terminal()), "{status:?}");
        }
    }
}
