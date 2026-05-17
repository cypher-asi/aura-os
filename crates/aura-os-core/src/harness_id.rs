//! Upstream harness `agent_id` partition key construction.
//!
//! Phase 0 of the robust-concurrent-agent-infra plan introduces this
//! helper as the single source of truth for how we partition the
//! upstream harness `agent_id` per [`AgentInstance`]. Phases 1-6 wire
//! it through every call site and add the busy guard, SSE error
//! remap, queued-turn slot, and capacity-exhausted mapping that
//! depend on it.
//!
//! Phase 0 of the parallel-session-chats plan extends this helper
//! with an optional [`SessionId`] segment so chat routes can promote
//! the storage session id into the partition key, giving every
//! storage session its own harness lane.

use crate::{AgentId, AgentInstanceId, SessionId};

/// Build the upstream harness `agent_id` partition key.
///
/// The aura-harness enforces "one in-flight turn per agent_id". We
/// partition by [`AgentInstance`] so chat, loop, and ad-hoc executor
/// surfaces of the same template get independent turn-locks. The
/// template id is preserved separately in `SessionInit.template_agent_id`
/// for skill / permissions / billing lookup.
///
/// The helper produces one of three forms:
///
/// - **Bare-template** (`instance = None`, `session = None`): yields
///   `"{template_agent_id}::default"`. Used by legacy
///   `/v1/agents/:agent_id/chat/stream` and other callers that do not
///   have an instance to bind to.
/// - **Instance-bound** (`instance = Some`, `session = None`): yields
///   `"{template_agent_id}::{agent_instance_id}"`. The classic
///   per-instance partition used by chat, loop, and ad-hoc executor
///   surfaces.
/// - **Instance + session-bound** (`instance = Some`, `session = Some`):
///   yields `"{template_agent_id}::{agent_instance_id}::{session_id}"`.
///   Phase 0 of the parallel-session-chats plan promotes the storage
///   session id into the partition key so two storage sessions on the
///   same agent instance get independent harness lanes / turn slots /
///   record logs.
///
/// Passing `session = None` is byte-identical to the historical
/// two-argument helper output, so existing call sites can opt out of
/// the new third segment without changing any partition strings.
///
/// [`AgentInstance`]: crate::AgentInstance
/// [`SessionId`]: crate::SessionId
#[must_use]
pub fn harness_agent_id(
    template: &AgentId,
    instance: Option<&AgentInstanceId>,
    session: Option<&SessionId>,
) -> String {
    let base = match instance {
        Some(id) => format!("{template}::{id}"),
        None => format!("{template}::default"),
    };
    match session {
        Some(session_id) => format!("{base}::{session_id}"),
        None => base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_bound_case_uses_double_colon_separator() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let key = harness_agent_id(&template, Some(&instance), None);

        assert_eq!(key, format!("{template}::{instance}"));
        assert!(key.contains("::"));
        assert!(!key.ends_with("::default"));
    }

    #[test]
    fn bare_template_case_yields_default_suffix() {
        let template = AgentId::new();

        let key = harness_agent_id(&template, None, None);

        assert_eq!(key, format!("{template}::default"));
        assert!(key.ends_with("::default"));
    }

    #[test]
    fn distinct_instances_produce_distinct_strings() {
        let template = AgentId::new();
        let instance_a = AgentInstanceId::new();
        let instance_b = AgentInstanceId::new();
        assert_ne!(instance_a, instance_b);

        let key_a = harness_agent_id(&template, Some(&instance_a), None);
        let key_b = harness_agent_id(&template, Some(&instance_b), None);

        assert_ne!(key_a, key_b);
    }

    #[test]
    fn bare_template_and_instance_bound_keys_differ() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let bare = harness_agent_id(&template, None, None);
        let bound = harness_agent_id(&template, Some(&instance), None);

        assert_ne!(bare, bound);
    }

    #[test]
    fn session_bound_case_yields_three_segments() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();
        let session = SessionId::new();

        let key = harness_agent_id(&template, Some(&instance), Some(&session));

        assert_eq!(key, format!("{template}::{instance}::{session}"));
        assert_eq!(key.matches("::").count(), 2);
    }

    #[test]
    fn distinct_sessions_produce_distinct_strings() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();
        let session_a = SessionId::new();
        let session_b = SessionId::new();
        assert_ne!(session_a, session_b);

        let key_a = harness_agent_id(&template, Some(&instance), Some(&session_a));
        let key_b = harness_agent_id(&template, Some(&instance), Some(&session_b));

        assert_ne!(key_a, key_b);
    }

    #[test]
    fn session_none_preserves_two_segment_form() {
        // Byte-compatibility regression guard: passing `None` for the new
        // third argument must yield the exact same string as today's
        // two-argument call. Existing call sites rely on this so logs,
        // partition lookups, and harness `SessionInit.agent_id` strings
        // stay byte-identical at this phase.
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let key = harness_agent_id(&template, Some(&instance), None);

        assert_eq!(key, format!("{template}::{instance}"));
        assert_eq!(key.matches("::").count(), 1);
    }
}
