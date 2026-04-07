use std::collections::HashSet;
use std::sync::Arc;

use aura_os_core::{
    Process, ProcessArtifact, ProcessArtifactId, ProcessEvent, ProcessFolder, ProcessFolderId,
    ProcessId, ProcessNode, ProcessNodeConnection, ProcessNodeConnectionId, ProcessNodeId,
    ProcessRun, ProcessRunId, ProcessRunTranscriptEvent,
};
use aura_os_store::RocksStore;

use crate::error::ProcessError;

const CF_PROCESSES: &str = "processes";
const CF_PROCESS_FOLDERS: &str = "process_folders";
const CF_PROCESS_NODES: &str = "process_nodes";
const CF_PROCESS_NODE_CONNECTIONS: &str = "process_node_connections";
const CF_PROCESS_RUNS: &str = "process_runs";
const CF_PROCESS_EVENTS: &str = "process_events";
const CF_PROCESS_RUN_TRANSCRIPTS: &str = "process_run_transcripts";
const CF_PROCESS_ARTIFACTS: &str = "process_artifacts";

pub fn column_families() -> Vec<&'static str> {
    vec![
        CF_PROCESSES,
        CF_PROCESS_FOLDERS,
        CF_PROCESS_NODES,
        CF_PROCESS_NODE_CONNECTIONS,
        CF_PROCESS_RUNS,
        CF_PROCESS_EVENTS,
        CF_PROCESS_RUN_TRANSCRIPTS,
        CF_PROCESS_ARTIFACTS,
    ]
}

#[derive(Clone)]
pub struct ProcessStore {
    store: Arc<RocksStore>,
}

impl ProcessStore {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    // -- Processes -----------------------------------------------------------

