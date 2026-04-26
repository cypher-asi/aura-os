use super::*;

pub(super) struct CoreServices {
    pub(super) org_service: Arc<OrgService>,
    pub(super) auth_service: Arc<AuthService>,
    pub(super) billing_client: Arc<BillingClient>,
}

pub(super) fn init_core_services(store: &Arc<SettingsStore>) -> CoreServices {
    CoreServices {
        org_service: Arc::new(OrgService::new(store.clone())),
        auth_service: Arc::new(AuthService::new()),
        billing_client: Arc::new(BillingClient::new()),
    }
}

pub(super) struct DomainServices {
    pub(super) project_service: Arc<ProjectService>,
    pub(super) task_service: Arc<TaskService>,
    pub(super) agent_service: Arc<AgentService>,
    pub(super) agent_instance_service: Arc<AgentInstanceService>,
    pub(super) session_service: Arc<SessionService>,
    pub(super) local_harness: Arc<dyn HarnessLink>,
    pub(super) swarm_harness: Arc<dyn HarnessLink>,
}

pub(super) fn init_domain_services(
    store: &Arc<SettingsStore>,
    network_client: &Option<Arc<NetworkClient>>,
    storage_client: &Option<Arc<StorageClient>>,
) -> DomainServices {
    let project_service = Arc::new(ProjectService::new_with_network(
        network_client.clone(),
        store.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone(), storage_client.clone()));
    let agent_service = Arc::new(AgentService::new(store.clone(), network_client.clone()));
    let runtime_agent_state: aura_os_agents::RuntimeAgentStateMap =
        Arc::new(Mutex::new(HashMap::new()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(
        store.clone(),
        storage_client.clone(),
        runtime_agent_state,
        network_client.clone(),
    ));
    let session_service = Arc::new(
        SessionService::new(store.clone(), 0.8, 200_000)
            .with_storage_client(storage_client.clone()),
    );
    let swarm_harness: Arc<dyn HarnessLink> = Arc::new(SwarmHarness::from_env());
    let local_harness: Arc<dyn HarnessLink> = Arc::new(LocalHarness::from_env());

    DomainServices {
        project_service,
        task_service,
        agent_service,
        agent_instance_service,
        session_service,
        local_harness,
        swarm_harness,
    }
}
