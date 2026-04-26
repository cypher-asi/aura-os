use aura_os_core::AgentPermissions;
use aura_os_network::NetworkAgent;

use super::super::agent_from_network;

fn blank_network_agent(name: &str, role: Option<&str>) -> NetworkAgent {
    NetworkAgent {
        id: "00000000-0000-0000-0000-000000000001".to_string(),
        name: name.to_string(),
        role: role.map(|s| s.to_string()),
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: None,
        user_id: "user-1".to_string(),
        org_id: None,
        profile_id: None,
        tags: None,
        listing_status: None,
        expertise: None,
        jobs: None,
        revenue_usd: None,
        reputation: None,
        permissions: AgentPermissions::default(),
        intent_classifier: None,
        created_at: None,
        updated_at: None,
    }
}

#[test]
fn agent_from_network_fills_ceo_preset_when_permissions_missing() {
    // Regression: older aura-network deployments didn't persist the
    // `permissions` column, so a CEO record round-tripped with an
    // empty bundle. The read-time safety net must restore the CEO
    // preset so `is_ceo_preset()`-gated callers behave correctly.
    let net = blank_network_agent("CEO", Some("CEO"));
    assert!(
        !net.permissions.is_ceo_preset(),
        "precondition: network record is not yet the preset"
    );

    let agent = agent_from_network(&net);

    assert!(
        agent.permissions.is_ceo_preset(),
        "empty CEO bundles are repaired to the canonical preset"
    );
    // CEO agents no longer ship an IntentClassifierSpec — the
    // read-time repair path preserves whatever the network record
    // carries (typically `None`) rather than synthesising the old
    // canonical classifier. See CEO_CORE_TOOLS for the rationale.
    assert!(
        agent.intent_classifier.is_none(),
        "read-time repair no longer fills a canonical classifier"
    );
}

#[test]
fn agent_from_network_ceo_preset_matches_case_insensitively() {
    // Historical CEO records may have lowercase / mixed-case name or
    // role fields. The safety net mirrors the case-insensitive
    // matching in `looks_like_ceo`.
    let net = blank_network_agent("ceo", Some("ceo"));
    let agent = agent_from_network(&net);
    assert!(agent.permissions.is_ceo_preset());
}

#[test]
fn agent_from_network_does_not_promote_non_ceo_agents() {
    // Users may legitimately create regular agents whose name or role
    // resembles "CEO" in isolation — only the (name="CEO" AND
    // role="CEO") pair triggers the safety net.
    let cases = vec![
        blank_network_agent("CEO", Some("Coach")),
        blank_network_agent("Eve", Some("CEO")),
        blank_network_agent("Regular", None),
    ];
    for net in cases {
        let agent = agent_from_network(&net);
        assert!(
            !agent.permissions.is_ceo_preset(),
            "non-CEO agents keep their empty permissions bundle"
        );
        assert!(
            agent.intent_classifier.is_none(),
            "non-CEO agents don't receive the canonical classifier"
        );
    }
}

#[test]
fn agent_from_network_preserves_existing_ceo_preset() {
    // When aura-network *does* persist the preset, the safety net is
    // a no-op and must not churn the intent classifier either.
    let mut net = blank_network_agent("CEO", Some("CEO"));
    net.permissions = AgentPermissions::ceo_preset();

    let agent = agent_from_network(&net);

    assert!(agent.permissions.is_ceo_preset());
    assert!(
        agent.intent_classifier.is_none(),
        "preserved-preset path doesn't synthesize a classifier on its own"
    );
}
