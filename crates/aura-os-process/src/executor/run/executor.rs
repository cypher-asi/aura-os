#[derive(Clone)]
pub struct ProcessExecutor {
    store: Arc<ProcessStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    data_dir: PathBuf,
    rocks_store: Arc<RocksStore>,
    agent_service: Arc<AgentService>,
    org_service: Arc<OrgService>,
    automaton_client: Arc<AutomatonClient>,
    storage_client: Option<Arc<StorageClient>>,
    task_service: Arc<TaskService>,
    router_url: String,
    http_client: reqwest::Client,
}

impl ProcessExecutor {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<ProcessStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
        data_dir: PathBuf,
        rocks_store: Arc<RocksStore>,
        agent_service: Arc<AgentService>,
        org_service: Arc<OrgService>,
        automaton_client: Arc<AutomatonClient>,
        storage_client: Option<Arc<StorageClient>>,
        task_service: Arc<TaskService>,
        router_url: String,
        http_client: reqwest::Client,
    ) -> Self {
        Self {
            store,
            event_broadcast,
            data_dir,
            rocks_store,
            agent_service,
            org_service,
            automaton_client,
            storage_client,
            task_service,
            router_url,
            http_client,
        }
    }

    pub async fn cancel_run(
        &self,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
    ) -> Result<(), ProcessError> {
        let mut run = self
            .store
            .list_runs(process_id)?
            .into_iter()
            .find(|r| r.run_id == *run_id)
            .ok_or_else(|| ProcessError::RunNotFound(run_id.to_string()))?;

        if !matches!(
            run.status,
            ProcessRunStatus::Pending | ProcessRunStatus::Running
        ) {
            return Err(ProcessError::RunNotActive);
        }

        run.status = ProcessRunStatus::Cancelled;
        run.completed_at = Some(Utc::now());
        self.store.save_run(&run)?;
        if let Some(client) = internal_process_sync_client(self.storage_client.as_ref()) {
            sync_run_to_storage(client, &run, false).await;
        }

        emit_process_event(
            &self.store,
            &self.event_broadcast,
            serde_json::json!({
                "type": "process_run_completed",
                "process_id": process_id.to_string(),
                "run_id": run_id.to_string(),
                "status": "cancelled",
                "total_input_tokens": run.total_input_tokens,
                "total_output_tokens": run.total_output_tokens,
                "cost_usd": run.cost_usd,
            }),
        );

        info!(process_id = %process_id, run_id = %run_id, "Process run cancelled");
        Ok(())
    }

    pub async fn trigger(
        &self,
        process_id: &ProcessId,
        trigger: ProcessRunTrigger,
    ) -> Result<ProcessRun, ProcessError> {
        let process =
            if let Some(client) = internal_process_sync_client(self.storage_client.as_ref()) {
                Some(
                    client
                        .get_process_internal(&process_id.to_string())
                        .await
                        .map(conv_process)
                        .map_err(|error| authoritative_process_read_error(process_id, &error))?,
                )
            } else {
                self.store.get_process(process_id)?
            };
        let process = process.ok_or_else(|| ProcessError::NotFound(process_id.to_string()))?;

        let existing_runs = self.store.list_runs(process_id)?;
        if existing_runs.iter().any(|r| {
            matches!(
                r.status,
                ProcessRunStatus::Pending | ProcessRunStatus::Running
            )
        }) {
            return Err(ProcessError::RunAlreadyActive);
        }

        let now = Utc::now();
        let run = ProcessRun {
            run_id: ProcessRunId::new(),
            process_id: process.process_id,
            status: ProcessRunStatus::Pending,
            trigger,
            error: None,
            started_at: now,
            completed_at: None,
            total_input_tokens: None,
            total_output_tokens: None,
            cost_usd: None,
            output: None,
            parent_run_id: None,
            input_override: None,
        };
        self.store.save_run(&run)?;
        if let Some(client) = internal_process_sync_client(self.storage_client.as_ref()) {
            sync_run_to_storage(client, &run, true).await;
        }

        emit_process_event(
            &self.store,
            &self.event_broadcast,
            serde_json::json!({
                "type": "process_run_started",
                "process_id": process.process_id.to_string(),
                "run_id": run.run_id.to_string(),
            }),
        );

        info!(
            process_id = %process.process_id,
            run_id = %run.run_id,
            "Process run triggered"
        );

        let executor = self.clone();
        let run_clone = run.clone();
        tokio::spawn(async move {
            if let Err(e) = execute_run(
                &executor,
                &executor.store,
                &executor.event_broadcast,
                &run_clone,
                &executor.data_dir,
                &executor.rocks_store,
                &executor.agent_service,
                &executor.org_service,
            )
            .await
            {
                warn!(run_id = %run_clone.run_id, error = %e, "Process run failed");
                mark_run_failed_if_active(
                    &executor.store,
                    &executor.event_broadcast,
                    &run_clone,
                    &e.to_string(),
                );
            }
        });

        Ok(run)
    }

    /// Trigger a child process run and wait for it to complete, returning
    /// the finished `ProcessRun` (with `.output`).  Used by SubProcess and
    /// ForEach nodes to invoke another process synchronously.
    pub async fn trigger_and_await(
        &self,
        process_id: &ProcessId,
        trigger: ProcessRunTrigger,
        input_override: Option<String>,
        parent_run_id: Option<ProcessRunId>,
    ) -> Result<ProcessRun, ProcessError> {
        self.trigger_and_await_with_parent_mirror(
            process_id,
            trigger,
            input_override,
            parent_run_id,
            None,
        )
        .await
    }

    async fn trigger_and_await_with_parent_mirror(
        &self,
        process_id: &ProcessId,
        trigger: ProcessRunTrigger,
        input_override: Option<String>,
        parent_run_id: Option<ProcessRunId>,
        parent_mirror: Option<ParentStreamMirrorContext>,
    ) -> Result<ProcessRun, ProcessError> {
        let process =
            if let Some(client) = internal_process_sync_client(self.storage_client.as_ref()) {
                Some(
                    client
                        .get_process_internal(&process_id.to_string())
                        .await
                        .map(conv_process)
                        .map_err(|error| authoritative_process_read_error(process_id, &error))?,
                )
            } else {
                self.store.get_process(process_id)?
            };
        let process = process.ok_or_else(|| ProcessError::NotFound(process_id.to_string()))?;

        let now = Utc::now();
        let run = ProcessRun {
            run_id: ProcessRunId::new(),
            process_id: process.process_id,
            status: ProcessRunStatus::Pending,
            trigger,
            error: None,
            started_at: now,
            completed_at: None,
            total_input_tokens: None,
            total_output_tokens: None,
            cost_usd: None,
            output: None,
            parent_run_id,
            input_override: input_override.clone(),
        };
        self.store.save_run(&run)?;
        if let Some(client) = internal_process_sync_client(self.storage_client.as_ref()) {
            sync_run_to_storage(client, &run, true).await;
        }

        emit_process_event(
            &self.store,
            &self.event_broadcast,
            serde_json::json!({
                "type": "process_run_started",
                "process_id": process.process_id.to_string(),
                "run_id": run.run_id.to_string(),
            }),
        );

        info!(
            process_id = %process.process_id,
            run_id = %run.run_id,
            parent = ?parent_run_id,
            "Child process run triggered (await)"
        );

        let mirror_task = parent_mirror.clone().map(|parent| {
            let store = self.store.as_ref().clone();
            let tx = self.event_broadcast.clone();
            let child_run_id = run.run_id.to_string();
            send_process_text(
                &store,
                &tx,
                &parent.project_id,
                &parent.task_id,
                &parent.process_id,
                &parent.run_id,
                &parent.node_id,
                &format!("\n--- {} started ---\n", parent.item_label),
            );

            let mut rx = tx.subscribe();
            tokio::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(evt) => {
                            let evt_type =
                                evt.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                            if let Some(payload) = build_parent_mirrored_process_event(
                                &parent,
                                &child_run_id,
                                &evt,
                                evt_type,
                            ) {
                                emit_process_event(&store, &tx, payload);
                            }
                            if evt_type == "process_run_progress"
                                && evt.get("run_id").and_then(|v| v.as_str()) == Some(&child_run_id)
                            {
                                let mut state = parent
                                    .progress_state
                                    .lock()
                                    .expect("parent progress mirror state poisoned");
                                let entry =
                                    state.child_runs.entry(child_run_id.clone()).or_default();
                                entry.input_tokens = evt
                                    .get("total_input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(entry.input_tokens);
                                entry.output_tokens = evt
                                    .get("total_output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(entry.output_tokens);
                                entry.cost_usd = evt
                                    .get("cost_usd")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(entry.cost_usd);
                                drop(state);
                                emit_parent_progress_update(&store, &tx, &parent);
                            }
                            if is_child_run_terminal_event(&child_run_id, &evt, evt_type) {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }
            })
        });

        let run_result = execute_run(
            self,
            &self.store,
            &self.event_broadcast,
            &run,
            &self.data_dir,
            &self.rocks_store,
            &self.agent_service,
            &self.org_service,
        )
        .await;

        if let Some(handle) = mirror_task {
            let _ = tokio::time::timeout(Duration::from_secs(1), handle).await;
        }

        if let Some(parent) = parent_mirror.as_ref() {
            let marker = match &run_result {
                Ok(_) => format!("\n--- {} completed ---\n", parent.item_label),
                Err(error) => format!("\n--- {} failed: {} ---\n", parent.item_label, error),
            };
            send_process_text(
                self.store.as_ref(),
                &self.event_broadcast,
                &parent.project_id,
                &parent.task_id,
                &parent.process_id,
                &parent.run_id,
                &parent.node_id,
                &marker,
            );
        }

        if let Err(e) = run_result {
            mark_run_failed_if_active(&self.store, &self.event_broadcast, &run, &e.to_string());
            return Err(e);
        }

        let completed_run = self
            .store
            .list_runs(process_id)?
            .into_iter()
            .find(|r| r.run_id == run.run_id)
            .ok_or_else(|| ProcessError::RunNotFound(run.run_id.to_string()))?;

        if let Some(parent) = parent_mirror.as_ref() {
            let mut state = parent
                .progress_state
                .lock()
                .expect("parent progress mirror state poisoned");
            let entry = state
                .child_runs
                .entry(completed_run.run_id.to_string())
                .or_default();
            entry.input_tokens = completed_run
                .total_input_tokens
                .unwrap_or(entry.input_tokens);
            entry.output_tokens = completed_run
                .total_output_tokens
                .unwrap_or(entry.output_tokens);
            entry.cost_usd = completed_run.cost_usd.unwrap_or(entry.cost_usd);
            drop(state);
            emit_parent_progress_update(self.store.as_ref(), &self.event_broadcast, parent);
        }

        Ok(completed_run)
    }
}