    pub fn save_process(&self, process: &Process) -> Result<(), ProcessError> {
        let key = process.process_id.to_string();
        let value = serde_json::to_vec(process).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESSES, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn get_process(&self, id: &ProcessId) -> Result<Option<Process>, ProcessError> {
        let key = id.to_string();
        match self.store.get_cf_bytes(CF_PROCESSES, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let p = serde_json::from_slice(&bytes)
                    .map_err(|e| ProcessError::Store(e.to_string()))?;
                Ok(Some(p))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(ProcessError::Store(e.to_string())),
        }
    }

    pub fn list_processes(&self) -> Result<Vec<Process>, ProcessError> {
        let mut results: Vec<Process> = self
            .store
            .scan_cf_all(CF_PROCESSES)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(results)
    }

    pub fn delete_process(&self, id: &ProcessId) -> Result<(), ProcessError> {
        self.store
            .write_batch(vec![aura_os_store::BatchOp::Delete {
                cf: CF_PROCESSES.to_string(),
                key: id.to_string(),
            }])
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    // -- Folders -------------------------------------------------------------

    pub fn save_folder(&self, folder: &ProcessFolder) -> Result<(), ProcessError> {
        let key = folder.folder_id.to_string();
        let value = serde_json::to_vec(folder).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESS_FOLDERS, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn get_folder(&self, id: &ProcessFolderId) -> Result<Option<ProcessFolder>, ProcessError> {
        let key = id.to_string();
        match self.store.get_cf_bytes(CF_PROCESS_FOLDERS, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let f = serde_json::from_slice(&bytes)
                    .map_err(|e| ProcessError::Store(e.to_string()))?;
                Ok(Some(f))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(ProcessError::Store(e.to_string())),
        }
    }

    pub fn list_folders(&self) -> Result<Vec<ProcessFolder>, ProcessError> {
        let mut results: Vec<ProcessFolder> = self
            .store
            .scan_cf_all(CF_PROCESS_FOLDERS)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(results)
    }

    pub fn delete_folder(&self, id: &ProcessFolderId) -> Result<(), ProcessError> {
        self.store
            .write_batch(vec![aura_os_store::BatchOp::Delete {
                cf: CF_PROCESS_FOLDERS.to_string(),
                key: id.to_string(),
            }])
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    // -- Nodes ---------------------------------------------------------------

    pub fn save_node(&self, node: &ProcessNode) -> Result<(), ProcessError> {
        let key = format!("{}:{}", node.process_id, node.node_id);
        let value = serde_json::to_vec(node).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESS_NODES, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn list_nodes(&self, process_id: &ProcessId) -> Result<Vec<ProcessNode>, ProcessError> {
        let prefix = process_id.to_string();
        self.store
            .scan_cf_prefix(CF_PROCESS_NODES, &prefix)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn get_node(
        &self,
        process_id: &ProcessId,
        node_id: &ProcessNodeId,
    ) -> Result<Option<ProcessNode>, ProcessError> {
        let key = format!("{process_id}:{node_id}");
        match self.store.get_cf_bytes(CF_PROCESS_NODES, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let n = serde_json::from_slice(&bytes)
                    .map_err(|e| ProcessError::Store(e.to_string()))?;
                Ok(Some(n))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(ProcessError::Store(e.to_string())),
        }
    }

    pub fn delete_node(
        &self,
        process_id: &ProcessId,
        node_id: &ProcessNodeId,
    ) -> Result<(), ProcessError> {
        let key = format!("{process_id}:{node_id}");
        let mut ops = vec![aura_os_store::BatchOp::Delete {
            cf: CF_PROCESS_NODES.to_string(),
            key,
        }];

        for conn in self.load_connections_for_process(process_id)? {
            if conn.source_node_id == *node_id || conn.target_node_id == *node_id {
                ops.push(aura_os_store::BatchOp::Delete {
                    cf: CF_PROCESS_NODE_CONNECTIONS.to_string(),
                    key: format!("{process_id}:{}", conn.connection_id),
                });
            }
        }

        self.store
            .write_batch(ops)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    // -- Connections ---------------------------------------------------------

    pub fn save_connection(&self, conn: &ProcessNodeConnection) -> Result<(), ProcessError> {
        let key = format!("{}:{}", conn.process_id, conn.connection_id);
        let value = serde_json::to_vec(conn).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESS_NODE_CONNECTIONS, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn list_connections(
        &self,
        process_id: &ProcessId,
    ) -> Result<Vec<ProcessNodeConnection>, ProcessError> {
        let node_ids: HashSet<ProcessNodeId> = self
            .list_nodes(process_id)?
            .into_iter()
            .map(|node| node.node_id)
            .collect();
        let all = self.load_connections_for_process(process_id)?;

        let (valid, dangling): (Vec<_>, Vec<_>) = all.into_iter().partition(|conn| {
            node_ids.contains(&conn.source_node_id) && node_ids.contains(&conn.target_node_id)
        });

        if !dangling.is_empty() {
            let ops = dangling
                .iter()
                .map(|conn| aura_os_store::BatchOp::Delete {
                    cf: CF_PROCESS_NODE_CONNECTIONS.to_string(),
                    key: format!("{process_id}:{}", conn.connection_id),
                })
                .collect();
            self.store
                .write_batch(ops)
                .map_err(|e| ProcessError::Store(e.to_string()))?;
        }

        Ok(valid)
    }

    pub fn delete_connection(
        &self,
        process_id: &ProcessId,
        connection_id: &ProcessNodeConnectionId,
    ) -> Result<(), ProcessError> {
        let key = format!("{process_id}:{connection_id}");
        self.store
            .write_batch(vec![aura_os_store::BatchOp::Delete {
                cf: CF_PROCESS_NODE_CONNECTIONS.to_string(),
                key,
            }])
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    // -- Runs ----------------------------------------------------------------

    pub fn save_run(&self, run: &ProcessRun) -> Result<(), ProcessError> {
        let key = format!("{}:{}", run.process_id, run.run_id);
        let value = serde_json::to_vec(run).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESS_RUNS, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn list_runs(&self, process_id: &ProcessId) -> Result<Vec<ProcessRun>, ProcessError> {
        let all: Vec<ProcessRun> = self
            .store
            .scan_cf_all(CF_PROCESS_RUNS)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        let mut filtered: Vec<ProcessRun> = all
            .into_iter()
            .filter(|r| r.process_id == *process_id)
            .collect();
        filtered.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(filtered)
    }

    pub fn get_run(
        &self,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
    ) -> Result<Option<ProcessRun>, ProcessError> {
        let key = format!("{process_id}:{run_id}");
        match self.store.get_cf_bytes(CF_PROCESS_RUNS, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let r = serde_json::from_slice(&bytes)
                    .map_err(|e| ProcessError::Store(e.to_string()))?;
                Ok(Some(r))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(ProcessError::Store(e.to_string())),
        }
    }

    // -- Events --------------------------------------------------------------

    pub fn save_event(&self, event: &ProcessEvent) -> Result<(), ProcessError> {
        let key = format!("{}:{}:{}", event.process_id, event.run_id, event.event_id);
        let value = serde_json::to_vec(event).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESS_EVENTS, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn list_events_for_run(
        &self,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
    ) -> Result<Vec<ProcessEvent>, ProcessError> {
        let all: Vec<ProcessEvent> = self
            .store
            .scan_cf_all(CF_PROCESS_EVENTS)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        let mut filtered: Vec<ProcessEvent> = all
            .into_iter()
            .filter(|e| e.process_id == *process_id && e.run_id == *run_id)
            .collect();
        filtered.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        Ok(filtered)
    }

    pub fn delete_event(
        &self,
        event_id: &aura_os_core::ProcessEventId,
    ) -> Result<(), ProcessError> {
        let all: Vec<ProcessEvent> = self
            .store
            .scan_cf_all(CF_PROCESS_EVENTS)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        if let Some(evt) = all.iter().find(|e| e.event_id == *event_id) {
            let key = format!("{}:{}:{}", evt.process_id, evt.run_id, evt.event_id);
            self.store
                .write_batch(vec![aura_os_store::BatchOp::Delete {
                    cf: CF_PROCESS_EVENTS.to_string(),
                    key,
                }])
                .map_err(|e| ProcessError::Store(e.to_string()))?;
        }
        Ok(())
    }

    /// Overwrite an existing event in-place (same key derivation as save_event).
    pub fn update_event(&self, event: &ProcessEvent) -> Result<(), ProcessError> {
        self.save_event(event)
    }

    // -- Run transcript events -----------------------------------------------

    pub fn save_run_transcript_event(
        &self,
        event: &ProcessRunTranscriptEvent,
    ) -> Result<(), ProcessError> {
        let key = format!(
            "{}:{}:{}:{}",
            event.process_id, event.run_id, event.created_at, event.transcript_id
        );
        let value = serde_json::to_vec(event).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESS_RUN_TRANSCRIPTS, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn list_run_transcript(
        &self,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
    ) -> Result<Vec<ProcessRunTranscriptEvent>, ProcessError> {
        let all: Vec<ProcessRunTranscriptEvent> = self
            .store
            .scan_cf_all(CF_PROCESS_RUN_TRANSCRIPTS)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        let mut filtered: Vec<ProcessRunTranscriptEvent> = all
            .into_iter()
            .filter(|e| e.process_id == *process_id && e.run_id == *run_id)
            .collect();
        filtered.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(filtered)
    }

    // -- Artifacts -----------------------------------------------------------

    pub fn save_artifact(&self, artifact: &ProcessArtifact) -> Result<(), ProcessError> {
        let key = format!(
            "{}:{}:{}",
            artifact.process_id, artifact.run_id, artifact.artifact_id
        );
        let value = serde_json::to_vec(artifact).map_err(|e| ProcessError::Store(e.to_string()))?;
        self.store
            .put_cf_bytes(CF_PROCESS_ARTIFACTS, key.as_bytes(), &value)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn get_artifact(
        &self,
        artifact_id: &ProcessArtifactId,
    ) -> Result<Option<ProcessArtifact>, ProcessError> {
        let all: Vec<ProcessArtifact> = self
            .store
            .scan_cf_all(CF_PROCESS_ARTIFACTS)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        Ok(all.into_iter().find(|a| a.artifact_id == *artifact_id))
    }

    pub fn list_artifacts_for_run(
        &self,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
    ) -> Result<Vec<ProcessArtifact>, ProcessError> {
        let prefix = format!("{process_id}:{run_id}");
        self.store
            .scan_cf_prefix(CF_PROCESS_ARTIFACTS, &prefix)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    pub fn list_artifacts_for_process(
        &self,
        process_id: &ProcessId,
    ) -> Result<Vec<ProcessArtifact>, ProcessError> {
        let prefix = process_id.to_string();
        self.store
            .scan_cf_prefix(CF_PROCESS_ARTIFACTS, &prefix)
            .map_err(|e| ProcessError::Store(e.to_string()))
    }

    fn load_connections_for_process(
        &self,
        process_id: &ProcessId,
    ) -> Result<Vec<ProcessNodeConnection>, ProcessError> {
        let all: Vec<ProcessNodeConnection> = self
            .store
            .scan_cf_all(CF_PROCESS_NODE_CONNECTIONS)
            .map_err(|e| ProcessError::Store(e.to_string()))?;
        Ok(all
            .into_iter()
            .filter(|c| c.process_id == *process_id)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use aura_os_core::{
        OrgId, Process, ProcessId, ProcessNode, ProcessNodeConnection, ProcessNodeConnectionId,
        ProcessNodeId, ProcessNodeType,
    };
    use aura_os_store::RocksStore;
    use chrono::Utc;
    use serde_json::json;
    use tempfile::TempDir;

    use super::ProcessStore;

    fn open_temp_process_store() -> (ProcessStore, TempDir) {
        let dir = TempDir::new().expect("failed to create temp dir");
        let rocks = Arc::new(RocksStore::open(dir.path()).expect("failed to open rocks store"));
        (ProcessStore::new(rocks), dir)
    }

    fn make_process(process_id: ProcessId) -> Process {
        let now = Utc::now();
        Process {
            process_id,
            org_id: OrgId::new(),
            user_id: "user-1".to_string(),
            project_id: None,
            name: "Test Process".to_string(),
            description: String::new(),
            enabled: true,
            folder_id: None,
            schedule: None,
            tags: vec![],
            last_run_at: None,
            next_run_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn make_node(
        process_id: ProcessId,
        node_id: ProcessNodeId,
        node_type: ProcessNodeType,
    ) -> ProcessNode {
        let now = Utc::now();
        ProcessNode {
            node_id,
            process_id,
            node_type,
            label: format!("{node_type:?}"),
            agent_id: None,
            prompt: String::new(),
            config: json!({}),
            position_x: 0.0,
            position_y: 0.0,
            created_at: now,
            updated_at: now,
        }
    }

    fn make_connection(
        process_id: ProcessId,
        connection_id: ProcessNodeConnectionId,
        source_node_id: ProcessNodeId,
        target_node_id: ProcessNodeId,
    ) -> ProcessNodeConnection {
        ProcessNodeConnection {
            connection_id,
            process_id,
            source_node_id,
            source_handle: None,
            target_node_id,
            target_handle: None,
        }
    }

    #[test]
    fn delete_node_removes_incident_connections() {
        let (store, _dir) = open_temp_process_store();
        let process_id = ProcessId::new();
        let source_id = ProcessNodeId::new();
        let target_id = ProcessNodeId::new();
        let other_id = ProcessNodeId::new();

        store.save_process(&make_process(process_id)).unwrap();
        store
            .save_node(&make_node(process_id, source_id, ProcessNodeType::Ignition))
            .unwrap();
        store
            .save_node(&make_node(process_id, target_id, ProcessNodeType::Action))
            .unwrap();
        store
            .save_node(&make_node(process_id, other_id, ProcessNodeType::Action))
            .unwrap();

        let deleted_conn = make_connection(
            process_id,
            ProcessNodeConnectionId::new(),
            source_id,
            target_id,
        );
        let kept_conn = make_connection(
            process_id,
            ProcessNodeConnectionId::new(),
            target_id,
            other_id,
        );
        store.save_connection(&deleted_conn).unwrap();
        store.save_connection(&kept_conn).unwrap();

        store.delete_node(&process_id, &source_id).unwrap();

        let listed = store.list_connections(&process_id).unwrap();
        assert_eq!(listed, vec![kept_conn]);
    }

    #[test]
    fn list_connections_prunes_dangling_entries() {
        let (store, _dir) = open_temp_process_store();
        let process_id = ProcessId::new();
        let source_id = ProcessNodeId::new();
        let target_id = ProcessNodeId::new();
        let missing_id = ProcessNodeId::new();

        store.save_process(&make_process(process_id)).unwrap();
        store
            .save_node(&make_node(process_id, source_id, ProcessNodeType::Ignition))
            .unwrap();
        store
            .save_node(&make_node(process_id, target_id, ProcessNodeType::Action))
            .unwrap();

        let valid_conn = make_connection(
            process_id,
            ProcessNodeConnectionId::new(),
            source_id,
            target_id,
        );
        let dangling_conn = make_connection(
            process_id,
            ProcessNodeConnectionId::new(),
            source_id,
            missing_id,
        );
        store.save_connection(&valid_conn).unwrap();
        store.save_connection(&dangling_conn).unwrap();

        let listed = store.list_connections(&process_id).unwrap();
        assert_eq!(listed, vec![valid_conn.clone()]);

        let listed_again = store.list_connections(&process_id).unwrap();
        assert_eq!(listed_again, vec![valid_conn]);
    }
}
