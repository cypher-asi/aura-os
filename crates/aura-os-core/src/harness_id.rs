//! Upstream harness `agent_id` partition key construction.
//!
//! Phase 0 of the robust-concurrent-agent-infra plan introduces this
//! helper as the single source of truth for how we partition the
//! upstream harness `agent_id` per [`AgentInstance`]. Today every
//! surface (chat, dev loop, ad-hoc executor) sends the bare template
//! id, so the harness's "one in-flight turn per `agent_id`" rule
//! collides across surfaces. Later phases will start passing the
//! partitioned key everywhere; this module is the contract those
//! phases build on.

use crate::{AgentId, AgentInstanceId};

/// Build the upstream harness `agent_id` partition key.
///
/// The aura-harness enforces "one in-flight turn per agent_id". We
/// partition by [`AgentInstance`] so chat, loop, and ad-hoc executor
/// surfaces of the same template get independent turn-locks. The
/// template id is preserved separately in `SessionInit.template_agent_id`
/// for skill / permissions / billing lookup.
///
/// Format: `"{template_agent_id}::{agent_instance_id}"`.
/// Bare-template callers (legacy `/v1/agents/:agent_id/chat/stream`)
/// pass `None` and get `"{template_agent_id}::default"` so they still
/// sit on a stable partition.
///
/// [`AgentInstance`]: crate::AgentInstance
#[must_use]
pub fn harness_agent_id(template: &AgentId, instance: Option<&AgentInstanceId>) -> String {
    match instance {
        Some(id) => format!("{template}::{id}"),
        None => format!("{template}::default"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_bound_case_uses_double_colon_separator() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let key = harness_agent_id(&template, Some(&instance));

        assert_eq!(key, format!("{template}::{instance}"));
        assert!(key.contains("::"));
        assert!(!key.ends_with("::default"));
    }

    #[test]
    fn bare_template_case_yields_default_suffix() {
        let template = AgentId::new();

        let key = harness_agent_id(&template, None);

        assert_eq!(key, format!("{template}::default"));
        assert!(key.ends_with("::default"));
    }

    #[test]
    fn distinct_instances_produce_distinct_strings() {
        let template = AgentId::new();
        let instance_a = AgentInstanceId::new();
        let instance_b = AgentInstanceId::new();
        assert_ne!(instance_a, instance_b);

        let key_a = harness_agent_id(&template, Some(&instance_a));
        let key_b = harness_agent_id(&template, Some(&instance_b));

        assert_ne!(key_a, key_b);
    }

    #[test]
    fn bare_template_and_instance_bound_keys_differ() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let bare = harness_agent_id(&template, None);
        let bound = harness_agent_id(&template, Some(&instance));

        assert_ne!(bare, bound);
    }
}
