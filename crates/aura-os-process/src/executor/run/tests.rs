    use super::{
        apply_foreach_max_items, authoritative_process_read_error,
        authoritative_process_storage_error, build_foreach_child_input,
        build_parent_mirrored_process_event, build_workspace_instructions, compact_node_output,
        emit_parent_progress_update, parse_foreach_json_array, process_storage_sync_client,
        project_foreach_item_value, resolve_action_plan_mode, ActionPlanMode, ChildRunProgress,
        OutputCompactionMode, ParentProgressMirrorState, ParentStreamMirrorContext,
    };
    use crate::process_store::ProcessStore;
    use aura_os_core::ProcessId;
    use aura_os_storage::{StorageClient, StorageError};
    use aura_os_store::RocksStore;
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::Mutex;
    use tempfile::TempDir;
    use tokio::sync::broadcast;

    fn open_temp_process_store() -> (ProcessStore, TempDir) {
        let dir = TempDir::new().expect("failed to create temp dir");
        let rocks = Arc::new(RocksStore::open(dir.path()).expect("failed to open rocks store"));
        (ProcessStore::new(rocks), dir)
    }

    #[test]
    fn action_plan_mode_defaults_to_single_path() {
        let config = serde_json::json!({});
        assert_eq!(
            resolve_action_plan_mode(&config),
            ActionPlanMode::SinglePath
        );
    }

    #[test]
    fn action_plan_mode_requires_explicit_opt_in_for_decomposition() {
        for disabled in ["off", "false", "disabled", ""] {
            let config = serde_json::json!({ "plan_mode": disabled });
            assert_eq!(
                resolve_action_plan_mode(&config),
                ActionPlanMode::SinglePath
            );
        }

        for enabled in ["auto", "on", "llm", "decompose", "parallel"] {
            let config = serde_json::json!({ "plan_mode": enabled });
            assert_eq!(resolve_action_plan_mode(&config), ActionPlanMode::Decompose);
        }
    }

    #[test]
    fn workspace_instructions_list_available_input_files() {
        let instructions = build_workspace_instructions(
            "structured_output.txt",
            &[
                (
                    "process_node_prompt.txt".to_string(),
                    "original node prompt".to_string(),
                ),
                (
                    "upstream_context.txt".to_string(),
                    "upstream node output".to_string(),
                ),
            ],
        );

        assert!(instructions.contains("structured_output.txt"));
        assert!(instructions.contains("process_node_prompt.txt"));
        assert!(instructions.contains("upstream_context.txt"));
        assert!(instructions.contains("Read the provided workspace input files"));
    }

    #[test]
    fn foreach_json_array_accepts_top_level_array() {
        let parsed = parse_foreach_json_array(r#"["a", "b"]"#, None).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].as_str(), Some("a"));
        assert_eq!(parsed[1].as_str(), Some("b"));
    }

    #[test]
    fn foreach_json_array_accepts_entries_object() {
        let parsed = parse_foreach_json_array(
            r#"{"entries":[{"name":"Cursor"},{"name":"Windsurf"}]}"#,
            None,
        )
        .unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0]["name"], "Cursor");
        assert_eq!(parsed[1]["name"], "Windsurf");
    }

    #[test]
    fn foreach_json_array_accepts_custom_object_key() {
        let parsed = parse_foreach_json_array(
            r#"{"items":[{"name":"Cursor"},{"name":"Windsurf"}]}"#,
            Some("items"),
        )
        .unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0]["name"], "Cursor");
    }

    #[test]
    fn foreach_json_array_reports_checked_keys_for_object_input() {
        let error = parse_foreach_json_array(r#"{"results":"not-an-array"}"#, Some("items"))
            .unwrap_err()
            .to_string();
        assert!(error.contains("items"));
        assert!(error.contains("entries"));
        assert!(error.contains("results"));
    }

    #[test]
    fn foreach_max_items_truncates_to_first_n_items() {
        let mut items = vec![
            "first".to_string(),
            "second".to_string(),
            "third".to_string(),
        ];

        apply_foreach_max_items(&mut items, Some(2));

        assert_eq!(items, vec!["first".to_string(), "second".to_string()]);
    }

    #[test]
    fn foreach_max_items_ignores_zero_limit() {
        let mut items = vec!["first".to_string(), "second".to_string()];

        apply_foreach_max_items(&mut items, Some(0));

        assert_eq!(items, vec!["first".to_string(), "second".to_string()]);
    }

    #[test]
    fn compact_node_output_minifies_json_by_default() {
        let config = serde_json::json!({});

        let compacted = compact_node_output(
            &config,
            "{\n  \"entries\": [\n    \"a\",\n    \"b\"\n  ]\n}",
            OutputCompactionMode::Auto,
            "max_child_output_chars",
        );

        assert_eq!(compacted, r#"{"entries":["a","b"]}"#);
    }

    #[test]
    fn compact_node_output_honors_per_child_char_limit() {
        let config = serde_json::json!({
            "max_child_output_chars": 5
        });

        let compacted = compact_node_output(
            &config,
            "   hello world   ",
            OutputCompactionMode::Trim,
            "max_child_output_chars",
        );

        assert_eq!(compacted, "hello\n[truncated]");
    }

    #[test]
    fn project_foreach_item_value_keeps_selected_fields() {
        let value = serde_json::json!({
            "name": "Aura",
            "website": "https://example.com",
            "pricing": "$20"
        });
        let projection = vec!["name".to_string(), "pricing".to_string()];

        let projected = project_foreach_item_value(&value, Some(&projection));

        assert_eq!(
            projected,
            serde_json::json!({
                "name": "Aura",
                "pricing": "$20"
            })
        );
    }

    #[test]
    fn build_foreach_child_input_supports_compact_format() {
        let input = build_foreach_child_input("item", 2, "{\"id\":1}", "summarize", true);

        assert_eq!(input, "item[2]={\"id\":1}\nTask:summarize");
    }

    #[test]
    fn parent_mirror_rewrites_child_stream_context() {
        let parent = ParentStreamMirrorContext {
            project_id: "project-1".to_string(),
            task_id: "foreach:node-1".to_string(),
            process_id: "process-1".to_string(),
            run_id: "run-parent".to_string(),
            node_id: "node-parent".to_string(),
            item_label: "item #1".to_string(),
            progress_state: Arc::new(Mutex::new(ParentProgressMirrorState::default())),
        };

        let child_event = serde_json::json!({
            "type": "text_delta",
            "run_id": "run-child",
            "node_id": "child-node",
            "text": "hello"
        });

        let mirrored =
            build_parent_mirrored_process_event(&parent, "run-child", &child_event, "text_delta")
                .unwrap();

        assert_eq!(mirrored["run_id"], "run-parent");
        assert_eq!(mirrored["node_id"], "node-parent");
        assert_eq!(mirrored["process_id"], "process-1");
        assert_eq!(mirrored["child_run_id"], "run-child");
        assert_eq!(mirrored["sub_task"], "item #1");
        assert_eq!(mirrored["text"], "hello");
    }

    #[tokio::test]
    async fn forward_process_event_preserves_stamped_identity_fields() {
        let (store, _dir) = open_temp_process_store();
        let (tx, mut rx) = broadcast::channel(8);
        let raw = serde_json::json!({
            "type": "text_delta",
            "run_id": "harness-run",
            "node_id": "harness-node",
            "task_id": "harness-task",
            "text": "hello",
        });

        super::forward_process_event(
            &store,
            &tx,
            "project-parent",
            "task-parent",
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
            "33333333-3333-3333-3333-333333333333",
            &raw,
            Some("item #1"),
        );

        let evt = rx.recv().await.unwrap();
        assert_eq!(evt["project_id"], "project-parent");
        assert_eq!(evt["task_id"], "task-parent");
        assert_eq!(evt["run_id"], "22222222-2222-2222-2222-222222222222");
        assert_eq!(evt["node_id"], "33333333-3333-3333-3333-333333333333");
        assert_eq!(evt["sub_task"], "item #1");
        assert_eq!(evt["text"], "hello");
    }

    #[tokio::test]
    async fn parent_progress_update_sums_base_and_child_usage() {
        let parent = ParentStreamMirrorContext {
            project_id: "project-1".to_string(),
            task_id: "foreach:node-1".to_string(),
            process_id: "process-1".to_string(),
            run_id: "run-parent".to_string(),
            node_id: "node-parent".to_string(),
            item_label: "item #1".to_string(),
            progress_state: Arc::new(Mutex::new(ParentProgressMirrorState {
                base_input_tokens: 10,
                base_output_tokens: 5,
                base_cost_usd: 1.5,
                child_runs: HashMap::from([
                    (
                        "child-1".to_string(),
                        ChildRunProgress {
                            input_tokens: 20,
                            output_tokens: 7,
                            cost_usd: 2.0,
                        },
                    ),
                    (
                        "child-2".to_string(),
                        ChildRunProgress {
                            input_tokens: 3,
                            output_tokens: 4,
                            cost_usd: 0.5,
                        },
                    ),
                ]),
            })),
        };

        let (store, _dir) = open_temp_process_store();
        let (tx, mut rx) = broadcast::channel(8);
        emit_parent_progress_update(&store, &tx, &parent);

        let evt = rx.recv().await.unwrap();
        assert_eq!(evt["type"], "process_run_progress");
        assert_eq!(evt["run_id"], "run-parent");
        assert_eq!(evt["node_id"], "node-parent");
        assert_eq!(evt["total_input_tokens"], 33);
        assert_eq!(evt["total_output_tokens"], 16);
        assert_eq!(evt["cost_usd"], 4.0);
    }

    #[test]
    fn process_storage_sync_client_prefers_jwt_and_falls_back_to_internal_token() {
        let public_client = StorageClient::with_base_url("http://localhost:8080");
        let public_client = std::sync::Arc::new(public_client);
        let (client, jwt) = process_storage_sync_client(Some(&public_client), Some("jwt-123"))
            .expect("jwt-backed client");
        assert_eq!(client.base_url(), "http://localhost:8080");
        assert_eq!(jwt, Some("jwt-123"));

        assert!(process_storage_sync_client(Some(&public_client), None).is_none());

        let internal_client =
            StorageClient::with_base_url_and_token("http://localhost:8080", "internal-token");
        let internal_client = std::sync::Arc::new(internal_client);
        assert!(process_storage_sync_client(Some(&internal_client), None).is_some());
    }

    #[test]
    fn authoritative_process_read_error_maps_404_to_not_found() {
        let process_id: ProcessId = "11111111-1111-1111-1111-111111111111"
            .parse()
            .expect("process id");
        let error = StorageError::Server {
            status: 404,
            body: "not found".to_string(),
        };

        let mapped = authoritative_process_read_error(&process_id, &error);

        assert!(matches!(mapped, crate::ProcessError::NotFound(_)));
    }

    #[test]
    fn authoritative_process_storage_error_includes_context() {
        let process_id: ProcessId = "11111111-1111-1111-1111-111111111111"
            .parse()
            .expect("process id");
        let error = StorageError::Validation("boom".to_string());

        let mapped = authoritative_process_storage_error(&process_id, "load process nodes", &error);

        assert_eq!(
            mapped.to_string(),
            "Execution error: Failed to load process nodes from authoritative process storage for process 11111111-1111-1111-1111-111111111111: validation error: boom"
        );
    }
