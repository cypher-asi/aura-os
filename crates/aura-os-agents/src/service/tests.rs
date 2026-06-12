//! Unit tests for [`AgentService`].

use std::sync::Arc;

use aura_os_core::{Agent, AgentId, AgentPermissions, AgentScope, Capability, OrgId};
use aura_os_store::SettingsStore;

use super::AgentService;

fn sample_agent(name: &str) -> Agent {
    let now = chrono::Utc::now();
    Agent {
        agent_id: AgentId::new(),
        user_id: "u1".into(),
        org_id: None,
        name: name.into(),
        role: "dev".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        auth_source: "aura_managed".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        wallet_address: None,
        network_agent_id: None,
        profile_id: None,
        tags: vec![],
        is_pinned: false,
        listing_status: Default::default(),
        expertise: vec![],
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

fn agent_with_permissions(name: &str, perms: AgentPermissions) -> Agent {
    let mut a = sample_agent(name);
    a.permissions = perms;
    a
}

fn open_service() -> (AgentService, tempfile::TempDir) {
    let dir = tempfile::TempDir::new().unwrap();
    let store = Arc::new(SettingsStore::open(dir.path()).unwrap());
    (AgentService::new(store, None), dir)
}

// -----------------------------------------------------------------
// save_agent_shadows_if_changed — batched, diff-only flush. This is
// the hot-path fix behind the slow `GET /api/agents` response; the
// tests below pin the contract that previously caused N full
// `settings.json` rewrites per list:
//   1. unchanged inputs produce zero writes,
//   2. changed inputs produce exactly one `persist_cf` call
//      regardless of how many rows changed.
// -----------------------------------------------------------------

#[test]
fn save_agent_shadows_if_changed_writes_new_and_changed_rows_once() {
    let (service, dir) = open_service();
    let a = sample_agent("Atlas");
    let b = sample_agent("Beta");

    // First call: both rows are new, so both get batched into one
    // write.
    let written = service
        .save_agent_shadows_if_changed(&[&a, &b])
        .expect("initial batched save");
    assert_eq!(written, 2, "both new shadows should be queued");

    // Sanity-check that both rows actually round-trip.
    let a_round = service.get_agent_local(&a.agent_id).unwrap();
    let b_round = service.get_agent_local(&b.agent_id).unwrap();
    assert_eq!(a_round.name, "Atlas");
    assert_eq!(b_round.name, "Beta");

    // Second call with identical inputs must not touch the disk. We
    // assert that by snapshotting the `settings.json` mtime and
    // confirming it is unchanged afterwards — if
    // `save_agent_shadows_if_changed` had fallen back to
    // `save_agent_shadow`-per-row or unconditionally called
    // `write_batch`, `persist_cf` would rewrite the file and bump
    // the mtime.
    let settings_path = dir.path().join("settings.json");
    let mtime_before = std::fs::metadata(&settings_path)
        .unwrap()
        .modified()
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));

    let written = service
        .save_agent_shadows_if_changed(&[&a, &b])
        .expect("second batched save");
    assert_eq!(written, 0, "unchanged inputs must not trigger writes");

    let mtime_after = std::fs::metadata(&settings_path)
        .unwrap()
        .modified()
        .unwrap();
    assert_eq!(
        mtime_before, mtime_after,
        "settings.json must not be rewritten when nothing changed"
    );
}

#[test]
fn save_agent_shadows_if_changed_only_writes_diffs() {
    let (service, _dir) = open_service();
    let a = sample_agent("Atlas");
    let mut b = sample_agent("Beta");

    service
        .save_agent_shadows_if_changed(&[&a, &b])
        .expect("seed both shadows");

    // Mutate only `b`.
    b.name = "Beta Prime".into();
    b.updated_at = chrono::Utc::now();
    let written = service
        .save_agent_shadows_if_changed(&[&a, &b])
        .expect("flush only the diff");
    assert_eq!(written, 1, "only the mutated row should be written");

    let b_round = service.get_agent_local(&b.agent_id).unwrap();
    assert_eq!(b_round.name, "Beta Prime");
}

