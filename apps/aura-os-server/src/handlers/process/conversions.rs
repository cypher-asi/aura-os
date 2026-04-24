use chrono::{DateTime, Utc};

use aura_os_core::{
    AgentId, Process, ProcessArtifact, ProcessEvent, ProcessFolder, ProcessNode,
    ProcessNodeConnection, ProcessNodeType, ProcessRun, ProcessRunTrigger,
};
use aura_os_storage::{
    StorageProcess, StorageProcessArtifact, StorageProcessEvent, StorageProcessFolder,
    StorageProcessNode, StorageProcessNodeConnection, StorageProcessRun,
};

fn parse_dt(s: &Option<String>) -> DateTime<Utc> {
    s.as_deref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn parse_dt_opt(s: &Option<String>) -> Option<DateTime<Utc>> {
    s.as_deref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

fn parse_id<T: std::str::FromStr + Default>(s: &str) -> T {
    s.parse().unwrap_or_default()
}

fn parse_id_opt<T: std::str::FromStr>(s: &Option<String>) -> Option<T> {
    s.as_deref().and_then(|v| v.parse().ok())
}

fn parse_enum<T: serde::de::DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
}

fn storage_tags_to_vec(v: &Option<serde_json::Value>) -> Vec<String> {
    v.as_ref()
        .and_then(|val| val.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn conv_process(sp: StorageProcess) -> Process {
    Process {
        process_id: parse_id(&sp.id),
        org_id: parse_id(
            sp.org_id
                .as_deref()
                .unwrap_or("00000000-0000-0000-0000-000000000000"),
        ),
        user_id: sp.created_by.unwrap_or_default(),
        project_id: parse_id_opt(&sp.project_id),
        name: sp.name.unwrap_or_default(),
        description: sp.description.unwrap_or_default(),
        enabled: sp.enabled.unwrap_or(true),
        folder_id: parse_id_opt(&sp.folder_id),
        schedule: sp.schedule,
        tags: storage_tags_to_vec(&sp.tags),
        last_run_at: parse_dt_opt(&sp.last_run_at),
        next_run_at: parse_dt_opt(&sp.next_run_at),
        created_at: parse_dt(&sp.created_at),
        updated_at: parse_dt(&sp.updated_at),
    }
}

pub(super) fn conv_node(sn: StorageProcessNode) -> ProcessNode {
    ProcessNode {
        node_id: parse_id(&sn.id),
        process_id: parse_id(sn.process_id.as_deref().unwrap_or_default()),
        node_type: sn
            .node_type
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessNodeType::Action),
        label: sn.label.unwrap_or_default(),
        agent_id: parse_id_opt::<AgentId>(&sn.agent_id),
        prompt: sn.prompt.unwrap_or_default(),
        config: sn.config.unwrap_or(serde_json::json!({})),
        position_x: sn.position_x.unwrap_or(0.0),
        position_y: sn.position_y.unwrap_or(0.0),
        created_at: parse_dt(&sn.created_at),
        updated_at: parse_dt(&sn.updated_at),
    }
}

pub(super) fn conv_connection(sc: StorageProcessNodeConnection) -> ProcessNodeConnection {
    ProcessNodeConnection {
        connection_id: parse_id(&sc.id),
        process_id: parse_id(sc.process_id.as_deref().unwrap_or_default()),
        source_node_id: parse_id(sc.source_node_id.as_deref().unwrap_or_default()),
        source_handle: sc.source_handle,
        target_node_id: parse_id(sc.target_node_id.as_deref().unwrap_or_default()),
        target_handle: sc.target_handle,
    }
}

pub(super) fn conv_run(sr: StorageProcessRun) -> ProcessRun {
    use aura_os_core::ProcessRunStatus;

    ProcessRun {
        run_id: parse_id(&sr.id),
        process_id: parse_id(sr.process_id.as_deref().unwrap_or_default()),
        status: sr
            .status
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessRunStatus::Pending),
        trigger: sr
            .trigger
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessRunTrigger::Manual),
        error: sr.error,
        started_at: parse_dt(&sr.started_at),
        completed_at: parse_dt_opt(&sr.completed_at),
        total_input_tokens: sr.total_input_tokens.map(|v| v as u64),
        total_output_tokens: sr.total_output_tokens.map(|v| v as u64),
        cost_usd: sr.cost_usd,
        output: sr.output,
        parent_run_id: parse_id_opt(&sr.parent_run_id),
        input_override: sr.input_override,
    }
}

pub(super) fn conv_event(se: StorageProcessEvent) -> ProcessEvent {
    use aura_os_core::ProcessEventStatus;

    ProcessEvent {
        event_id: parse_id(&se.id),
        run_id: parse_id(se.run_id.as_deref().unwrap_or_default()),
        node_id: parse_id(se.node_id.as_deref().unwrap_or_default()),
        process_id: parse_id(se.process_id.as_deref().unwrap_or_default()),
        status: se
            .status
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessEventStatus::Pending),
        input_snapshot: se.input_snapshot.unwrap_or_default(),
        output: se.output.unwrap_or_default(),
        started_at: parse_dt(&se.started_at),
        completed_at: parse_dt_opt(&se.completed_at),
        input_tokens: se.input_tokens.map(|v| v as u64),
        output_tokens: se.output_tokens.map(|v| v as u64),
        model: se.model,
        content_blocks: se.content_blocks.and_then(|v| v.as_array().cloned()),
    }
}

pub(super) fn conv_artifact(sa: StorageProcessArtifact) -> ProcessArtifact {
    use aura_os_core::ArtifactType;

    ProcessArtifact {
        artifact_id: parse_id(&sa.id),
        process_id: parse_id(sa.process_id.as_deref().unwrap_or_default()),
        run_id: parse_id(sa.run_id.as_deref().unwrap_or_default()),
        node_id: parse_id(sa.node_id.as_deref().unwrap_or_default()),
        artifact_type: sa
            .artifact_type
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ArtifactType::Custom),
        name: sa.name.unwrap_or_default(),
        file_path: sa.file_path.unwrap_or_default(),
        size_bytes: sa.size_bytes.unwrap_or(0) as u64,
        metadata: sa.metadata.unwrap_or(serde_json::json!({})),
        created_at: parse_dt(&sa.created_at),
    }
}

pub(super) fn conv_folder(sf: StorageProcessFolder) -> ProcessFolder {
    ProcessFolder {
        folder_id: parse_id(&sf.id),
        org_id: parse_id(sf.org_id.as_deref().unwrap_or_default()),
        user_id: sf.created_by.unwrap_or_default(),
        name: sf.name.unwrap_or_default(),
        created_at: parse_dt(&sf.created_at),
        updated_at: parse_dt(&sf.updated_at),
    }
}
