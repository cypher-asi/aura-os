use super::{
    automaton_start_params_to_runtime_request, normalize_automaton_event,
    validate_automaton_start_identity, AutomatonStartParams,
};
use crate::error::HarnessError;
use aura_protocol::{AgentPermissionsWire, AgentScopeWire, CapabilityWire};

#[test]
fn automaton_start_params_serializes_agent_permissions() {
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: None,
        aura_agent_id: None,
        template_agent_id: None,
        auth_token: None,
        model: None,
        provider_overrides: None,
        user_id: None,
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire {
            scope: AgentScopeWire::default(),
            capabilities: vec![CapabilityWire::InvokeProcess],
        },
        tool_permissions: None,
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: None,
        aura_session_id: "session-1".into(),
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
        project_info: None,
    };

    let value = serde_json::to_value(params).expect("serialize params");

    assert_eq!(
        value["agent_permissions"]["capabilities"][0]["type"],
        "invokeProcess"
    );
}

#[test]
fn automaton_start_params_skips_pr_b_identity_fields_when_empty() {
    // PR B contract: aura-os does not populate `agent_identity` /
    // `agent_skills` / `agent_system_prompt` yet, so they must serialise
    // as ABSENT (not as `null` or `[]`) so older harnesses see the same
    // wire shape they did pre-PR-B.
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: None,
        aura_agent_id: None,
        template_agent_id: None,
        auth_token: None,
        model: None,
        provider_overrides: None,
        user_id: None,
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        tool_permissions: None,
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: None,
        aura_session_id: "session-1".into(),
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
        project_info: None,
    };

    let value = serde_json::to_value(&params).expect("serialize params");
    let object = value.as_object().expect("top-level object");
    assert!(
        !object.contains_key("agent_identity"),
        "agent_identity must be skipped when None: {value}",
    );
    assert!(
        !object.contains_key("agent_skills"),
        "agent_skills must be skipped when empty: {value}",
    );
    assert!(
        !object.contains_key("agent_system_prompt"),
        "agent_system_prompt must be skipped when None: {value}",
    );
}

#[test]
fn automaton_start_params_serializes_pr_b_identity_fields_when_populated() {
    // Forward-compat for PR C: confirm the wire shape matches what the
    // harness's `AutomatonStartRequest` expects once `aura-os` flips
    // the populator on.
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: None,
        aura_agent_id: None,
        template_agent_id: None,
        auth_token: None,
        model: None,
        provider_overrides: None,
        user_id: None,
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        tool_permissions: None,
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: None,
        aura_session_id: "session-1".into(),
        agent_identity: Some(aura_protocol::AgentPersona {
            name: "Aura".into(),
            role: "engineer".into(),
            personality: "concise".into(),
        }),
        agent_skills: vec!["rust".into(), "frontend".into()],
        agent_system_prompt: Some("Be terse.".into()),
        project_info: None,
    };

    let value = serde_json::to_value(&params).expect("serialize params");

    assert_eq!(value["agent_identity"]["name"], "Aura");
    assert_eq!(value["agent_identity"]["role"], "engineer");
    assert_eq!(value["agent_identity"]["personality"], "concise");
    assert_eq!(value["agent_skills"][0], "rust");
    assert_eq!(value["agent_skills"][1], "frontend");
    assert_eq!(value["agent_system_prompt"], "Be terse.");
}