#[test]
fn save_agent_shadows_if_changed_noop_on_empty_input() {
    let (service, _dir) = open_service();
    let written = service.save_agent_shadows_if_changed(&[]).unwrap();
    assert_eq!(written, 0);
}

// -----------------------------------------------------------------
// reconcile_permissions_with_shadow — GET-side counterpart to the
// PUT-side reconciliation in `crud::update_agent`. Pins the
// contract that an empty network response never clobbers a
// non-empty shadow, while still letting a genuine "clear all
// toggles" roundtrip flow through.
// -----------------------------------------------------------------

#[test]
fn reconcile_prefers_shadow_when_network_response_drops_permissions() {
    let (service, _dir) = open_service();
    let mut seeded = agent_with_permissions(
        "Atlas",
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
        },
    );
    service
        .save_agent_shadow(&seeded)
        .expect("seed shadow with non-empty permissions");

    // Simulate a fresh network response for the same agent whose
    // `permissions` column came back empty.
    seeded.permissions = AgentPermissions::empty();
    service.reconcile_permissions_with_shadow(&mut seeded);

    assert!(
        !seeded.permissions.is_empty(),
        "empty network permissions must be rescued from the shadow"
    );
    assert!(seeded
        .permissions
        .capabilities
        .contains(&Capability::SpawnAgent));
    assert!(seeded
        .permissions
        .capabilities
        .contains(&Capability::ReadAgent));
}

#[test]
fn reconcile_is_noop_when_network_response_has_permissions() {
    let (service, _dir) = open_service();
    let mut seeded = agent_with_permissions(
        "Atlas",
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent],
        },
    );
    service.save_agent_shadow(&seeded).unwrap();

    // Fresh response has a DIFFERENT non-empty bundle — the network
    // is authoritative in this case.
    seeded.permissions = AgentPermissions {
        scope: AgentScope::default(),
        capabilities: vec![Capability::PostToFeed],
    };
    service.reconcile_permissions_with_shadow(&mut seeded);

    assert_eq!(
        seeded.permissions.capabilities,
        vec![Capability::PostToFeed]
    );
}

#[test]
fn reconcile_allows_intentional_clear_when_shadow_is_also_empty() {
    // When the user deliberately toggles everything off, both the
    // shadow and the next network fetch are empty. Reconciliation
    // must NOT synthesize permissions in that case.
    let (service, _dir) = open_service();
    let seeded = agent_with_permissions("Atlas", AgentPermissions::empty());
    service.save_agent_shadow(&seeded).unwrap();

    let mut fetched = seeded.clone();
    service.reconcile_permissions_with_shadow(&mut fetched);
    assert!(fetched.permissions.is_empty());
}

#[test]
fn reconcile_is_noop_when_no_shadow_exists() {
    let (service, _dir) = open_service();
    let mut fresh = agent_with_permissions("Atlas", AgentPermissions::empty());
    service.reconcile_permissions_with_shadow(&mut fresh);
    assert!(fresh.permissions.is_empty());
}

// -----------------------------------------------------------------
// save_agent_shadow empty-permissions guard. The single-row and
// batched writers must both refuse to overwrite a non-empty stored
// permissions bundle with an empty one, regardless of whether the
// caller remembered to `reconcile_permissions_with_shadow` first.
// -----------------------------------------------------------------

#[test]
fn save_agent_shadow_preserves_non_empty_permissions_when_input_is_empty() {
    let (service, _dir) = open_service();
    let seeded = agent_with_permissions(
        "Atlas",
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
        },
    );
    service.save_agent_shadow(&seeded).unwrap();

    // Simulate a handler that forgot to reconcile and now writes an
    // empty-permissions projection (the classic "aura-network PUT
    // response dropped the column" scenario).
    let mut clobbered = seeded.clone();
    clobbered.name = "Atlas Prime".into();
    clobbered.permissions = AgentPermissions::empty();
    service.save_agent_shadow(&clobbered).unwrap();

    let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
    assert_eq!(
        reloaded.name, "Atlas Prime",
        "non-permissions fields still flow through"
    );
    assert!(
        !reloaded.permissions.is_empty(),
        "stored permissions must survive an empty-input write"
    );
    assert!(reloaded
        .permissions
        .capabilities
        .contains(&Capability::SpawnAgent));
}

