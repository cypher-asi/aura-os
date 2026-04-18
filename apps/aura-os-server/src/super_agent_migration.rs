//! Phase 6 one-shot, idempotent migrator for legacy super-agent records.
//!
//! The unification plan
//! (`plans/unify_super_agents_into_harness_630aa7f8.plan.md`, section
//! **"Phase 6 migration (one-shot, idempotent)"**) calls for every
//! legacy super-agent record (either `role == "super_agent"` or tagged
//! `"super_agent"`) to be:
//!
//! 1. Routed through the harness by default
//!    (tag: `host_mode:harness`), unless an operator has explicitly
//!    pinned it to the in-process path with `host_mode:in_process`.
//! 2. Marked as expecting the CEO capability preset once Phase 5's
//!    `agent_permissions` feature lights up on the harness side
//!    (tag: `preset:ceo`).
//! 3. Stamped with `migration:super_agent_v1` so this function is a
//!    no-op on subsequent runs.
//!
//! The migration is intentionally conservative:
//!
//! - It only adds tags — it never removes the legacy `super_agent` tag
//!   or mutates other agent fields, so every consumer that still
//!   branches on `role == "super_agent"` or the `"super_agent"` tag
//!   keeps working.
//! - It does **not** seed the harness Kernel record log from aura-os
//!   session events. That seeder would need to write into the harness
//!   RocksDB, which is out of process. Instead the harness cold-starts
//!   the agent from `SessionInit::conversation_messages`, which
//!   `dispatch_super_agent_via_harness` already populates from aura-os
//!   session events on every turn. See
//!   `TODO(phase6-followup): write harness record log seeder` below.
//! - Network pushes are best-effort. On boot the server often has no
//!   cached JWT yet, so the upstream `tags` update simply fails; the
//!   local shadow still gets the new tag set, and the sentinel tag
//!   prevents re-migration. The authoritative record converges the next
//!   time an authenticated caller goes through
//!   [`crate::handlers::agents::crud`] (which does round-trip network
//!   plus local) — or an operator can force a re-push via the normal
//!   update-agent endpoint.
//!
//! ## Rollout env guard
//!
//! Controlled by `AURA_SUPER_AGENT_MIGRATE`:
//!
//! - `auto` (default): run once on startup, log a summary report,
//!   non-fatal on failure.
//! - `off`: skip entirely. Used for rollback scenarios where operators
//!   want to pin existing records to the in-process path until the
//!   harness path has soaked.
//!
//! ## Follow-ups
//!
//! - `TODO(phase6-followup): teach SessionInit to send ceo preset capabilities`
//!   — the `preset:ceo` tag is a hint for the harness-side Policy.
//!   Wiring it through `SessionInit` is deferred until the
//!   `agent_permissions` Cargo feature in aura-harness is flipped on
//!   (currently off by default; see aura-harness `dc06eda`).
//! - `TODO(phase6-followup): write harness record log seeder` — see
//!   rationale above. Lives outside this crate.

use std::collections::BTreeSet;

use aura_os_core::Agent;
use aura_os_network::UpdateAgentRequest;
use tracing::{info, warn};

use crate::state::AppState;

/// Sentinel tag written once the migrator has processed an agent.
pub const MIGRATION_TAG: &str = "migration:super_agent_v1";

/// Tag appended so new routes send these records through the harness
/// path by default.
pub const HOST_MODE_HARNESS_TAG: &str = "host_mode:harness";

/// Operator-set opt-out. When present the migrator must not flip the
/// host mode. Pairs with `AURA_SUPER_AGENT_MIGRATE=off` for rollback.
pub const HOST_MODE_IN_PROCESS_TAG: &str = "host_mode:in_process";

/// Tag advertising the CEO capability preset. Consumed on the harness
/// side once the Phase 5 `agent_permissions` feature is enabled.
pub const PRESET_CEO_TAG: &str = "preset:ceo";

/// Env guard recognized by [`migrate_legacy_super_agents`]. Values:
/// `auto` (default) runs the migrator; `off` skips it.
pub const MIGRATE_ENV: &str = "AURA_SUPER_AGENT_MIGRATE";

