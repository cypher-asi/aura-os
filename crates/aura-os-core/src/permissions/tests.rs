use super::*;

#[test]
fn ceo_preset_is_universe_scope() {
    assert!(AgentPermissions::ceo_preset().scope.is_universe());
}

#[test]
fn ceo_preset_round_trips_through_wire() {
    let perms = AgentPermissions::ceo_preset();
    let wire: AgentPermissionsWire = (&perms).into();
    let back: AgentPermissions = wire.into();
    assert_eq!(perms, back);
}

#[test]
fn empty_perms_is_ceo_preset_false() {
    assert!(!AgentPermissions::empty().is_ceo_preset());
}

#[test]
fn ceo_preset_recognised() {
    assert!(AgentPermissions::ceo_preset().is_ceo_preset());
}

#[test]
fn normalized_for_identity_upgrades_empty_ceo_to_preset() {
    let upgraded = AgentPermissions::empty().normalized_for_identity("CEO", Some("CEO"));
    assert!(upgraded.is_ceo_preset());
}

#[test]
fn normalized_for_identity_leaves_non_ceo_empty_bundle_alone() {
    // Only the CEO defaults to the full-access preset; a regular agent
    // with empty permissions stays empty so users opt into capabilities
    // explicitly via the Permissions tab.
    let empty = AgentPermissions::empty();
    let same = empty
        .clone()
        .normalized_for_identity("Atlas", Some("Engineer"));
    assert_eq!(same, empty);
}

#[test]
fn normalized_for_identity_is_case_insensitive() {
    let upgraded = AgentPermissions::empty().normalized_for_identity("ceo", Some("Ceo"));
    assert!(upgraded.is_ceo_preset());
}

#[test]
fn normalized_for_identity_leaves_non_ceo_untouched() {
    let perms = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![Capability::ReadAgent],
        ..Default::default()
    };
    let same = perms
        .clone()
        .normalized_for_identity("Atlas", Some("Engineer"));
    assert_eq!(same, perms);
}

#[test]
fn normalized_for_identity_requires_both_name_and_role_to_match() {
    let restricted = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![Capability::ReadAgent],
        ..Default::default()
    };
    // name matches but role doesn't - must not promote a deliberately
    // restricted bundle.
    let only_name = restricted
        .clone()
        .normalized_for_identity("CEO", Some("Engineer"));
    assert!(!only_name.is_ceo_preset());
    // role matches but name doesn't - must not promote a deliberately
    // restricted bundle.
    let only_role = restricted
        .clone()
        .normalized_for_identity("Atlas", Some("CEO"));
    assert!(!only_role.is_ceo_preset());
    // role missing entirely - must not promote a deliberately restricted
    // bundle through the CEO repair path.
    let missing_role = restricted.normalized_for_identity("CEO", None);
    assert!(!missing_role.is_ceo_preset());
}

#[test]
fn normalized_for_identity_preserves_already_correct_preset() {
    let preset = AgentPermissions::ceo_preset();
    let same = preset.clone().normalized_for_identity("CEO", Some("CEO"));
    assert_eq!(same, preset);
}

#[test]
fn normalized_for_identity_preserves_customized_ceo_bundle() {
    // The CEO defaults to full access only when its bundle was never
    // set (empty). A deliberately pared-down bundle on a strict
    // name+role CEO must be left untouched so user edits — including
    // turning capabilities off — are respected rather than snapped back
    // to the preset on every read.
    let customized = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![Capability::ReadAgent, Capability::ListAgents],
        ..Default::default()
    };
    let same = customized
        .clone()
        .normalized_for_identity("CEO", Some("CEO"));
    assert_eq!(same, customized);
    assert!(!same.is_ceo_preset());
}

#[test]
fn with_subagent_caps_splices_spawn_and_read_for_empty_bundle() {
    let perms = AgentPermissions::empty().with_subagent_caps();
    assert!(perms.capabilities.contains(&Capability::SpawnAgent));
    assert!(perms.capabilities.contains(&Capability::ReadAgent));
}

