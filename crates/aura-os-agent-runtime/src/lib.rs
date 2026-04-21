pub mod audit;
pub mod events;
pub mod policy;
pub mod prompt;
pub mod state;
pub mod tools;

use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;
use tokio::sync::broadcast;
use tracing::info;

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_billing::BillingClient;
use aura_os_link::{AutomatonClient, HarnessLink};
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;
use aura_os_tasks::TaskService;

use audit::AgentToolAuditLog;
use events::AgentEventListener;
use tools::{AgentToolContext, ToolRegistry};

#[derive(Error, Debug)]
pub enum AgentRuntimeError {
    #[error("LLM request failed: {0}")]
    LlmError(String),
    #[error("Tool execution failed: {0}")]
    ToolError(String),
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("Internal error: {0}")]
    Internal(String),
}

pub struct AgentRuntimeService {
    pub tool_registry: Arc<ToolRegistry>,
    pub router_url: String,
    pub http_client: reqwest::Client,
    pub event_listener: AgentEventListener,
    pub process_executor: Arc<aura_os_process::ProcessExecutor>,
    project_service: Arc<ProjectService>,
    agent_service: Arc<AgentService>,
    agent_instance_service: Arc<AgentInstanceService>,
    task_service: Arc<TaskService>,
    session_service: Arc<SessionService>,
    org_service: Arc<OrgService>,
    billing_client: Arc<BillingClient>,
    automaton_client: Arc<AutomatonClient>,
    network_client: Option<Arc<NetworkClient>>,
    storage_client: Option<Arc<StorageClient>>,
    orbit_client: Option<Arc<OrbitClient>>,
    store: Arc<SettingsStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    /// Base URL of the locally running aura-os-server. Tools that need
    /// server-side side-effects (e.g. mirroring specs to disk) should route
    /// through this URL instead of the remote `router_url` / storage.
    local_server_base_url: Option<String>,
    /// In-memory audit log for cross-agent tool invocations. Exposed via
    /// [`Self::audit_log`] so the dispatcher can record every call and a
    /// future diagnostics endpoint can page through snapshots.
    audit_log: AgentToolAuditLog,
}

impl AgentRuntimeService {
    /// Construct an `AgentRuntimeService` with a pre-built tool
    /// registry and process executor.
    ///
    /// Tier D split the god-crate: the registry builders and process
    /// executor construction moved to `aura-os-agent-tools` (tools)
    /// and the server's `app_builder` respectively. Callers pass:
    ///
    /// * `tool_registry` — typically `aura_os_agent_tools::shared_all_tools_registry()`
    ///   plus whatever dynamic tools (process tools) the caller has
    ///   registered on a fresh registry.
    /// * `process_executor` — a live `ProcessExecutor` the caller
    ///   constructed from its data directory + storage client.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tool_registry: Arc<ToolRegistry>,
        process_executor: Arc<aura_os_process::ProcessExecutor>,
        router_url: String,
        project_service: Arc<ProjectService>,
        agent_service: Arc<AgentService>,
        agent_instance_service: Arc<AgentInstanceService>,
        task_service: Arc<TaskService>,
        session_service: Arc<SessionService>,
        org_service: Arc<OrgService>,
        billing_client: Arc<BillingClient>,
        automaton_client: Arc<AutomatonClient>,
        network_client: Option<Arc<NetworkClient>>,
        storage_client: Option<Arc<StorageClient>>,
        orbit_client: Option<Arc<OrbitClient>>,
        store: Arc<SettingsStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
        _harness: Arc<dyn HarnessLink>,
    ) -> Self {
        let event_listener = AgentEventListener::new(100);
        event_listener.spawn(event_broadcast.subscribe());
        info!(router_url = %router_url, "AgentRuntimeService initialized");
        Self {
            tool_registry,
            router_url,
            http_client: build_local_http_client(),
            event_listener,
            process_executor,
            project_service,
            agent_service,
            agent_instance_service,
            task_service,
            session_service,
            org_service,
            billing_client,
            automaton_client,
            network_client,
            storage_client,
            orbit_client,
            store,
            event_broadcast,
            local_server_base_url: None,
            audit_log: AgentToolAuditLog::default(),
        }
    }

    /// Access the in-memory audit log. Cheap to clone (`Arc` inside)
    /// so callers can hand a copy to async tasks without retaining a
    /// borrow on the service.
    #[must_use]
    pub fn audit_log(&self) -> AgentToolAuditLog {
        self.audit_log.clone()
    }

    /// Snapshot of the most recent cross-agent tool invocations.
    /// Diagnostic-only; order is oldest-first.
    pub async fn recent_tool_invocations(&self) -> Vec<audit::AgentToolInvocation> {
        self.audit_log.snapshot().await
    }

    /// Wire in the base URL of the local aura-os-server so tool calls that
    /// need local side-effects (disk mirrors, etc.) can route through it.
    pub fn with_local_server_base_url(mut self, url: impl Into<String>) -> Self {
        let raw: String = url.into();
        let trimmed = raw.trim().trim_end_matches('/').to_string();
        self.local_server_base_url = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
        self
    }

    pub fn set_local_server_base_url(&mut self, url: Option<String>) {
        self.local_server_base_url = url
            .map(|v| v.trim().trim_end_matches('/').to_string())
            .filter(|v| !v.is_empty());
    }

    pub fn spawn_scheduler(self: &Arc<Self>) {
        let Some(storage_client) = self.storage_client.clone() else {
            info!("Process scheduler disabled: aura-storage is not configured");
            return;
        };
        if !storage_client.has_internal_token() {
            info!("Process scheduler disabled: AURA_STORAGE_INTERNAL_TOKEN is not configured");
            return;
        }
        let process_sched = Arc::new(aura_os_process::ProcessScheduler::new(
            self.process_executor.clone(),
            Some(storage_client),
        ));
        process_sched.spawn();
        info!("Process scheduler spawned");
    }

    pub fn build_context(&self, user_id: &str, org_id: &str, jwt: &str) -> AgentToolContext {
        AgentToolContext {
            user_id: user_id.to_string(),
            org_id: org_id.to_string(),
            jwt: jwt.to_string(),
            project_service: self.project_service.clone(),
            agent_service: self.agent_service.clone(),
            agent_instance_service: self.agent_instance_service.clone(),
            task_service: self.task_service.clone(),
            session_service: self.session_service.clone(),
            org_service: self.org_service.clone(),
            billing_client: self.billing_client.clone(),
            automaton_client: self.automaton_client.clone(),
            network_client: self.network_client.clone(),
            storage_client: self.storage_client.clone(),
            orbit_client: self.orbit_client.clone(),
            store: self.store.clone(),
            event_broadcast: self.event_broadcast.clone(),
            local_server_base_url: self.local_server_base_url.clone(),
            local_http_client: self.http_client.clone(),
        }
    }
}