/// Summary of what the migrator did on a single invocation.
///
/// Exposed so callers (boot code, tests) can log or assert against it.
/// `examined + skipped_opt_out + already_migrated + failed + migrated`
/// does **not** have to equal the total agent count — only super-agent
/// records show up at all.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct MigrationReport {
    /// How many super-agent records we looked at.
    pub examined: usize,
    /// How many we actually mutated (new tags written).
    pub migrated: usize,
    /// Already carried `migration:super_agent_v1` — skipped.
    pub already_migrated: usize,
    /// Carried an explicit `host_mode:in_process` override — skipped,
    /// per the operator-override rule.
    pub skipped_opt_out: usize,
    /// Attempts that produced an error (logged at `warn!`). Does not
    /// stop the loop.
    pub failed: usize,
    /// `true` when the env guard (`AURA_SUPER_AGENT_MIGRATE`) told us
    /// to no-op entirely.
    pub skipped_via_env: bool,
}

/// Fatal errors from the migrator. Today there are none — the loop is
/// best-effort and logs per-agent failures via `warn!` — but we keep
/// the result type so the entry point can grow a setup-error case
/// without a breaking signature change.
#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    /// Reserved.
    #[error("super-agent migration aborted: {0}")]
    Aborted(String),
}

/// Is this record a legacy super-agent that the migrator should care
/// about?
fn is_legacy_super_agent(agent: &Agent) -> bool {
    agent.role == "super_agent"
        || agent
            .tags
            .iter()
            .any(|t| t.eq_ignore_ascii_case("super_agent"))
}

/// Pure tag transform — returns `Some(new_tags)` when the record is a
/// legacy super-agent that needs migration, or `None` when it should
/// be skipped entirely (already migrated, or explicitly opted out of
/// the host-mode flip).
///
/// Keeping this pure is what lets us unit-test the decision logic
/// without standing up a real `AgentService` / `NetworkClient`.
///
/// Rules, in order:
///
/// 1. Return `None` if the sentinel `migration:super_agent_v1` is
///    already present (idempotency).
/// 2. If `host_mode:in_process` is present, leave host-mode alone —
///    operator override wins. We still stamp `preset:ceo` and the
///    sentinel so the migrator does not re-examine it, but we do
///    **not** add `host_mode:harness`. (Caller should classify these
///    as `skipped_opt_out` rather than `migrated` for telemetry.)
/// 3. Otherwise append `host_mode:harness` if neither host-mode tag
///    is set.
/// 4. Always append `preset:ceo` if missing.
/// 5. Always append `migration:super_agent_v1`.
///
/// Existing tags (including the legacy `super_agent` tag itself) are
/// preserved verbatim. Duplicates collapsed via a BTreeSet round-trip
/// so a record that already carried one of the new tags doesn't end
/// up with two.
#[must_use]
pub fn next_tags_for_legacy_super_agent(existing: &[String]) -> Option<NextTagsOutcome> {
    let has_sentinel = existing
        .iter()
        .any(|t| t.eq_ignore_ascii_case(MIGRATION_TAG));
    if has_sentinel {
        return None;
    }

    let has_harness = existing
        .iter()
        .any(|t| t.eq_ignore_ascii_case(HOST_MODE_HARNESS_TAG));
    let has_in_process = existing
        .iter()
        .any(|t| t.eq_ignore_ascii_case(HOST_MODE_IN_PROCESS_TAG));
    let opted_out = has_in_process && !has_harness;

    // Preserve order while de-duplicating (case-sensitive match on the
    // exact value the caller wrote; we only case-insensitively check
    // whether a tag is *already* present).
    let mut seen: BTreeSet<String> = existing.iter().map(|t| t.to_ascii_lowercase()).collect();
    let mut new_tags: Vec<String> = existing.to_vec();

    let push_unique = |tag: &str, new_tags: &mut Vec<String>, seen: &mut BTreeSet<String>| {
        let lower = tag.to_ascii_lowercase();
        if seen.insert(lower) {
            new_tags.push(tag.to_string());
        }
    };

    if !opted_out && !has_harness {
        push_unique(HOST_MODE_HARNESS_TAG, &mut new_tags, &mut seen);
    }
    push_unique(PRESET_CEO_TAG, &mut new_tags, &mut seen);
    push_unique(MIGRATION_TAG, &mut new_tags, &mut seen);

    if new_tags == existing {
        // Nothing to do — should only happen on records that already
        // had sentinel (handled above) but we guard anyway.
        return None;
    }

    Some(NextTagsOutcome {
        new_tags,
        skipped_opt_out: opted_out,
    })
}

/// Output of [`next_tags_for_legacy_super_agent`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextTagsOutcome {
    /// Updated tag list to persist.
    pub new_tags: Vec<String>,
    /// `true` when the operator pinned this record to `host_mode:in_process`.
    /// Reported as `skipped_opt_out` in [`MigrationReport`] rather than
    /// `migrated`, so dashboards can distinguish "we flipped this" from
    /// "we stamped sentinel + preset but respected the pin".
    pub skipped_opt_out: bool,
}