#[test]
fn with_subagent_caps_is_idempotent() {
    let perms = AgentPermissions::empty()
        .with_subagent_caps()
        .with_subagent_caps();
    let spawn = perms
        .capabilities
        .iter()
        .filter(|c| matches!(c, Capability::SpawnAgent))
        .count();
    let read = perms
        .capabilities
        .iter()
        .filter(|c| matches!(c, Capability::ReadAgent))
        .count();
    assert_eq!(spawn, 1);
    assert_eq!(read, 1);
}

#[test]
fn with_subagent_caps_preserves_existing_caps() {
    let before = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![Capability::ReadProject {
            id: "proj-7".into(),
        }],
        ..Default::default()
    };
    let after = before.with_subagent_caps();
    assert!(after.capabilities.contains(&Capability::ReadProject {
        id: "proj-7".into(),
    }));
    assert!(after.capabilities.contains(&Capability::SpawnAgent));
    assert!(after.capabilities.contains(&Capability::ReadAgent));
}

#[test]
fn with_subagent_caps_is_noop_for_ceo_preset() {
    let preset = AgentPermissions::ceo_preset();
    let after = preset.clone().with_subagent_caps();
    assert_eq!(after, preset);
}

#[test]
fn with_project_self_caps_splices_both_read_and_write_for_empty_bundle() {
    let perms = AgentPermissions::empty().with_project_self_caps("proj-42");
    assert!(perms.capabilities.contains(&Capability::ReadProject {
        id: "proj-42".into(),
    }));
    assert!(perms.capabilities.contains(&Capability::WriteProject {
        id: "proj-42".into(),
    }));
}

#[test]
fn with_project_self_caps_is_noop_for_matching_grant() {
    // Agent already has the exact grant - splice must not duplicate.
    let existing = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![
            Capability::ReadProject {
                id: "proj-42".into(),
            },
            Capability::WriteProject {
                id: "proj-42".into(),
            },
        ],
        ..Default::default()
    };
    let after = existing.clone().with_project_self_caps("proj-42");
    assert_eq!(after, existing);
}

#[test]
fn with_project_self_caps_is_noop_for_wildcard_holder() {
    // CEO preset holds ReadAllProjects + WriteAllProjects wildcards;
    // the splice must treat those as satisfying both halves and
    // leave the bundle untouched so we don't pollute the CEO
    // manifest with exact-id grants it doesn't need.
    let preset = AgentPermissions::ceo_preset();
    let after = preset.clone().with_project_self_caps("proj-42");
    assert_eq!(after, preset);
}

#[test]
fn with_project_self_caps_adds_write_when_only_read_present() {
    // Agent has ReadProject for the bound project but no write
    // grant - splice must add the write half without duplicating
    // the read half.
    let before = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![Capability::ReadProject {
            id: "proj-42".into(),
        }],
        ..Default::default()
    };
    let after = before.with_project_self_caps("proj-42");
    assert_eq!(
        after
            .capabilities
            .iter()
            .filter(|c| matches!(c, Capability::ReadProject { id } if id == "proj-42"))
            .count(),
        1
    );
    assert!(after.capabilities.contains(&Capability::WriteProject {
        id: "proj-42".into(),
    }));
}

#[test]
fn with_project_self_caps_does_not_satisfy_other_projects() {
    // ReadProject for proj-a must not be considered as covering
    // proj-b - splicing for proj-b should add both halves.
    let before = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![Capability::WriteProject {
            id: "proj-a".into(),
        }],
        ..Default::default()
    };
    let after = before.with_project_self_caps("proj-b");
    assert!(after.capabilities.contains(&Capability::ReadProject {
        id: "proj-b".into(),
    }));
    assert!(after.capabilities.contains(&Capability::WriteProject {
        id: "proj-b".into(),
    }));
    assert!(after.capabilities.contains(&Capability::WriteProject {
        id: "proj-a".into(),
    }));
}

