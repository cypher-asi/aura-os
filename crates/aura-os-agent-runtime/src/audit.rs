//! Lightweight audit log for cross-agent tool dispatches.
//!
//! `aura-os-storage` is remote-only (HTTP-backed), so persisting every
//! tool call there would require a new `agent_tool_invocations`
//! endpoint on the storage service. That's out of scope for Tier A —
//! instead we keep a per-process in-memory ring buffer so operators
//! can inspect recent activity via
//! [`crate::AgentRuntimeService::recent_tool_invocations`] (diagnostic
//! only), and structured `tracing` records under the
//! `agent_tool_audit` target surface the same data to centralised log
//! aggregation.
//!
//! TODO(tier-a): plumb a persistent backend — either a dedicated
//! `agent_tool_invocations` table in `aura-os-storage` or a direct
//! insert against the control plane — once the storage schema lands.

use std::collections::VecDeque;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::info;

/// Default capacity of the per-process audit ring buffer. 512 entries
/// at a few hundred bytes each is small enough to always keep hot
/// without special-casing.
pub const DEFAULT_AUDIT_CAPACITY: usize = 512;

/// A single cross-agent tool invocation recorded by the dispatcher.
///
/// Field names mirror what a future `agent_tool_invocations` table
/// would carry, so a later persistent backend can accept this struct
/// directly without renaming.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolInvocation {
    pub id: String,
    pub agent_id: Option<String>,
    pub tool_name: String,
    pub args_hash: String,
    /// `"allow"` or `"deny"`. Only `"allow"` entries ever carry a
    /// meaningful `result_bytes`, since denies short-circuit before
    /// `execute`.
    pub permit_decision: String,
    pub permit_reason: Option<String>,
    pub result_bytes: u64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub org_id: Option<String>,
    pub user_id: String,
}

/// In-memory ring buffer. Cloning is cheap (`Arc`-wrapped) so callers
/// can freely share a single instance across handlers.
#[derive(Clone)]
pub struct AgentToolAuditLog {
    inner: Arc<Mutex<VecDeque<AgentToolInvocation>>>,
    capacity: usize,
}

/// Back-compat alias for call sites that spell the log `AuditLog`.
pub type AuditLog = AgentToolAuditLog;

impl AgentToolAuditLog {
    /// Construct a new audit log with [`DEFAULT_AUDIT_CAPACITY`].
    #[must_use]
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_AUDIT_CAPACITY)
    }

    /// Construct a new audit log with an explicit capacity. Capacity
    /// of zero is pinned to 1 to avoid a degenerate always-drops case.
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            inner: Arc::new(Mutex::new(VecDeque::with_capacity(capacity))),
            capacity,
        }
    }

    /// Best-effort record. This never propagates errors — a
    /// misbehaving audit path must never fail a live tool call.
    pub async fn record(&self, invocation: AgentToolInvocation) {
        info!(
            target: "agent_tool_audit",
            invocation_id = %invocation.id,
            tool = %invocation.tool_name,
            agent_id = ?invocation.agent_id,
            user_id = %invocation.user_id,
            org_id = ?invocation.org_id,
            permit_decision = %invocation.permit_decision,
            permit_reason = ?invocation.permit_reason,
            args_hash = %invocation.args_hash,
            result_bytes = invocation.result_bytes,
            duration_ms =
                (invocation.finished_at - invocation.started_at).num_milliseconds(),
            "agent_tool_invocation"
        );
        let mut guard = self.inner.lock().await;
        if guard.len() == self.capacity {
            let _ = guard.pop_front();
        }
        guard.push_back(invocation);
    }

    /// Snapshot the current buffer contents, oldest first. Returns a
    /// fresh `Vec` so callers can inspect without holding the lock.
    pub async fn snapshot(&self) -> Vec<AgentToolInvocation> {
        let guard = self.inner.lock().await;
        guard.iter().cloned().collect()
    }

    /// Current number of recorded invocations.
    pub async fn len(&self) -> usize {
        self.inner.lock().await.len()
    }

    /// True iff no invocations have been recorded.
    pub async fn is_empty(&self) -> bool {
        self.len().await == 0
    }

    /// Configured ring capacity (immutable over the log's lifetime).
    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

impl Default for AgentToolAuditLog {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute the canonical args hash used in `AgentToolInvocation`.
///
/// Uses blake3 over the JSON-serialized args. Serialization failures
/// are rare (only non-serializable values) but if they happen we fall
/// back to hashing an empty byte slice so the audit row still writes.
#[must_use]
pub fn hash_args(args: &serde_json::Value) -> String {
    let bytes = serde_json::to_vec(args).unwrap_or_default();
    blake3::hash(bytes.as_slice()).to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_invocation(id: &str) -> AgentToolInvocation {
        let now = Utc::now();
        AgentToolInvocation {
            id: id.to_string(),
            agent_id: Some("agent-1".to_string()),
            tool_name: "list_agents".to_string(),
            args_hash: "deadbeef".to_string(),
            permit_decision: "allow".to_string(),
            permit_reason: None,
            result_bytes: 42,
            started_at: now,
            finished_at: now,
            org_id: Some("org-1".to_string()),
            user_id: "user-1".to_string(),
        }
    }

    #[tokio::test]
    async fn ring_buffer_evicts_oldest_at_capacity() {
        let log = AgentToolAuditLog::with_capacity(2);
        log.record(sample_invocation("a")).await;
        log.record(sample_invocation("b")).await;
        log.record(sample_invocation("c")).await;
        let snap = log.snapshot().await;
        let ids: Vec<&str> = snap.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c"]);
    }

    #[tokio::test]
    async fn hash_args_is_stable_and_hex() {
        let a = hash_args(&serde_json::json!({ "x": 1 }));
        let b = hash_args(&serde_json::json!({ "x": 1 }));
        assert_eq!(a, b);
        assert_eq!(a.len(), 64, "blake3 hex digest is 64 chars");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn zero_capacity_is_clamped_to_one() {
        let log = AgentToolAuditLog::with_capacity(0);
        log.record(sample_invocation("a")).await;
        log.record(sample_invocation("b")).await;
        assert_eq!(log.len().await, 1);
    }
}