/// Short connect timeout for the reqwest client used by every
/// agent-runtime loopback callback (most visibly `send_to_agent`
/// POSTing `/api/agents/:id/events/stream`). Without this, a
/// wrong-port URL — e.g. a stale `VITE_API_URL=http://127.0.0.1:19847`
/// while the embedded server actually bound an ephemeral port —
/// falls into the OS-level TCP SYN timeout (~21s on Windows) and
/// surfaces to the LLM as "operation timed out" with no signal about
/// where to look. 3s is plenty for an in-process loopback connect
/// but short enough to fail fast and surface the URL in the error.
///
/// **No overall request timeout** is set: `SendToAgentTool` legitimately
/// streams SSE for up to `DRAIN_MAX_WAIT` (60s) after headers arrive,
/// and capping total request time would truncate healthy long replies.
const LOCAL_HTTP_CLIENT_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// Shared factory for the agent-runtime HTTP client. Exposed so
/// tests and auxiliary binaries can construct a client with the
/// same connect-timeout policy as the real service without
/// depending on `AgentRuntimeService::new`.
pub fn build_local_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(LOCAL_HTTP_CLIENT_CONNECT_TIMEOUT)
        .build()
        .expect("reqwest client builder with connect_timeout must build")
}

#[cfg(test)]
mod local_http_client_tests {
    use super::*;
    use std::time::Instant;

    /// Construct a client and issue a request to an address nothing
    /// listens on. If the connect timeout was wired correctly the
    /// request errors within a couple of seconds — comfortably under
    /// the 5s bound below. Without the timeout, Windows would make
    /// this hang ~21s and macOS/Linux ~75s (default TCP SYN retries).
    #[tokio::test]
    async fn build_local_http_client_enforces_connect_timeout() {
        let client = build_local_http_client();
        // RFC 5737 TEST-NET-1 — guaranteed non-routable, so `connect`
        // can never complete. We deliberately do NOT use 127.0.0.1:<dead>
        // here because loopback refuses connections instantly (no
        // timeout path exercised).
        let url = "http://192.0.2.1:9/";
        let start = Instant::now();
        let result = client.get(url).send().await;
        let elapsed = start.elapsed();

        assert!(result.is_err(), "expected connect failure, got {result:?}");
        assert!(
            elapsed < Duration::from_secs(5),
            "connect should fail within ~{:?} (connect_timeout = {:?}); \
             took {:?}",
            Duration::from_secs(5),
            LOCAL_HTTP_CLIENT_CONNECT_TIMEOUT,
            elapsed
        );
    }
}