#[test]
fn with_dev_loop_execution_caps_splices_invoke_process_into_empty_bundle() {
    let perms = AgentPermissions::empty().with_dev_loop_execution_caps();
    assert!(perms.capabilities.contains(&Capability::InvokeProcess));
    assert_eq!(
        perms.capabilities.len(),
        1,
        "splice must add exactly one capability when the bundle was empty"
    );
}

#[test]
fn with_dev_loop_execution_caps_is_idempotent_when_already_held() {
    // CEO preset already carries InvokeProcess; a second call must
    // not duplicate it.
    let before = AgentPermissions::ceo_preset();
    let after = before.clone().with_dev_loop_execution_caps();
    assert_eq!(after, before);
    let invoke_process_count = after
        .capabilities
        .iter()
        .filter(|c| matches!(c, Capability::InvokeProcess))
        .count();
    assert_eq!(invoke_process_count, 1);
}

#[test]
fn with_dev_loop_execution_caps_preserves_other_capabilities() {
    // Splicing must not reorder or drop any pre-existing grants.
    let before = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![
            Capability::ReadAgent,
            Capability::ReadProject {
                id: "proj-42".into(),
            },
        ],
        ..Default::default()
    };
    let after = before.clone().with_dev_loop_execution_caps();
    for cap in &before.capabilities {
        assert!(
            after.capabilities.contains(cap),
            "pre-existing capability {cap:?} must survive the splice"
        );
    }
    assert!(after.capabilities.contains(&Capability::InvokeProcess));
}

#[test]
fn with_dev_loop_execution_caps_preserves_scope() {
    let scope = AgentScope {
        orgs: vec!["org-1".into()],
        projects: vec!["proj-42".into()],
        agent_ids: vec![],
    };
    let before = AgentPermissions {
        scope: scope.clone(),
        capabilities: vec![Capability::ReadAgent],
        ..Default::default()
    };
    let after = before.with_dev_loop_execution_caps();
    assert_eq!(after.scope, scope, "splice must not widen agent scope");
}

#[test]
fn default_new_agent_grants_everything_except_billing() {
    let perms = AgentPermissions::default_new_agent();
    // Billing is the one deliberate exclusion.
    assert!(
        !perms.capabilities.contains(&Capability::ManageBilling),
        "new agents must not get billing by default"
    );
    // Everything else from the full-access preset is present.
    for cap in AgentPermissions::full_access().capabilities {
        if matches!(cap, Capability::ManageBilling) {
            continue;
        }
        assert!(
            perms.capabilities.contains(&cap),
            "default new-agent bundle must include {cap:?}"
        );
    }
    // Spot-check the capabilities that unblock autonomous building.
    assert!(perms.capabilities.contains(&Capability::InvokeProcess));
    assert!(perms.capabilities.contains(&Capability::WriteAllProjects));
    assert!(perms.scope.is_universe());
}

#[test]
fn default_new_agent_is_not_empty() {
    assert!(!AgentPermissions::default_new_agent().is_empty());
}

#[test]
fn capability_serde_is_camel_case_external_tag() {
    let c = Capability::ReadProject { id: "p".into() };
    let v = serde_json::to_value(&c).unwrap();
    assert_eq!(v["type"], "readProject");
    assert_eq!(v["id"], "p");
}

#[test]
fn unknown_wire_capability_is_dropped_on_conversion() {
    // Older server receiving a newer wire bundle must still accept
    // the session; unknown variants are silently dropped so policy
    // enforcement falls back to the narrower, known capability set.
    let wire = AgentPermissionsWire {
        scope: AgentScopeWire::default(),
        capabilities: vec![
            CapabilityWire::SpawnAgent,
            CapabilityWire::Unknown,
            CapabilityWire::ReadAgent,
        ],
    };
    let perms: AgentPermissions = wire.into();
    assert_eq!(
        perms.capabilities,
        vec![Capability::SpawnAgent, Capability::ReadAgent]
    );
}

#[test]
fn try_from_unknown_capability_wire_returns_error() {
    let result = Capability::try_from(CapabilityWire::Unknown);
    assert_eq!(result, Err(UnknownCapability));
}
