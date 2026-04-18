#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::Arc;

    use serde_json::json;
    use tokio::sync::broadcast;

    use aura_os_agents::{AgentInstanceService, AgentService, RuntimeAgentStateMap};
    use aura_os_billing::BillingClient;
    use aura_os_link::AutomatonClient;
    use aura_os_orgs::OrgService;
    use aura_os_projects::ProjectService;
    use aura_os_sessions::SessionService;
    use aura_os_store::SettingsStore;
    use aura_os_tasks::TaskService;

    use crate::tools::{AgentToolContext, AgentTool, ToolRegistry};

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SharedProjectToolManifestEntry {
        name: String,
    }

    fn build_test_ctx(store: Arc<SettingsStore>) -> AgentToolContext {
        let runtime_state: RuntimeAgentStateMap =
            Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let (tx, _) = broadcast::channel(16);
        AgentToolContext {
            user_id: "test-user".into(),
            org_id: "test-org".into(),
            jwt: "test-jwt".into(),
            project_service: Arc::new(ProjectService::new(store.clone())),
            agent_service: Arc::new(AgentService::new(store.clone(), None)),
            agent_instance_service: Arc::new(AgentInstanceService::new(
                store.clone(),
                None,
                runtime_state,
                None,
            )),
            task_service: Arc::new(TaskService::new(store.clone(), None)),
            session_service: Arc::new(SessionService::new(store.clone(), 0.8, 200_000)),
            org_service: Arc::new(OrgService::new(store.clone())),
            billing_client: Arc::new(BillingClient::new()),
            automaton_client: Arc::new(AutomatonClient::new("http://localhost:0".into())),
            orbit_client: None,
            network_client: None,
            storage_client: None,
            store: store.clone(),
            event_broadcast: tx,
            local_server_base_url: None,
            local_http_client: reqwest::Client::new(),
        }
    }

    fn temp_store() -> (tempfile::TempDir, Arc<SettingsStore>) {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SettingsStore::open(dir.path()).unwrap());
        (dir, store)
    }

    // -----------------------------------------------------------------------
    // Schema validation -- every registered tool has a valid JSON schema
    // -----------------------------------------------------------------------

    #[test]
    fn test_all_tool_schemas_are_valid_objects() {
        let registry = ToolRegistry::with_all_tools();
        for tool in registry.list_tools() {
            let schema = tool.parameters_schema();
            assert_eq!(
                schema["type"].as_str(),
                Some("object"),
                "Tool '{}' schema type must be 'object'",
                tool.name()
            );
            assert!(
                schema["properties"].is_object(),
                "Tool '{}' schema must have 'properties' object",
                tool.name()
            );
            assert!(
                schema["required"].is_array(),
                "Tool '{}' schema must have 'required' array",
                tool.name()
            );
        }
    }

    #[test]
    fn test_tool_names_are_unique() {
        let registry = ToolRegistry::with_all_tools();
        let tools = registry.list_tools();
        let mut names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        let count_before = names.len();
        names.sort();
        names.dedup();
        assert_eq!(
            names.len(),
            count_before,
            "Duplicate tool names found in registry"
        );
    }

    #[test]
    fn shared_project_manifest_tools_exist_in_registry() {
        let manifest: Vec<SharedProjectToolManifestEntry> = serde_json::from_str(include_str!(
            "../../../../infra/shared/project-control-plane-tools.json"
        ))
        .expect("shared project control-plane manifest should parse");

        let registry = ToolRegistry::with_all_tools();
        let registry_names: HashSet<String> = registry
            .list_tools()
            .into_iter()
            .map(|tool| tool.name().to_string())
            .collect();

        for tool in manifest {
            assert!(
                registry_names.contains(&tool.name),
                "shared project tool '{}' must exist in the harness registry",
                tool.name
            );
        }
    }

    #[test]
    fn test_tool_definitions_format() {
        let registry = ToolRegistry::with_all_tools();
        let tools = registry.list_tools();
        let defs = registry.tool_definitions(&tools);
        for def in &defs {
            assert!(def["name"].is_string(), "Tool def missing 'name'");
            assert!(
                def["description"].is_string(),
                "Tool def missing 'description'"
            );
            assert!(
                def["input_schema"].is_object(),
                "Tool def missing 'input_schema'"
            );
        }
    }

    #[test]
    fn streaming_tools_opt_into_eager_input_streaming() {
        let registry = ToolRegistry::with_all_tools();
        let tools = registry.list_tools();
        let defs = registry.tool_definitions(&tools);

        // The spec tools are the ones registered in the super-agent registry
        // whose arguments we stream via `input_json_delta`; file tools live
        // in adapter-provided registries outside this crate but share the
        // `is_streaming_tool_name` list.
        for name in ["create_spec", "update_spec"] {
            let def = defs
                .iter()
                .find(|d| d["name"].as_str() == Some(name))
                .unwrap_or_else(|| panic!("missing tool def for '{name}'"));
            assert_eq!(
                def["eager_input_streaming"].as_bool(),
                Some(true),
                "tool '{name}' must opt into fine-grained tool streaming"
            );
        }

        let non_streaming = defs
            .iter()
            .find(|d| d["name"].as_str() == Some("create_task"))
            .expect("expected create_task def");
        assert!(
            non_streaming.get("eager_input_streaming").is_none(),
            "non-streaming tools should not carry eager_input_streaming"
        );
    }

    #[test]
    fn is_streaming_tool_name_covers_spec_and_file_tools() {
        assert!(super::super::is_streaming_tool_name("create_spec"));
        assert!(super::super::is_streaming_tool_name("update_spec"));
        assert!(super::super::is_streaming_tool_name("write_file"));
        assert!(super::super::is_streaming_tool_name("edit_file"));
        assert!(!super::super::is_streaming_tool_name("create_task"));
        assert!(!super::super::is_streaming_tool_name("read_file"));
    }

    // -----------------------------------------------------------------------
    // Network-required tools return graceful errors when offline
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_network_required_tools_return_error_offline() {
        let (_dir, store) = temp_store();
        let ctx = build_test_ctx(store);

        let network_tools: &[&str] = &[
            "list_orgs",
            "create_org",
            "get_org",
            "update_org",
            "list_members",
            "update_member_role",
            "remove_member",
            "manage_invites",
            "list_specs",
            "get_spec",
            "create_spec",
            "update_spec",
            "delete_spec",
            "generate_specs",
            "generate_specs_summary",
            "list_tasks",
            "list_tasks_by_spec",
            "get_task",
            "create_task",
            "update_task",
            "delete_task",
            "transition_task",
            "retry_task",
            "run_task",
            "get_task_output",
            "extract_tasks",
            "get_leaderboard",
            "get_usage_stats",
            "list_sessions",
            "list_log_entries",
            "get_transactions",
            "get_billing_account",
            "purchase_credits",
            "list_feed",
            "create_post",
            "get_post",
            "add_comment",
            "delete_comment",
            "follow_profile",
            "unfollow_profile",
            "list_follows",
            "assign_agent_to_project",
            "list_agent_instances",
            "update_agent_instance",
            "delete_agent_instance",
            "remote_agent_action",
            "browse_files",
            "read_file",
            "get_environment_info",
            "get_remote_agent_state",
        ];

        let registry = ToolRegistry::with_all_tools();
        for name in network_tools {
            let tool = registry.get(name);
            assert!(tool.is_some(), "Tool '{}' not found in registry", name);
            let tool = tool.unwrap();

            let dummy_input = json!({
                "project_id": "test-pid",
                "agent_id": "test-aid",
                "agent_instance_id": "test-aiid",
                "task_id": "test-tid",
                "spec_id": "test-sid",
                "org_id": "test-org",
                "post_id": "test-post",
                "comment_id": "test-cid",
                "target_profile_id": "test-prof",
                "invite_id": "test-inv",
                "user_id": "test-uid",
                "automaton_id": "test-auto",
                "title": "test",
                "content": "test",
                "message": "test",
                "action": "list",
                "new_status": "done",
                "status": "idle",
                "role": "member",
                "name": "test",
                "amount_usd": 10.0,
                "path": "/",
            });

            let result = tool.execute(dummy_input, &ctx).await;
            match result {
                Ok(r) => assert!(
                    r.is_error,
                    "Tool '{}' should return is_error=true when offline, got success",
                    name
                ),
                Err(_) => {} // AgentRuntimeError::Internal is also acceptable
            }
        }
    }

    // -----------------------------------------------------------------------
    // Local fallback tools work with seeded data
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_list_agents_local_fallback() {
        let (_dir, store) = temp_store();
        let ctx = build_test_ctx(store);

        let aid = aura_os_core::AgentId::new();
        let agent = aura_os_core::Agent {
            agent_id: aid,
            user_id: "u1".into(),
            org_id: None,
            name: "TestAgent".into(),
            role: "developer".into(),
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
            permissions: aura_os_core::AgentPermissions::empty(),
            intent_classifier: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        ctx.agent_service.save_agent_shadow(&agent).unwrap();

        // Verify the shadow roundtrips via direct key lookup
        let fetched = ctx.agent_service.get_agent_local(&aid).unwrap();
        assert_eq!(fetched.name, "TestAgent");

        // The tool without network should use the local path
        let tool = crate::tools::agent_tools::ListAgentsTool;
        let result = tool.execute(json!({}), &ctx).await.unwrap();
        assert!(!result.is_error, "list_agents should not error offline");
    }

    #[tokio::test]
    async fn test_get_agent_local_fallback() {
        let (_dir, store) = temp_store();
        let ctx = build_test_ctx(store);

        let aid = aura_os_core::AgentId::new();
        let agent = aura_os_core::Agent {
            agent_id: aid,
            user_id: "u1".into(),
            org_id: None,
            name: "MyAgent".into(),
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
            permissions: aura_os_core::AgentPermissions::empty(),
            intent_classifier: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        ctx.agent_service.save_agent_shadow(&agent).unwrap();

        let tool = crate::tools::agent_tools::GetAgentTool;
        let result = tool
            .execute(json!({ "agent_id": aid.to_string() }), &ctx)
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.content["name"], "MyAgent");
    }

    #[tokio::test]
    async fn test_list_projects_local_fallback() {
        let (_dir, store) = temp_store();
        let ctx = build_test_ctx(store);

        let org_id = aura_os_core::OrgId::new();
        let input = aura_os_projects::CreateProjectInput {
            org_id,
            name: "TestProject".into(),
            description: "desc".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        };
        let project = ctx.project_service.create_project(input).unwrap();

        // Verify direct lookup works
        let fetched = ctx
            .project_service
            .get_project(&project.project_id)
            .unwrap();
        assert_eq!(fetched.name, "TestProject");

        // The tool without network should not error
        let tool = crate::tools::project_tools::ListProjectsTool;
        let result = tool.execute(json!({}), &ctx).await.unwrap();
        assert!(!result.is_error, "list_projects should not error offline");
    }

    #[tokio::test]
    async fn test_get_project_local_fallback() {
        let (_dir, store) = temp_store();
        let ctx = build_test_ctx(store);

        let input = aura_os_projects::CreateProjectInput {
            org_id: aura_os_core::OrgId::new(),
            name: "Proj1".into(),
            description: "d".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        };
        let project = ctx.project_service.create_project(input).unwrap();

        let tool = crate::tools::project_tools::GetProjectTool;
        let result = tool
            .execute(
                json!({ "project_id": project.project_id.to_string() }),
                &ctx,
            )
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.content["name"], "Proj1");
    }

    // -----------------------------------------------------------------------
    // Specific field-name correctness tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_transition_task_uses_new_status_field() {
        let tool = crate::tools::task_tools::TransitionTaskTool;
        let schema = tool.parameters_schema();
        assert!(
            schema["properties"]["new_status"].is_object(),
            "transition_task must use 'new_status' not 'status'"
        );
        let required = schema["required"].as_array().unwrap();
        assert!(
            required.iter().any(|v| v == "new_status"),
            "new_status must be in required"
        );
    }

    #[test]
    fn test_create_post_uses_title_field() {
        let tool = crate::tools::social_tools::CreatePostTool;
        let schema = tool.parameters_schema();
        assert!(
            schema["properties"]["title"].is_object(),
            "create_post must use 'title' not 'content'"
        );
        let required = schema["required"].as_array().unwrap();
        assert!(
            required.iter().any(|v| v == "title"),
            "title must be in required"
        );
    }

    #[test]
    fn test_purchase_credits_uses_amount_usd() {
        let tool = crate::tools::billing_tools::PurchaseCreditsTool;
        let schema = tool.parameters_schema();
        assert!(
            schema["properties"]["amount_usd"].is_object(),
            "purchase_credits must use 'amount_usd' not 'amount_cents'"
        );
    }

    #[test]
    fn test_update_agent_instance_uses_status() {
        let tool = crate::tools::agent_tools::UpdateAgentInstanceTool;
        let schema = tool.parameters_schema();
        assert!(
            schema["properties"]["status"].is_object(),
            "update_agent_instance must have 'status' field"
        );
        assert!(
            schema["properties"]["name"].is_null() || !schema["properties"]["name"].is_object(),
            "update_agent_instance must NOT have 'name' field"
        );
    }

    #[test]
    fn test_create_task_requires_spec_id() {
        let tool = crate::tools::task_tools::CreateTaskTool;
        let schema = tool.parameters_schema();
        let required = schema["required"].as_array().unwrap();
        assert!(
            required.iter().any(|v| v == "spec_id"),
            "create_task must require spec_id"
        );
    }

    #[test]
    fn test_exec_tools_use_automaton_id() {
        for tool_name in &["pause_dev_loop", "stop_dev_loop", "get_loop_status"] {
            let registry = ToolRegistry::with_all_tools();
            let tool = registry.get(tool_name).unwrap();
            let schema = tool.parameters_schema();
            assert!(
                schema["properties"]["automaton_id"].is_object(),
                "{} must use 'automaton_id'",
                tool_name
            );
        }
    }

    #[tokio::test]
    async fn test_archive_project_works_locally() {
        let (_dir, store) = temp_store();
        let ctx = build_test_ctx(store);

        let input = aura_os_projects::CreateProjectInput {
            org_id: aura_os_core::OrgId::new(),
            name: "ToArchive".into(),
            description: "d".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        };
        let project = ctx.project_service.create_project(input).unwrap();

        let tool = crate::tools::project_tools::ArchiveProjectTool;
        let result = tool
            .execute(
                json!({ "project_id": project.project_id.to_string() }),
                &ctx,
            )
            .await
            .unwrap();
        assert!(!result.is_error);
        let status = result.content["current_status"].as_str().unwrap_or("");
        assert!(
            status.eq_ignore_ascii_case("archived"),
            "Expected archived status, got: {status}"
        );
    }
}
