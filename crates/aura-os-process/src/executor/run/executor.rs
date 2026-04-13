#[derive(Clone)]
pub struct ProcessExecutor {
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
    active_runs: Arc<Mutex<HashMap<ProcessRunId, ProcessRun>>>,
    active_root_runs: Arc<Mutex<HashMap<ProcessId, ProcessRunId>>>,
}

impl ProcessExecutor {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
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
            active_runs: Arc::new(Mutex::new(HashMap::new())),
            active_root_runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn remember_run(&self, run: &ProcessRun) {
        self.active_runs
            .lock()
            .expect("active run map poisoned")
            .insert(run.run_id, run.clone());
        if run.parent_run_id.is_none() {
            self.active_root_runs
                .lock()
                .expect("active root run map poisoned")
                .insert(run.process_id, run.run_id);
        }
    }

    fn update_active_run(&self, run: &ProcessRun) {
        self.active_runs
            .lock()
            .expect("active run map poisoned")
            .insert(run.run_id, run.clone());
    }

    fn forget_run(&self, run: &ProcessRun) {
        self.active_runs
            .lock()
            .expect("active run map poisoned")
            .remove(&run.run_id);
        if run.parent_run_id.is_none() {
            let mut roots = self
                .active_root_runs
                .lock()
                .expect("active root run map poisoned");
            if roots.get(&run.process_id) == Some(&run.run_id) {
                roots.remove(&run.process_id);
            }
        }
    }

    fn tracked_run(&self, run_id: &ProcessRunId) -> Option<ProcessRun> {
        self.active_runs
            .lock()
            .expect("active run map poisoned")
            .get(run_id)
            .cloned()
    }

    fn root_run_active_in_memory(&self, process_id: &ProcessId) -> bool {
        self.active_root_runs
            .lock()
            .expect("active root run map poisoned")
            .contains_key(process_id)
    }

    pub async fn cancel_run(
        &self,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
        auth_jwt: Option<&str>,
    ) -> Result<(), ProcessError> {
        let preferred_jwt = auth_jwt
            .map(str::to_string)
            .or_else(|| self.rocks_store.get_jwt());
        let target =
            process_storage_sync_client(self.storage_client.as_ref(), preferred_jwt.as_deref())
                .ok_or_else(|| {
                    ProcessError::Execution(
                        "aura-storage is required for process execution".to_string(),
                    )
                })?;
        let mut run = if let Some(run) = self.tracked_run(run_id) {
            run
        } else if let Some(jwt) = target.1.as_deref() {
            conv_run(
                target
                    .0
                    .get_process_run(&process_id.to_string(), &run_id.to_string(), jwt)
                    .await
                    .map_err(|error| {
                        ProcessError::Execution(format!(
                            "Failed to load run {} from aura-storage: {error}",
                            run_id
                        ))
                    })?,
            )
        } else {
            return Err(ProcessError::RunNotFound(run_id.to_string()));
        };

        if !matches!(
            run.status,
            ProcessRunStatus::Pending | ProcessRunStatus::Running
        ) {
            return Err(ProcessError::RunNotActive);
        }

        run.status = ProcessRunStatus::Cancelled;
        run.completed_at = Some(Utc::now());
        sync_run_to_storage(&target, &run, false).await?;
        self.forget_run(&run);

        emit_process_event(
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
        self.trigger_with_auth(process_id, trigger, None).await
    }

    pub async fn trigger_with_auth(
        &self,
        process_id: &ProcessId,
        trigger: ProcessRunTrigger,
        auth_jwt: Option<&str>,
    ) -> Result<ProcessRun, ProcessError> {
        let target = process_storage_sync_client(self.storage_client.as_ref(), auth_jwt)
            .ok_or_else(|| {
                ProcessError::Execution("aura-storage is required for process execution".into())
            })?;
        let process = load_process_from_storage(&target, process_id).await?;

        if self.root_run_active_in_memory(process_id) {
            return Err(ProcessError::RunAlreadyActive);
        }
        if let Some(jwt) = target.1.as_deref() {
            let existing_runs = target
                .0
                .list_process_runs(&process_id.to_string(), jwt)
                .await
                .map_err(|error| {
                    ProcessError::Execution(format!(
                        "Failed to load process runs for {}: {error}",
                        process_id
                    ))
                })?;
            if existing_runs.into_iter().map(conv_run).any(|run| {
                matches!(
                    run.status,
                    ProcessRunStatus::Pending | ProcessRunStatus::Running
                )
            }) {
                return Err(ProcessError::RunAlreadyActive);
            }
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
        sync_run_to_storage(&target, &run, true).await?;
        self.remember_run(&run);

        emit_process_event(
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
        let auth_jwt = auth_jwt.map(str::to_string);
        tokio::spawn(async move {
            if let Err(e) = execute_run(
                &executor,
                &executor.event_broadcast,
                &run_clone,
                &executor.data_dir,
                &executor.rocks_store,
                &executor.agent_service,
                &executor.org_service,
                auth_jwt.as_deref(),
            )
            .await
            {
                warn!(run_id = %run_clone.run_id, error = %e, "Process run failed");
                mark_run_failed_if_active(
                    &executor,
                    &executor.event_broadcast,
                    &run_clone,
                    &e.to_string(),
                    auth_jwt.as_deref(),
                )
                .await;
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
        let auth_jwt = self.rocks_store.get_jwt();
        let target = process_storage_sync_client(self.storage_client.as_ref(), auth_jwt.as_deref())
            .ok_or_else(|| {
                ProcessError::Execution("aura-storage is required for process execution".into())
            })?;
        let process = load_process_from_storage(&target, process_id).await?;

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
        sync_run_to_storage(&target, &run, true).await?;
        self.remember_run(&run);

        emit_process_event(
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
            let tx = self.event_broadcast.clone();
            let child_run_id = run.run_id.to_string();
            send_process_text(
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
                                emit_process_event(&tx, payload);
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
                                emit_parent_progress_update(&tx, &parent);
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
            &self.event_broadcast,
            &run,
            &self.data_dir,
            &self.rocks_store,
            &self.agent_service,
            &self.org_service,
            auth_jwt.as_deref(),
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
                &self.event_broadcast,
                &parent.project_id,
                &parent.task_id,
                &parent.process_id,
                &parent.run_id,
                &parent.node_id,
                &marker,
            );
        }

        let completed_run = match run_result {
            Ok(run) => run,
            Err(e) => {
                mark_run_failed_if_active(
                    self,
                    &self.event_broadcast,
                    &run,
                    &e.to_string(),
                    auth_jwt.as_deref(),
                )
                .await;
                return Err(e);
            }
        };

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
            emit_parent_progress_update(&self.event_broadcast, parent);
        }

        Ok(completed_run)
    }
}
