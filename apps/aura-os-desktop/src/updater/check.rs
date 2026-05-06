//! Periodic and on-demand update checks. Drives the publicly visible
//! [`UpdateStatus`] and never installs anything by itself.

use std::sync::{Arc, RwLock};

use tracing::{error, info, warn};

use super::endpoint::{build_updater, endpoint_for_channel};
use super::{
    set_status, set_status_with_step, updater_supported, UpdateChannel, UpdateState, UpdateStatus,
    UpdateStep, CHECK_INTERVAL, INITIAL_CHECK_DELAY,
};

pub(super) fn check_for_available_update(
    channel: UpdateChannel,
    status: Arc<RwLock<UpdateStatus>>,
) -> Result<Option<String>, String> {
    let updater = build_updater(channel)?;
    let endpoint = endpoint_for_channel(channel)
        .replace("{{target}}", std::env::consts::OS)
        .replace("{{arch}}", std::env::consts::ARCH);
    info!(
        %endpoint,
        current_version = env!("CARGO_PKG_VERSION"),
        %channel,
        "checking for updates"
    );

    set_status(&status, UpdateStatus::Checking);
    let Some(update) = updater
        .check()
        .map_err(|e| format!("update check failed: {e}"))?
    else {
        set_status(&status, UpdateStatus::UpToDate);
        return Ok(None);
    };

    let version = update.version.clone();
    info!(new_version = %version, format = %update.format, "update available");
    set_status(
        &status,
        UpdateStatus::Available {
            version: version.clone(),
            channel,
        },
    );
    Ok(Some(version))
}

fn record_failure(state: &UpdateState, error: String, source: &str) {
    set_status_with_step(
        state,
        UpdateStatus::Failed {
            error: error.clone(),
            last_step: Some(UpdateStep::CheckResult.as_str().to_string()),
        },
        UpdateStep::Failed,
        Some(&format!("source={source}")),
    );
}

fn record_check_outcome(
    state: &UpdateState,
    outcome: Result<Option<String>, String>,
    source: &str,
) {
    match outcome {
        Ok(Some(v)) => info!(version = %v, source, "update available"),
        Ok(None) => {}
        Err(e) => {
            if source == "background" {
                error!(error = %e, "update check failed");
            } else {
                warn!(error = %e, "recheck failed");
            }
            record_failure(state, e, source);
        }
    }
}

fn record_join_failure(state: &UpdateState, error: tokio::task::JoinError, source: &str) {
    if source == "background" {
        error!(error = %error, "update task panicked");
    } else {
        warn!(error = %error, "recheck task failed");
    }
    record_failure(state, format!("update task failed: {error}"), source);
}

/// Spawn the background update-check loop. Call once at startup.
pub(crate) fn spawn_update_loop(state: UpdateState) {
    if !updater_supported() {
        if aura_os_core::Channel::current().is_dev() {
            info!("native updater disabled: dev-channel build does not auto-update");
        } else {
            info!("native updater disabled: updater public key is not configured");
        }
        set_status(&state.status, UpdateStatus::Idle);
        return;
    }

    tokio::spawn(async move {
        // Small initial delay so the app finishes launching first.
        tokio::time::sleep(INITIAL_CHECK_DELAY).await;

        loop {
            let channel = *state.channel.read().expect("updater channel lock poisoned");
            let status = Arc::clone(&state.status);
            match tokio::task::spawn_blocking(move || check_for_available_update(channel, status))
                .await
            {
                Ok(outcome) => record_check_outcome(&state, outcome, "background"),
                Err(error) => record_join_failure(&state, error, "background"),
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

/// Trigger an immediate re-check (e.g. after the user switches channels).
pub(crate) fn trigger_recheck(state: UpdateState) {
    if !updater_supported() {
        set_status(&state.status, UpdateStatus::Idle);
        return;
    }

    set_status(&state.status, UpdateStatus::Checking);

    tokio::spawn(async move {
        let channel = *state.channel.read().expect("updater channel lock poisoned");
        let status = Arc::clone(&state.status);
        match tokio::task::spawn_blocking(move || check_for_available_update(channel, status)).await
        {
            Ok(outcome) => record_check_outcome(&state, outcome, "recheck"),
            Err(error) => record_join_failure(&state, error, "recheck"),
        }
    });
}