/// Read the env guard. Separated so tests can hit both branches
/// without setting process-global env.
fn should_run_from_env() -> bool {
    match std::env::var(MIGRATE_ENV) {
        Ok(v) if v.eq_ignore_ascii_case("off") => false,
        // `auto` or anything else falls through to "run". Defaulting
        // unknown values to "run" is intentional: if an operator
        // misspells `auto` we would rather run than silently skip.
        _ => true,
    }
}

/// Entry point. Runs through every local super-agent record, applies
/// the idempotent tag transform, and best-effort pushes the new tag
/// list upstream.
///
/// Never panics. Per-agent errors are logged and counted; the loop
/// continues.
pub async fn migrate_legacy_super_agents(
    state: &AppState,
) -> Result<MigrationReport, MigrationError> {
    let mut report = MigrationReport::default();

    if !should_run_from_env() {
        report.skipped_via_env = true;
        info!(
            env = MIGRATE_ENV,
            "super-agent migrator skipped (env guard set to off)"
        );
        return Ok(report);
    }

    let local_agents = match state.agent_service.list_agents() {
        Ok(a) => a,
        Err(err) => {
            warn!(error = %err, "super-agent migrator: could not list local agents — giving up");
            return Ok(report);
        }
    };

    for agent in local_agents.into_iter().filter(is_legacy_super_agent) {
        report.examined += 1;
        let agent_id = agent.agent_id;

        let Some(outcome) = next_tags_for_legacy_super_agent(&agent.tags) else {
            report.already_migrated += 1;
            continue;
        };

        let mut updated = agent.clone();
        updated.tags = outcome.new_tags.clone();

        // 1) Local shadow write — always attempted. This is what gates
        //    routing inside the current process if network is
        //    unreachable.
        if let Err(err) = state.agent_service.save_agent_shadow(&updated) {
            warn!(
                %agent_id,
                error = %err,
                "super-agent migrator: failed to persist updated tags to local shadow"
            );
            report.failed += 1;
            continue;
        }

        // 2) Network push — best-effort. Skipped silently when no JWT
        //    (typical on fresh boot before the user has signed in);
        //    logged at `info!` for observability otherwise.
        push_tags_upstream(state, &updated).await;

        // 3) Drop any stale in-memory conversation cache — the harness
        //    path writes its own transcript and we don't want the old
        //    legacy cache to shadow it on the first post-migration
        //    turn.
        clear_conversation_cache(state, agent_id).await;

        if outcome.skipped_opt_out {
            info!(
                %agent_id,
                "super-agent migrator: pinned agent (host_mode:in_process) — left host mode untouched, stamped sentinel"
            );
            report.skipped_opt_out += 1;
        } else {
            info!(
                %agent_id,
                tags = ?outcome.new_tags,
                "super-agent migrator: migrated legacy super-agent"
            );
            report.migrated += 1;
        }
    }

    info!(
        examined = report.examined,
        migrated = report.migrated,
        already_migrated = report.already_migrated,
        skipped_opt_out = report.skipped_opt_out,
        failed = report.failed,
        "super-agent migrator: run complete"
    );

    Ok(report)
}

async fn push_tags_upstream(state: &AppState, agent: &Agent) {
    let Some(network) = state.network_client.as_ref() else {
        return;
    };
    let Some(jwt) = state.store.get_cached_zero_auth_session() else {
        // No authenticated session yet. Fine — local shadow + sentinel
        // already landed, and the next authenticated CRUD round-trip
        // will push the tag list through the normal update path.
        return;
    };
    let Some(net_id) = agent.network_agent_id.map(|id| id.to_string()) else {
        return;
    };

    let req = UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: None,
        tags: Some(agent.tags.clone()),
    };

    match network.update_agent(&net_id, &jwt.access_token, &req).await {
        Ok(_) => {
            info!(
                agent_id = %agent.agent_id,
                "super-agent migrator: pushed migrated tags upstream to aura-network"
            );
        }
        Err(err) => {
            warn!(
                agent_id = %agent.agent_id,
                error = %err,
                "super-agent migrator: upstream tag push failed (local shadow already updated; will retry on next CRUD round-trip)"
            );
        }
    }
}