#[test]
fn automaton_start_params_serializes_proxy_identity_context() {
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: Some("template-1::instance-1".into()),
        aura_agent_id: Some("template-1".into()),
        template_agent_id: Some("template-1".into()),
        auth_token: Some("jwt".into()),
        model: Some("aura-claude-opus-4-7".into()),
        provider_overrides: Some(aura_protocol::SessionModelOverrides {
            default_model: Some("aura-claude-opus-4-7".into()),
            fallback_model: None,
            prompt_caching_enabled: Some(true),
            prompt_cache_key: None,
            prompt_cache_retention: None,
            provider_api_keys: Default::default(),
        }),
        user_id: Some("user-1".into()),
        intent_classifier: None,
        max_turns: Some(40),
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        tool_permissions: None,
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: Some("org-1".into()),
        aura_session_id: "session-1".into(),
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
        project_info: None,
    };

    let value = serde_json::to_value(params).expect("serialize params");

    assert_eq!(value["project_id"], "project-1");
    assert_eq!(value["agent_id"], "template-1::instance-1");
    assert_eq!(value["aura_agent_id"], "template-1");
    assert_eq!(value["template_agent_id"], "template-1");
    assert_eq!(value["aura_org_id"], "org-1");
    assert_eq!(value["aura_session_id"], "session-1");
    assert_eq!(value["auth_token"], "jwt");
    assert_eq!(value["model"], "aura-claude-opus-4-7");
    assert_eq!(
        value["provider_overrides"]["default_model"],
        "aura-claude-opus-4-7"
    );
    assert_eq!(value["provider_overrides"]["prompt_caching_enabled"], true);
    assert_eq!(value["user_id"], "user-1");
    assert_eq!(value["max_turns"], 40);
}

fn full_valid_params() -> AutomatonStartParams {
    AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: Some("template-1::instance-1".into()),
        aura_agent_id: Some("template-1".into()),
        template_agent_id: Some("template-1".into()),
        auth_token: Some("jwt".into()),
        model: None,
        provider_overrides: None,
        user_id: Some("user-1".into()),
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        tool_permissions: None,
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: Some("org-1".into()),
        aura_session_id: "session-1".into(),
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
        project_info: None,
    }
}

#[test]
fn validate_automaton_start_identity_accepts_full_params() {
    assert!(validate_automaton_start_identity(&full_valid_params()).is_ok());
}

#[test]
fn validate_automaton_start_identity_rejects_missing_org_id() {
    let mut params = full_valid_params();
    params.aura_org_id = None;
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "aura_org_id",
            context: "automaton_start",
        }
    ));
}

#[test]
fn validate_automaton_start_identity_rejects_blank_session_id() {
    let mut params = full_valid_params();
    params.aura_session_id = "   ".into();
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "aura_session_id",
            ..
        }
    ));
}

#[test]
fn automaton_runtime_request_preserves_stable_session_identity() {
    let request = automaton_start_params_to_runtime_request(&full_valid_params());
    let wire = serde_json::to_value(request).expect("serialize canonical runtime request");

    assert_eq!(wire["project"]["aura_session_id"], "session-1");
}

#[test]
fn validate_automaton_start_identity_accepts_when_only_partition_agent_id_present() {
    // The harness only needs *some* agent identity for X-Aura-Agent-Id;
    // the partition `agent_id` alone is enough.
    let mut params = full_valid_params();
    params.template_agent_id = None;
    params.aura_agent_id = None;
    assert!(validate_automaton_start_identity(&params).is_ok());
}

#[test]
fn validate_automaton_start_identity_rejects_when_no_agent_identity_at_all() {
    let mut params = full_valid_params();
    params.template_agent_id = None;
    params.aura_agent_id = None;
    params.agent_id = None;
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "agent_id",
            ..
        }
    ));
}

#[test]
fn validate_automaton_start_identity_rejects_missing_auth_token() {
    let mut params = full_valid_params();
    params.auth_token = None;
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "auth_token",
            ..
        }
    ));
}

#[test]
fn validate_automaton_start_identity_does_not_require_user_id() {
    // Scheduled-process / runner flows may genuinely have no
    // signed-in user; the harness must still accept those.
    let mut params = full_valid_params();
    params.user_id = None;
    assert!(validate_automaton_start_identity(&params).is_ok());
}

#[test]
fn normalize_automaton_event_promotes_git_sync_milestones() {
    let event = normalize_automaton_event(serde_json::json!({
        "type": "sync_milestone",
        "summary": "Committed and pushed",
        "milestone": {
            "kind": "git_pushed",
            "commit_sha": "abc12345",
            "branch": "main",
            "remote": "origin",
            "push_id": "push-1",
            "commits": ["abc12345"],
        }
    }));

    assert_eq!(event["type"], "git_pushed");
    assert_eq!(event["commit_sha"], "abc12345");
    assert_eq!(event["branch"], "main");
    assert_eq!(event["remote"], "origin");
    assert_eq!(event["push_id"], "push-1");
    assert_eq!(event["summary"], "Committed and pushed");
}
