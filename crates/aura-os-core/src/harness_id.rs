//! Upstream harness `agent_id` partition key construction.
//!
//! Phase 0 of the robust-concurrent-agent-infra plan introduces this
//! helper as the single source of truth for how we partition the
//! upstream harness `agent_id` per [`AgentInstance`]. Phases 1-6 wire
//! it through every call site and add the busy guard, SSE error
//! remap, queued-turn slot, and capacity-exhausted mapping that
//! depend on it.
//!
//! ## Rollout gating
//!
//! Production turns the partitioning on by default. During a rolling
//! deploy where the matching harness build hasn't yet shipped
//! partition support, operators set `AURA_PARTITION_AGENT_IDS=false`
//! on the server so [`harness_agent_id_gated`] returns the bare
//! template id at every call site. Every other Phase-0-6 improvement
//! (busy guard, SSE error remap, queued-turn slot, capacity-exhausted
//! mapping) stays active regardless of the flag — the gate only
//! changes the `agent_id` shape sent on the wire. Once the harness
//! side ships, the flag is flipped back to `true` (or unset) and
//! both ends agree on the partitioned shape again. The
//! `template_agent_id` field on `SessionConfig` /
//! `AutomatonStartParams` is set to `Some(template)` unconditionally
//! so flipping the flag on later doesn't require re-deriving the
//! field at every call site.

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

/// Helper for the rollout-gated case: returns the partition id when
/// `enabled = true` (the default), falls back to the bare template
/// id when `enabled = false`. Used by every `SessionConfig` /
/// `AutomatonStartParams` call site so a single `partition_agent_ids`
/// config flag controls the whole pipeline.
///
/// When `enabled = false`, the upstream harness is still using
/// template-based turn locking and has not yet shipped support for
/// the `{template}::{instance}` partition key. In that mode every
/// caller sends the bare template, which restores the pre-Phase-1
/// upstream behavior. Every other Phase-0-6 improvement (busy
/// guard, SSE error remap, queued-turn slot, capacity-exhausted
/// mapping) keeps working — the busy guard still matches by
/// `(project_id, agent_instance_id)` and the per-partition turn
/// slot still applies because it's intra-partition state.
#[must_use]
pub fn harness_agent_id_gated(
    enabled: bool,
    template: &AgentId,
    instance: Option<&AgentInstanceId>,
) -> String {
    if enabled {
        harness_agent_id(template, instance)
    } else {
        template.to_string()
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

    #[test]
    fn gated_enabled_matches_harness_agent_id_for_instance_bound() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let gated = harness_agent_id_gated(true, &template, Some(&instance));
        let direct = harness_agent_id(&template, Some(&instance));

        assert_eq!(gated, direct);
        assert!(gated.contains("::"));
    }

    #[test]
    fn gated_enabled_matches_harness_agent_id_for_bare_template() {
        let template = AgentId::new();

        let gated = harness_agent_id_gated(true, &template, None);
        let direct = harness_agent_id(&template, None);

        assert_eq!(gated, direct);
        assert!(gated.ends_with("::default"));
    }

    #[test]
    fn gated_disabled_returns_bare_template_for_instance_bound() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let gated = harness_agent_id_gated(false, &template, Some(&instance));

        assert_eq!(gated, template.to_string());
        assert!(!gated.contains("::"));
    }

    #[test]
    fn gated_disabled_returns_bare_template_for_bare_template() {
        let template = AgentId::new();

        let gated = harness_agent_id_gated(false, &template, None);

        assert_eq!(gated, template.to_string());
        assert!(!gated.ends_with("::default"));
    }

    #[test]
    fn gated_disabled_collapses_distinct_instances_onto_one_partition() {
        let template = AgentId::new();
        let instance_a = AgentInstanceId::new();
        let instance_b = AgentInstanceId::new();
        assert_ne!(instance_a, instance_b);

        let gated_a = harness_agent_id_gated(false, &template, Some(&instance_a));
        let gated_b = harness_agent_id_gated(false, &template, Some(&instance_b));

        assert_eq!(
            gated_a, gated_b,
            "with the flag off, every instance of one template must collapse onto the bare template id"
        );
        assert_eq!(gated_a, template.to_string());
    }

    #[test]
    fn gated_parameter_wiring_threads_template_and_instance_correctly() {
        let template = AgentId::new();
        let instance = AgentInstanceId::new();

        let enabled = harness_agent_id_gated(true, &template, Some(&instance));
        let disabled = harness_agent_id_gated(false, &template, Some(&instance));

        assert!(
            enabled.starts_with(&template.to_string()),
            "enabled must include the template prefix, got: {enabled}"
        );
        assert!(
            enabled.ends_with(&instance.to_string()),
            "enabled must include the instance suffix, got: {enabled}"
        );
        assert_eq!(disabled, template.to_string());
    }
}