#[test]
fn save_agent_shadows_if_changed_preserves_non_empty_permissions_on_empty_input() {
    let (service, _dir) = open_service();
    let seeded = agent_with_permissions(
        "Atlas",
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent],
        },
    );
    service.save_agent_shadow(&seeded).unwrap();

    let mut clobbered = seeded.clone();
    clobbered.name = "Atlas Prime".into();
    clobbered.permissions = AgentPermissions::empty();
    service
        .save_agent_shadows_if_changed(&[&clobbered])
        .expect("batched save with empty-input guard");

    let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
    assert_eq!(reloaded.name, "Atlas Prime");
    assert!(!reloaded.permissions.is_empty());
    assert!(reloaded
        .permissions
        .capabilities
        .contains(&Capability::SpawnAgent));
}

#[test]
fn save_agent_shadow_preserves_org_when_network_projection_omits_it() {
    let (service, _dir) = open_service();
    let mut seeded = sample_agent("Atlas");
    seeded.org_id = Some(OrgId::new());
    service.save_agent_shadow(&seeded).unwrap();

    let mut clobbered = seeded.clone();
    clobbered.name = "Atlas Prime".into();
    clobbered.org_id = None;
    service.save_agent_shadow(&clobbered).unwrap();

    let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
    assert_eq!(reloaded.name, "Atlas Prime");
    assert_eq!(reloaded.org_id, seeded.org_id);
}

#[test]
fn save_agent_shadows_if_changed_preserves_org_when_network_projection_omits_it() {
    let (service, _dir) = open_service();
    let mut seeded = sample_agent("Atlas");
    seeded.org_id = Some(OrgId::new());
    service.save_agent_shadow(&seeded).unwrap();

    let mut clobbered = seeded.clone();
    clobbered.name = "Atlas Prime".into();
    clobbered.org_id = None;
    service
        .save_agent_shadows_if_changed(&[&clobbered])
        .expect("batched save with missing-org guard");

    let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
    assert_eq!(reloaded.name, "Atlas Prime");
    assert_eq!(reloaded.org_id, seeded.org_id);
}

#[test]
fn save_agent_shadow_allows_intentional_clear_when_shadow_also_empty() {
    let (service, _dir) = open_service();
    let seeded = agent_with_permissions("Atlas", AgentPermissions::empty());
    service.save_agent_shadow(&seeded).unwrap();

    let mut cleared = seeded.clone();
    cleared.permissions = AgentPermissions::empty();
    service.save_agent_shadow(&cleared).unwrap();

    let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
    assert!(reloaded.permissions.is_empty());
}

// -----------------------------------------------------------------
// CEO agent_id repair. When both the network response AND the local
// shadow have empty permissions but the agent_id matches the one
// stamped by `setup_ceo_agent`, reconciliation restores the
// canonical CEO preset. This covers users who renamed the CEO (e.g.
// to "Orion") and whose shadow was already corrupted by the pre-fix
// PUT flow.
// -----------------------------------------------------------------

#[test]
fn reconcile_restores_ceo_preset_by_agent_id_when_shadow_also_empty() {
    let (service, _dir) = open_service();
    let mut ceo = agent_with_permissions("Orion", AgentPermissions::empty());
    ceo.role = "CEO".into();
    service.remember_ceo_agent_id(&ceo.agent_id);

    // No shadow, empty network response — only the agent_id stamp
    // can rescue us.
    service.reconcile_permissions_with_shadow(&mut ceo);
    assert!(
        ceo.permissions.is_ceo_preset(),
        "bootstrapped CEO agent_id must restore the preset"
    );
}

#[test]
fn reconcile_does_not_touch_other_agents_when_ceo_id_stamped() {
    let (service, _dir) = open_service();
    let ceo_id = AgentId::new();
    service.remember_ceo_agent_id(&ceo_id);

    // A different agent with empty permissions should remain empty —
    // we only repair the exact bootstrapped agent_id.
    let mut other = agent_with_permissions("Sidekick", AgentPermissions::empty());
    service.reconcile_permissions_with_shadow(&mut other);
    assert!(other.permissions.is_empty());
}

