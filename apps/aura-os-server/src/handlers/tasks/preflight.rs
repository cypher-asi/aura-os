use aura_os_core::{ProjectId, Task};

use crate::handlers::dev_loop::auto_decompose_disabled;
use crate::handlers::task_decompose::{
    detect_preflight_decomposition, spawn_skeleton_and_fill_children, DecompositionContext,
    DecompositionSignal,
};
use crate::state::AppState;

pub(super) fn preflight_should_run(skip_auto_decompose: bool) -> bool {
    !auto_decompose_disabled() && !skip_auto_decompose
}

pub(super) async fn try_preflight_decompose_task(
    state: &AppState,
    jwt: &str,
    project_id: &ProjectId,
    parent: &Task,
    title: &str,
    description: &str,
    skip_auto_decompose: bool,
) -> Result<(), String> {
    if !preflight_should_run(skip_auto_decompose) {
        return Ok(());
    }
    let Some(signal) = detect_preflight_decomposition(title, description) else {
        return Ok(());
    };
    let DecompositionSignal {
        target_path,
        estimated_chunk_bytes,
        reason,
    } = signal;

    let children = spawn_skeleton_and_fill_children(
        state.task_service.as_ref(),
        parent,
        target_path.as_deref(),
        estimated_chunk_bytes,
        DecompositionContext::Preflight {
            reason: reason.clone(),
        },
    )
    .await
    .map_err(|e| format!("spawning skeleton+fill children: {e}"))?;

    let storage = state
        .storage_client
        .as_ref()
        .ok_or_else(|| "storage client not configured".to_string())?;
    let task_id_str = parent.task_id.to_string();

    if let Err(error) = storage
        .transition_task(
            &task_id_str,
            jwt,
            &aura_os_storage::TransitionTaskRequest {
                status: "backlog".to_string(),
            },
        )
        .await
    {
        tracing::warn!(
            task_id = %task_id_str,
            %error,
            "Phase 5: failed to park parent task in backlog; scheduler may still pick it up"
        );
    }

    let note = format!(
        "Preflight auto-decomposed ({reason}). Children: {}",
        children
            .iter()
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    if let Err(error) = storage
        .update_task(
            &task_id_str,
            jwt,
            &aura_os_storage::UpdateTaskRequest {
                execution_notes: Some(note),
                ..Default::default()
            },
        )
        .await
    {
        tracing::warn!(
            task_id = %task_id_str,
            %error,
            "Phase 5: failed to write execution_notes on decomposed parent"
        );
    }

    let child_id_strings: Vec<String> = children.iter().map(|c| c.to_string()).collect();
    tracing::info!(
        task_id = %task_id_str,
        reason = %reason,
        children = ?child_id_strings,
        "Phase 5 preflight-decomposed an oversized task"
    );
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "task_preflight_decomposed",
        "project_id": project_id.to_string(),
        "parent_task_id": task_id_str,
        "child_task_ids": child_id_strings,
        "reason": reason,
    }));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        use std::sync::Mutex;
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|p| p.into_inner())
    }

    #[test]
    fn preflight_decomposition_skipped_when_env_flag_set() {
        let _guard = env_lock();
        std::env::set_var("AURA_AUTO_DECOMPOSE_DISABLED", "1");
        assert!(!preflight_should_run(false));
        std::env::remove_var("AURA_AUTO_DECOMPOSE_DISABLED");
        assert!(preflight_should_run(false));
    }

    #[test]
    fn preflight_decomposition_skipped_when_task_opts_out() {
        let _guard = env_lock();
        std::env::remove_var("AURA_AUTO_DECOMPOSE_DISABLED");
        assert!(!preflight_should_run(true));
        assert!(preflight_should_run(false));
    }
}
