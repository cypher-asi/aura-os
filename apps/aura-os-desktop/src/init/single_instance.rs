//! Process-wide single-instance guard for packaged desktop launches.
//!
//! Installers and updaters can legitimately try to start Aura while an older
//! process is still winding down. On Windows that used to create two visible
//! app instances. Holding a named mutex for the process lifetime makes the
//! second launch exit cleanly instead.

use tracing::{error, info, warn};

#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};
#[cfg(target_os = "windows")]
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::CreateMutexW;

#[cfg(target_os = "windows")]
const UPDATE_RELAUNCH_ENV: &str = "AURA_UPDATE_RELAUNCH";
#[cfg(target_os = "windows")]
const UPDATE_RELAUNCH_RETRY_TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(target_os = "windows")]
const UPDATE_RELAUNCH_RETRY_INTERVAL: Duration = Duration::from_millis(250);

pub(crate) struct SingleInstanceGuard {
    #[cfg(target_os = "windows")]
    handle: Option<HANDLE>,
}

#[cfg(target_os = "windows")]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            unsafe {
                let _ = CloseHandle(handle);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn acquire_single_instance() -> Result<Option<SingleInstanceGuard>, String> {
    let mutex_name = aura_os_core::Channel::current().single_instance_mutex();
    let wide_name: Vec<u16> = mutex_name
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe { CreateMutexW(None, true, PCWSTR(wide_name.as_ptr())) }
        .map_err(|error| format!("failed to create Aura single-instance mutex: {error}"))?;

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe {
            let _ = CloseHandle(handle);
        }
        return Ok(None);
    }

    Ok(Some(SingleInstanceGuard {
        handle: Some(handle),
    }))
}

#[cfg(target_os = "windows")]
fn update_relaunch_requested() -> bool {
    std::env::var_os(UPDATE_RELAUNCH_ENV).is_some()
}

#[cfg(target_os = "windows")]
fn acquire_single_instance_with_update_retry() -> Result<Option<SingleInstanceGuard>, String> {
    let should_retry = update_relaunch_requested();
    let deadline = Instant::now() + UPDATE_RELAUNCH_RETRY_TIMEOUT;
    let mut logged_retry = false;

    loop {
        match acquire_single_instance()? {
            Some(guard) => return Ok(Some(guard)),
            None if should_retry && Instant::now() < deadline => {
                if !logged_retry {
                    info!(
                        "update relaunch found an existing Aura instance; waiting for shutdown before continuing"
                    );
                    logged_retry = true;
                }
                std::thread::sleep(UPDATE_RELAUNCH_RETRY_INTERVAL);
            }
            None => return Ok(None),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn acquire_single_instance() -> Result<Option<SingleInstanceGuard>, String> {
    Ok(Some(SingleInstanceGuard {}))
}

#[cfg(not(target_os = "windows"))]
fn acquire_single_instance_with_update_retry() -> Result<Option<SingleInstanceGuard>, String> {
    acquire_single_instance()
}

pub(crate) fn acquire_single_instance_or_exit() -> SingleInstanceGuard {
    match acquire_single_instance_with_update_retry() {
        Ok(Some(guard)) => {
            info!("single-instance guard acquired");
            guard
        }
        Ok(None) => {
            info!("another Aura instance is already running; exiting duplicate launch");
            std::process::exit(0);
        }
        Err(error) => {
            warn!(%error, "failed to acquire single-instance guard; continuing startup");
            #[cfg(target_os = "windows")]
            {
                error!(%error, "Aura may allow duplicate instances on this launch");
                SingleInstanceGuard { handle: None }
            }
            #[cfg(not(target_os = "windows"))]
            {
                SingleInstanceGuard {}
            }
        }
    }
}