#[test]
fn bootstrapped_ceo_agent_id_round_trips() {
    let (service, _dir) = open_service();
    assert!(service.bootstrapped_ceo_agent_id().is_none());

    let id = AgentId::new();
    service.remember_ceo_agent_id(&id);
    assert_eq!(service.bootstrapped_ceo_agent_id(), Some(id));
}

fn renamed_ceo(name: &str) -> Agent {
    let mut ceo = agent_with_permissions(name, AgentPermissions::empty());
    ceo.role = "CEO".into();
    ceo.system_prompt = format!(
        "{} for the \"Acme\" organization in Aura OS.",
        aura_os_core::CEO_SYSTEM_PROMPT_PREFIX
    );
    ceo
}

#[test]
fn reconcile_restores_ceo_preset_by_system_prompt_prefix() {
    let (service, _dir) = open_service();
    let mut ceo = renamed_ceo("Maia");

    // No agent_id stamp, no shadow, empty network response: only the
    // bootstrap CEO system-prompt prefix identifies this renamed CEO.
    // This is the dev-vs-prod gap — a fresh prod store has neither the
    // stamp nor a warm shadow.
    service.reconcile_permissions_with_shadow(&mut ceo);
    assert!(
        ceo.permissions.is_ceo_preset(),
        "renamed CEO recognised by system-prompt prefix must default to the preset"
    );
}

#[test]
fn reconcile_skips_ceo_default_when_permissions_customized() {
    let (service, _dir) = open_service();
    let mut ceo = renamed_ceo("Maia");

    // User explicitly cleared every capability: the customized flag must
    // suppress the CEO default-fill so the all-off choice wins instead of
    // snapping back to the preset on the next read.
    service.mark_agent_permissions_customized(&ceo.agent_id);
    service.reconcile_permissions_with_shadow(&mut ceo);
    assert!(
        ceo.permissions.is_empty(),
        "an explicit clear-all on the CEO must not be re-defaulted to the preset"
    );
}

#[test]
fn save_agent_shadow_allows_clear_all_when_customized() {
    let (service, _dir) = open_service();
    let seeded = agent_with_permissions("Maia", AgentPermissions::ceo_preset());
    service.save_agent_shadow(&seeded).unwrap();

    // With the customized flag set, an empty bundle is an intentional
    // clear-all and must persist rather than being resurrected from the
    // stored preset by the dropped-column guard.
    service.mark_agent_permissions_customized(&seeded.agent_id);
    let mut cleared = seeded.clone();
    cleared.permissions = AgentPermissions::empty();
    service.save_agent_shadow(&cleared).unwrap();

    let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
    assert!(
        reloaded.permissions.is_empty(),
        "a customized agent must be allowed to persist an intentional clear-all"
    );
}

// -----------------------------------------------------------------
// Per-process heal-PUT throttle. Pins the contract that the
// shadow-adoption safety net keeps running every reconcile call,
// while the WARN log + outbound heal PUT are gated by a
// per-process dedup set so a polling sidebar refresh that hits the
// same upstream drift on every cycle doesn't spam the logs or the
// upstream API.
// -----------------------------------------------------------------

#[test]
fn reconcile_repeated_calls_still_adopt_shadow() {
    let (service, _dir) = open_service();
    let seeded = agent_with_permissions(
        "Atlas",
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent],
        },
    );
    service.save_agent_shadow(&seeded).unwrap();

    // Simulate two back-to-back list refreshes, each returning an
    // empty permissions bundle. Both calls must still rescue the
    // bundle from the shadow — the throttle only suppresses the
    // log + heal-PUT, never the in-memory repair.
    for _ in 0..2 {
        let mut fetched = seeded.clone();
        fetched.permissions = AgentPermissions::empty();
        service.reconcile_permissions_with_shadow(&mut fetched);
        assert!(
            !fetched.permissions.is_empty(),
            "shadow adoption must run on every reconcile, not just the first"
        );
        assert!(fetched
            .permissions
            .capabilities
            .contains(&Capability::SpawnAgent));
    }
}

