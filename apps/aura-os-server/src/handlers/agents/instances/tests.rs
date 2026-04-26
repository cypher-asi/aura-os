use super::*;
use super::*;
use aura_os_store::SettingsStore;
use std::sync::Arc;

fn make_agent(name: &str, tags: Vec<String>) -> Agent {
    let now = Utc::now();
    Agent {
        agent_id: AgentId::new(),
        user_id: "u1".to_string(),
        org_id: None,
        name: name.to_string(),
        role: "general".to_string(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: Vec::new(),
        icon: None,
        machine_type: "local".to_string(),
        adapter_type: "aura_harness".to_string(),
        environment: "local_host".to_string(),
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags,
        is_pinned: false,
        listing_status: Default::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: aura_os_core::AgentPermissions::empty(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

fn make_service() -> (AgentService, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(dir.path()).unwrap());
    (AgentService::new(store, None), dir)
}

#[test]
fn repairs_empty_name_on_general_agent_and_persists_shadow() {
    let (service, _dir) = make_service();
    let agent = make_agent("", vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()]);
    let agent_id = agent.agent_id;
    service.save_agent_shadow(&agent).unwrap();

    let repaired = repair_agent_name_if_missing(&service, Some(agent)).expect("repaired agent");
    assert_eq!(repaired.name, GENERAL_AGENT_NAME);

    let reloaded = service.get_agent_local(&agent_id).unwrap();
    assert_eq!(reloaded.name, GENERAL_AGENT_NAME);
}

#[test]
fn repairs_whitespace_only_name_on_general_agent() {
    let (service, _dir) = make_service();
    let agent = make_agent("   ", vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()]);
    let agent_id = agent.agent_id;
    service.save_agent_shadow(&agent).unwrap();

    let repaired = repair_agent_name_if_missing(&service, Some(agent)).unwrap();
    assert_eq!(repaired.name, GENERAL_AGENT_NAME);

    let reloaded = service.get_agent_local(&agent_id).unwrap();
    assert_eq!(reloaded.name, GENERAL_AGENT_NAME);
}

#[test]
fn preserves_existing_name() {
    let (service, _dir) = make_service();
    let agent = make_agent("My Named Agent", Vec::new());
    let agent_id = agent.agent_id;
    service.save_agent_shadow(&agent).unwrap();

    let repaired = repair_agent_name_if_missing(&service, Some(agent)).unwrap();
    assert_eq!(repaired.name, "My Named Agent");

    let reloaded = service.get_agent_local(&agent_id).unwrap();
    assert_eq!(reloaded.name, "My Named Agent");
}

#[test]
fn repairs_untagged_project_agent_with_empty_name() {
    // Project agents that aren't tagged project_local_general still get
    // the same placeholder treatment so the UI sidebar never shows blanks;
    // first-message rename (which is allowed for any agent whose current
    // name is the placeholder) takes over from there.
    let (service, _dir) = make_service();
    let agent = make_agent("", Vec::new());
    let agent_id = agent.agent_id;
    service.save_agent_shadow(&agent).unwrap();

    let repaired = repair_agent_name_if_missing(&service, Some(agent)).unwrap();
    assert_eq!(repaired.name, GENERAL_AGENT_NAME);

    let reloaded = service.get_agent_local(&agent_id).unwrap();
    assert_eq!(reloaded.name, GENERAL_AGENT_NAME);
}

#[test]
fn returns_none_when_input_is_none() {
    let (service, _dir) = make_service();
    assert!(repair_agent_name_if_missing(&service, None).is_none());
}

#[test]
fn agent_deserializes_with_missing_name_key_as_empty_string() {
    let original = make_agent("Ignored", vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()]);
    let mut value = serde_json::to_value(&original).unwrap();
    value
        .as_object_mut()
        .expect("agent json object")
        .remove("name");
    let agent: Agent =
        serde_json::from_value(value).expect("missing name key should deserialize to default");
    assert_eq!(agent.name, "");
}

#[test]
fn repair_runs_on_agent_whose_stored_json_had_no_name_key() {
    let (service, _dir) = make_service();
    let original = make_agent("placeholder", Vec::new());
    let agent_id = original.agent_id;

    let mut value = serde_json::to_value(&original).unwrap();
    value
        .as_object_mut()
        .expect("agent json object")
        .remove("name");
    let reloaded: Agent = serde_json::from_value(value).unwrap();
    assert_eq!(reloaded.name, "");
    service.save_agent_shadow(&reloaded).unwrap();

    let repaired = repair_agent_name_if_missing(&service, Some(reloaded)).unwrap();
    assert_eq!(repaired.name, GENERAL_AGENT_NAME);

    let disk = service.get_agent_local(&agent_id).unwrap();
    assert_eq!(disk.name, GENERAL_AGENT_NAME);
}
