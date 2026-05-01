//! Process-wide single-instance guard for packaged desktop launches.
//!
//! Installers and updaters can legitimately try to start Aura while an older
//! process is still winding down. On Windows that used to create two visible
//! app instances. Holding a named mutex for the process lifetime makes the
//! second launch exit cleanly instead.

use tracing::{error, info, warn};

#[cfg(target_os = "windows")]
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, ERROR_ALREADY_EXISTS};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::CreateMutexW;

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
    const MUTEX_NAME: &str = "Local\\com.aura.desktop.single-instance";
    let wide_name: Vec<u16> = MUTEX_NAME.encode_utf16().chain(std::iter::once(0)).collect();
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

#[cfg(not(target_os = "windows"))]
fn acquire_single_instance() -> Result<Option<SingleInstanceGuard>, String> {
    Ok(Some(SingleInstanceGuard {}))
}

pub(crate) fn acquire_single_instance_or_exit() -> SingleInstanceGuard {
    match acquire_single_instance() {
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