async fn clear_conversation_cache(state: &AppState, agent_id: aura_os_core::AgentId) {
    let key = format!("super_agent:{agent_id}");
    let mut cache = state.super_agent_messages.lock().await;
    cache.remove(&key);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_super_agent_with_no_tags_gets_full_set() {
        let existing = vec!["super_agent".to_string()];
        let outcome = next_tags_for_legacy_super_agent(&existing).expect("needs migration");
        assert!(!outcome.skipped_opt_out);
        assert!(outcome.new_tags.contains(&"super_agent".to_string()));
        assert!(outcome.new_tags.contains(&HOST_MODE_HARNESS_TAG.to_string()));
        assert!(outcome.new_tags.contains(&PRESET_CEO_TAG.to_string()));
        assert!(outcome.new_tags.contains(&MIGRATION_TAG.to_string()));
    }

    #[test]
    fn already_migrated_returns_none() {
        let existing = vec![
            "super_agent".to_string(),
            HOST_MODE_HARNESS_TAG.to_string(),
            PRESET_CEO_TAG.to_string(),
            MIGRATION_TAG.to_string(),
        ];
        assert!(next_tags_for_legacy_super_agent(&existing).is_none());
    }

    #[test]
    fn idempotent_on_second_call() {
        let existing = vec!["super_agent".to_string()];
        let first = next_tags_for_legacy_super_agent(&existing)
            .expect("first pass migrates")
            .new_tags;
        assert!(
            next_tags_for_legacy_super_agent(&first).is_none(),
            "second call should be a no-op after sentinel is stamped"
        );
    }

    #[test]
    fn in_process_pin_is_respected_but_still_stamped() {
        let existing = vec![
            "super_agent".to_string(),
            HOST_MODE_IN_PROCESS_TAG.to_string(),
        ];
        let outcome = next_tags_for_legacy_super_agent(&existing).expect("still stamps");
        assert!(outcome.skipped_opt_out);
        assert!(
            !outcome
                .new_tags
                .iter()
                .any(|t| t.eq_ignore_ascii_case(HOST_MODE_HARNESS_TAG)),
            "operator pin (host_mode:in_process) must not be overridden"
        );
        assert!(outcome
            .new_tags
            .iter()
            .any(|t| t.eq_ignore_ascii_case(MIGRATION_TAG)));
        assert!(outcome
            .new_tags
            .iter()
            .any(|t| t.eq_ignore_ascii_case(PRESET_CEO_TAG)));
    }

    #[test]
    fn existing_harness_tag_not_duplicated() {
        let existing = vec![
            "super_agent".to_string(),
            HOST_MODE_HARNESS_TAG.to_string(),
        ];
        let outcome = next_tags_for_legacy_super_agent(&existing).expect("still needs preset + sentinel");
        let harness_count = outcome
            .new_tags
            .iter()
            .filter(|t| t.eq_ignore_ascii_case(HOST_MODE_HARNESS_TAG))
            .count();
        assert_eq!(harness_count, 1, "must not duplicate host_mode:harness");
    }

    #[test]
    fn is_legacy_matches_role_or_tag() {
        let now = chrono::Utc::now();
        let mut a = Agent {
            agent_id: aura_os_core::AgentId::new(),
            user_id: String::new(),
            org_id: None,
            name: "x".into(),
            role: "super_agent".into(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: Vec::new(),
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: String::new(),
            auth_source: String::new(),
            integration_id: None,
            default_model: None,
            vm_id: None,
            network_agent_id: None,
            profile_id: None,
            tags: Vec::new(),
            is_pinned: false,
            local_workspace_path: None,
            created_at: now,
            updated_at: now,
        };
        assert!(is_legacy_super_agent(&a));

        a.role = "regular".into();
        assert!(!is_legacy_super_agent(&a));

        a.tags = vec!["super_agent".to_string()];
        assert!(is_legacy_super_agent(&a));

        a.tags = vec!["SUPER_AGENT".to_string()];
        assert!(
            is_legacy_super_agent(&a),
            "tag match must be case-insensitive"
        );
    }

    #[test]
    fn regular_agent_is_not_legacy() {
        let existing = vec!["some-other-tag".to_string()];
        // Direct pure-helper call: a regular agent would never reach
        // `next_tags_for_legacy_super_agent` in the real flow, but
        // callers should get `Some` only if the record is actually
        // stamped-as-legacy — the helper itself doesn't know the role,
        // so this test just documents that the helper always
        // transforms (it's the caller's job to filter). Kept as a
        // regression-guard against accidental no-op.
        let outcome = next_tags_for_legacy_super_agent(&existing);
        assert!(
            outcome.is_some(),
            "helper transforms any record it sees; filtering is caller-side"
        );
    }

    // ---- Integration-style tests that drive the full entry point ----
    //
    // These spin up a real `AppState` via `build_app_state` against a
    // tempdir RocksDB. The network client is left unset (no
    // `AURA_NETWORK_URL` env in tests) so `push_tags_upstream`
    // short-circuits — which is exactly the boot-before-signin case
    // the migrator was designed for.

    fn mk_agent(role: &str, tags: Vec<String>) -> Agent {
        let now = chrono::Utc::now();
        Agent {
            agent_id: aura_os_core::AgentId::new(),
            user_id: String::new(),
            org_id: None,
            name: "test".into(),
            role: role.into(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: Vec::new(),
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: "local_host".into(),
            auth_source: "aura_managed".into(),
            integration_id: None,
            default_model: None,
            vm_id: None,
            network_agent_id: None,
            profile_id: None,
            tags,
            is_pinned: false,
            local_workspace_path: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn migrate_selects_only_unmigrated_legacy_super_agents() {
        // Make sure env guard defaults to "run" regardless of ambient env.
        std::env::remove_var(MIGRATE_ENV);

        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let state = crate::build_app_state(&db_path).expect("build app state");

        let legacy = mk_agent("super_agent", vec!["super_agent".into()]);
        let already = mk_agent(
            "super_agent",
            vec![
                "super_agent".into(),
                HOST_MODE_HARNESS_TAG.into(),
                PRESET_CEO_TAG.into(),
                MIGRATION_TAG.into(),
            ],
        );
        let regular = mk_agent("developer", vec!["team:frontend".into()]);

        let legacy_id = legacy.agent_id;
        let already_id = already.agent_id;
        let regular_id = regular.agent_id;

        for a in [&legacy, &already, &regular] {
            state
                .agent_service
                .save_agent_shadow(a)
                .expect("seed shadow");
        }

        let report = migrate_legacy_super_agents(&state).await.expect("migrate");
        assert_eq!(report.examined, 2, "legacy + already, not regular");
        assert_eq!(report.migrated, 1);
        assert_eq!(report.already_migrated, 1);
        assert_eq!(report.skipped_opt_out, 0);
        assert_eq!(report.failed, 0);
        assert!(!report.skipped_via_env);

        let after_legacy = state
            .agent_service
            .list_agents()
            .unwrap()
            .into_iter()
            .find(|a| a.agent_id == legacy_id)
            .expect("legacy still there");
        assert!(after_legacy
            .tags
            .iter()
            .any(|t| t == HOST_MODE_HARNESS_TAG));
        assert!(after_legacy.tags.iter().any(|t| t == PRESET_CEO_TAG));
        assert!(after_legacy.tags.iter().any(|t| t == MIGRATION_TAG));
        assert!(
            after_legacy.tags.iter().any(|t| t == "super_agent"),
            "legacy tag must be preserved for back-compat"
        );

        let after_regular = state
            .agent_service
            .list_agents()
            .unwrap()
            .into_iter()
            .find(|a| a.agent_id == regular_id)
            .expect("regular still there");
        assert_eq!(
            after_regular.tags,
            vec!["team:frontend".to_string()],
            "regular agents must not be touched"
        );

        // Second call must be a no-op on all three records.
        let second = migrate_legacy_super_agents(&state)
            .await
            .expect("migrate idempotent");
        assert_eq!(second.migrated, 0, "idempotent: nothing migrates twice");
        assert_eq!(second.already_migrated, 2, "both super-agents already done");
        assert_eq!(second.failed, 0);

        // Suppress unused warning on already_id when assertions above
        // short-circuit during test-failure dev loops.
        let _ = already_id;
    }

    #[tokio::test]
    async fn migrate_respects_env_off() {
        std::env::set_var(MIGRATE_ENV, "off");

        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let state = crate::build_app_state(&db_path).expect("build app state");

        let legacy = mk_agent("super_agent", vec!["super_agent".into()]);
        let legacy_id = legacy.agent_id;
        state
            .agent_service
            .save_agent_shadow(&legacy)
            .expect("seed");

        let report = migrate_legacy_super_agents(&state).await.expect("migrate");
        assert!(report.skipped_via_env);
        assert_eq!(report.examined, 0);

        let after = state
            .agent_service
            .list_agents()
            .unwrap()
            .into_iter()
            .find(|a| a.agent_id == legacy_id)
            .expect("still there");
        assert_eq!(
            after.tags,
            vec!["super_agent".to_string()],
            "AURA_SUPER_AGENT_MIGRATE=off must not mutate records"
        );

        std::env::remove_var(MIGRATE_ENV);
    }
}