#[test]
fn permission_heal_attempt_marks_first_call_only() {
    let (service, _dir) = open_service();
    let agent_id = AgentId::new();
    assert!(
        service.note_permission_heal_attempt(&agent_id),
        "first attempt for an agent should signal first-encounter"
    );
    assert!(
        !service.note_permission_heal_attempt(&agent_id),
        "second attempt for the same agent must be deduped"
    );

    // A different agent_id stays independent — the dedup is per-id.
    let other = AgentId::new();
    assert!(service.note_permission_heal_attempt(&other));
}

// -----------------------------------------------------------------
// Persisted "upstream drops the `permissions` column" sentinel.
// The PUT-heal task writes this key the first time it observes
// aura-network swallowing the column on writes; subsequent process
// boots use it to silence per-agent WARNs and skip the doomed heal
// PUT entirely. It auto-clears the moment upstream returns a
// non-empty bundle, so a fixed deployment self-heals without any
// manual reset.
// -----------------------------------------------------------------

#[test]
fn reconcile_with_sentinel_set_still_adopts_shadow() {
    let (service, _dir) = open_service();
    let seeded = agent_with_permissions(
        "Atlas",
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
        },
    );
    service.save_agent_shadow(&seeded).unwrap();

    // Simulate "a prior process already detected upstream is broken"
    // by pre-seeding the sentinel directly on the store.
    service
        .store
        .put_setting(AgentService::PERMISSIONS_UPSTREAM_DROPS_KEY, b"1")
        .unwrap();

    // The in-memory rescue contract MUST still run — the sentinel
    // only affects logging and the outbound heal PUT, never the
    // shadow adoption that downstream callers rely on.
    let mut fetched = seeded.clone();
    fetched.permissions = AgentPermissions::empty();
    service.reconcile_permissions_with_shadow(&mut fetched);

    assert!(
        !fetched.permissions.is_empty(),
        "sentinel must not gate the shadow-adoption safety net"
    );
    assert!(fetched
        .permissions
        .capabilities
        .contains(&Capability::SpawnAgent));

    // Sentinel is still set after a known-broken reconcile — only a
    // genuinely non-empty upstream response should clear it.
    assert!(
        service
            .store
            .get_setting(AgentService::PERMISSIONS_UPSTREAM_DROPS_KEY)
            .is_ok(),
        "sentinel must persist when upstream keeps returning empty"
    );
}

#[test]
fn reconcile_clears_sentinel_when_upstream_returns_non_empty() {
    let (service, _dir) = open_service();
    // Sentinel from a previous broken deployment.
    service
        .store
        .put_setting(AgentService::PERMISSIONS_UPSTREAM_DROPS_KEY, b"1")
        .unwrap();

    // Upstream now round-trips the bundle correctly.
    let mut fetched = agent_with_permissions(
        "Atlas",
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::PostToFeed],
        },
    );
    service.reconcile_permissions_with_shadow(&mut fetched);

    assert!(
        service
            .store
            .get_setting(AgentService::PERMISSIONS_UPSTREAM_DROPS_KEY)
            .is_err(),
        "sentinel must auto-clear the moment upstream returns a non-empty bundle"
    );
}

#[test]
fn sentinel_survives_across_service_instances() {
    // Simulates a process restart: the second service instance must
    // observe the sentinel persisted by the first so subsequent boots
    // skip the per-agent WARN + heal-PUT storm.
    let dir = tempfile::TempDir::new().unwrap();
    let store = Arc::new(SettingsStore::open(dir.path()).unwrap());

    let first = AgentService::new(store.clone(), None);
    first
        .store
        .put_setting(AgentService::PERMISSIONS_UPSTREAM_DROPS_KEY, b"1")
        .unwrap();

    drop(first);

    let second = AgentService::new(store, None);
    assert!(
        second
            .store
            .get_setting(AgentService::PERMISSIONS_UPSTREAM_DROPS_KEY)
            .is_ok(),
        "sentinel must persist across AgentService instances backed by the same store"
    );
}
