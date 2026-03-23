use std::sync::Arc;

use aura_billing::MeteredLlm;
use aura_core::*;
use aura_settings::SettingsService;
use aura_storage::StorageClient;
use aura_store::RocksStore;
use tracing::warn;

use aura_projects::ProjectService;
use aura_specs::SpecGenerationService;
use aura_tasks::TaskService;

const SESSION_STATUS_ACTIVE: &str = "active";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatAttachment {
    #[serde(rename = "type")]
    pub type_: String,
    pub media_type: String,
    pub data: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ChatStreamEvent {
    Delta(String),
    ThinkingDelta(String),
    Progress(String),
    ToolCallStarted {
        id: String,
        name: String,
    },
    ToolCallSnapshot {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolCall {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        id: String,
        name: String,
        result: String,
        is_error: bool,
    },
    SpecSaved(Spec),
    SpecsTitle(String),
    SpecsSummary(String),
    TaskSaved(Box<Task>),
    MessageSaved(Message),
    AgentInstanceUpdated(AgentInstance),
    TokenUsage {
        input_tokens: u64,
        output_tokens: u64,
    },
    Error(String),
    Done,
}

pub struct ChatService {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) settings: Arc<SettingsService>,
    pub(crate) llm: Arc<MeteredLlm>,
    pub(crate) spec_gen: Arc<SpecGenerationService>,
    pub(crate) project_service: Arc<ProjectService>,
    pub(crate) task_service: Arc<TaskService>,
    pub(crate) storage_client: Option<Arc<StorageClient>>,
    pub(crate) llm_config: LlmConfig,
    pub(crate) runtime: Arc<dyn aura_link::AgentRuntime>,
}

pub struct ChatServiceDeps {
    pub store: Arc<RocksStore>,
    pub settings: Arc<SettingsService>,
    pub llm: Arc<MeteredLlm>,
    pub spec_gen: Arc<SpecGenerationService>,
    pub project_service: Arc<ProjectService>,
    pub task_service: Arc<TaskService>,
    pub storage_client: Option<Arc<StorageClient>>,
    pub runtime: Arc<dyn aura_link::AgentRuntime>,
}

impl ChatService {
    pub fn new(deps: ChatServiceDeps) -> Self {
        Self::with_config(deps, LlmConfig::from_env())
    }

    pub fn with_config(deps: ChatServiceDeps, llm_config: LlmConfig) -> Self {
        Self {
            store: deps.store,
            settings: deps.settings,
            llm: deps.llm,
            spec_gen: deps.spec_gen,
            project_service: deps.project_service,
            task_service: deps.task_service,
            storage_client: deps.storage_client,
            llm_config,
            runtime: deps.runtime,
        }
    }

    pub(crate) fn get_jwt(&self) -> Option<String> {
        self.store.get_jwt()
    }

    /// Resolve the active session ID for a given agent instance.
    pub(crate) async fn find_active_session_id(
        &self,
        agent_instance_id: &AgentInstanceId,
    ) -> Option<String> {
        let storage = self.storage_client.as_ref()?;
        let jwt = self.get_jwt()?;
        let sessions = storage
            .list_sessions(&agent_instance_id.to_string(), &jwt)
            .await
            .ok()?;
        sessions
            .iter()
            .find(|s| s.status.as_deref() == Some(SESSION_STATUS_ACTIVE))
            .map(|s| s.id.clone())
    }

    /// Ensure an active session exists for this project agent; create one if not.
    /// Returns the session id to use for saving messages, or None if storage is unavailable.
    pub(crate) async fn ensure_active_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Option<String> {
        if let Some(sid) = self.find_active_session_id(agent_instance_id).await {
            return Some(sid);
        }
        let storage = self.storage_client.as_ref()?;
        let jwt = self.get_jwt()?;
        let req = aura_storage::CreateSessionRequest {
            project_id: project_id.to_string(),
            status: Some(SESSION_STATUS_ACTIVE.to_string()),
            context_usage_estimate: None,
            summary_of_previous_context: None,
        };
        let session = storage
            .create_session(&agent_instance_id.to_string(), &jwt, &req)
            .await
            .ok()?;
        Some(session.id)
    }

    /// Update the session's `context_usage_estimate` in aura-storage after a chat turn.
    /// Fire-and-forget: logs a warning on failure.
    pub(crate) async fn update_session_context_usage(
        &self,
        session_id: &str,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        let Some(ref storage) = self.storage_client else {
            return;
        };
        let Some(jwt) = self.get_jwt() else { return };

        let current = match storage.get_session(session_id, &jwt).await {
            Ok(s) => s.context_usage_estimate.unwrap_or(0.0),
            Err(e) => {
                warn!(error = %e, "Failed to get session for context usage update");
                return;
            }
        };
        let turn_usage =
            (input_tokens + output_tokens) as f64 / self.llm_config.max_context_tokens as f64;
        let new_estimate = (current + turn_usage).min(1.0);

        let req = aura_storage::UpdateSessionRequest {
            status: None,
            context_usage_estimate: Some(new_estimate),
            tasks_worked_count: None,
            ended_at: None,
        };
        if let Err(e) = storage.update_session(session_id, &jwt, &req).await {
            warn!(error = %e, "Failed to update session context usage");
        }
    }
}
