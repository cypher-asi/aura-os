//! Serde-contract tests covering NetworkAgent and CreateAgentResponse JSON shapes.

#[test]
fn network_agent_deserializes_vm_id() {
    let json = r#"{"id":"abc","name":"test","userId":"u1","vmId":"pod-123"}"#;
    let agent: aura_os_network::NetworkAgent = serde_json::from_str(json).unwrap();
    assert_eq!(agent.vm_id.as_deref(), Some("pod-123"));
}

#[test]
fn network_agent_deserializes_without_vm_id() {
    let json = r#"{"id":"abc","name":"test","userId":"u1"}"#;
    let agent: aura_os_network::NetworkAgent = serde_json::from_str(json).unwrap();
    assert_eq!(agent.vm_id, None);
}

#[test]
fn update_agent_request_serializes_vm_id() {
    let req = aura_os_network::UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: Some("pod-123".to_string()),
        tags: None,
        listing_status: None,
        expertise: None,
        permissions: None,
        intent_classifier: None,
    };
    let val = serde_json::to_value(&req).unwrap();
    assert_eq!(val["vmId"], "pod-123");

    let obj = val.as_object().unwrap();
    assert_eq!(
        obj.len(),
        1,
        "only vmId should be serialized (skip_serializing_if = None), got keys: {:?}",
        obj.keys().collect::<Vec<_>>()
    );
}

#[test]
fn update_agent_request_skips_none_vm_id() {
    let req = aura_os_network::UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: None,
        tags: None,
        listing_status: None,
        expertise: None,
        permissions: None,
        intent_classifier: None,
    };
    let val = serde_json::to_value(&req).unwrap();
    let obj = val.as_object().unwrap();
    assert!(
        !obj.contains_key("vmId"),
        "vmId should not appear when None, got: {val}"
    );
}

#[test]
fn swarm_create_agent_response_deserializes_pod_id() {
    let json = r#"{"agent_id":"a1","status":"running","pod_id":"pod-1"}"#;
    let resp: aura_os_harness::CreateAgentResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.agent_id, "a1");
    assert_eq!(resp.status, "running");
    assert_eq!(resp.pod_id.as_deref(), Some("pod-1"));
}

#[test]
fn swarm_create_agent_response_without_pod_id() {
    let json = r#"{"agent_id":"a1","status":"running"}"#;
    let resp: aura_os_harness::CreateAgentResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.agent_id, "a1");
    assert_eq!(resp.pod_id, None);
}
