use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

use serde::Deserialize;
use tokio::sync::broadcast;

use aura_os_core::{AgentInstanceId, Project, ProjectId};
use aura_os_harness::{AutomatonClient, WsReaderHandle};

use crate::state::AppState;

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
    pub model: Option<String>,
}

pub(super) struct StartContext {
    pub(super) client: Arc<AutomatonClient>,
    pub(super) project_id: ProjectId,
    pub(super) project: Option<Project>,
    pub(super) model: Option<String>,
    pub(super) workspace_root: String,
}

pub(super) struct StartedAutomaton {
    pub(super) automaton_id: String,
    pub(super) event_stream_url: Option<String>,
    pub(super) adopted: bool,
}

pub(super) enum ControlAction {
    Pause,
    Resume,
    Stop,
}

pub(super) struct ForwarderContext {
    pub(super) state: AppState,
    pub(super) project_id: ProjectId,
    pub(super) agent_instance_id: AgentInstanceId,
    pub(super) automaton_id: String,
    pub(super) task_id: Option<String>,
    pub(super) events_tx: broadcast::Sender<serde_json::Value>,
    pub(super) ws_reader_handle: WsReaderHandle,
    pub(super) alive: Arc<AtomicBool>,
    pub(super) timeout: Duration,
}
