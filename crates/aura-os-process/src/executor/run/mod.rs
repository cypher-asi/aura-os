//! Process graph execution (`ProcessExecutor` and helpers).
//!
//! Implementation is split across include files in this directory so the
//! orchestration stays in one module (shared private items) without a single
//! oversized source file.

#![allow(clippy::too_many_arguments)]

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_agents::AgentService;
use aura_os_core::{
    Agent, AgentId, ArtifactType, Process, ProcessArtifact, ProcessArtifactId, ProcessEvent,
    ProcessEventId, ProcessEventStatus, ProcessId, ProcessNode, ProcessNodeConnection,
    ProcessNodeId, ProcessNodeType, ProcessRun, ProcessRunId, ProcessRunStatus,
    ProcessRunTranscriptEvent, ProcessRunTrigger, ProjectId, TaskStatus,
};
use aura_os_link::automaton_event_kinds::TEXT_DELTA;
use aura_os_link::{
    collect_automaton_events, is_process_progress_broadcast_event, is_process_stream_forward_event,
    normalize_process_tool_type_field, start_and_connect, AutomatonClient, AutomatonStartParams,
    CollectedOutput, RunCompletion,
};
use aura_os_orgs::OrgService;
use aura_os_storage::{
    StorageClient, StorageError, StorageProcess, StorageProcessNode, StorageProcessNodeConnection,
};
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;

use crate::error::ProcessError;
use crate::process_store::ProcessStore;

use super::cost::{estimate_cost_usd, merge_usage_totals};
use super::payload::{
    compact_process_output, parse_output_compaction_mode, sanitize_content_blocks,
    sanitize_process_payload, should_skip_streamed_process_event, summarize_input_snapshot,
    truncate_for_artifact_context, OutputCompactionMode,
};

include!("helpers.rs");
include!("storage_sync.rs");
include!("executor.rs");
include!("graph.rs");
include!("execute_run.rs");
include!("integration.rs");
include!("planning.rs");
include!("automaton_decompose.rs");
include!("automaton_single.rs");
include!("nodes.rs");
include!("foreach.rs");
include!("nodes_tail.rs");
include!("process_events_record.rs");

#[cfg(test)]
mod tests {
    include!("tests.rs");
}
