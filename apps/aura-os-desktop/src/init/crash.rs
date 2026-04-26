//! Process-level crash handlers wired up at startup so a fatal error always
//! leaves a forensic trace under the user's data directory.

use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;

pub(crate) fn install_panic_hook(data_dir: &Path) {
    let crash_log = data_dir.join("crash.log");
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let msg = format!("PANIC at unix_ts={ts}\n{info}\n\nBacktrace:\n{backtrace}\n");
        eprintln!("{msg}");
        let _ = std::fs::write(&crash_log, &msg);
    }));
}

#[cfg(target_os = "windows")]
pub(crate) fn install_native_crash_handler(data_dir: &Path) {
    use std::sync::OnceLock;
    static CRASH_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
    CRASH_LOG_PATH.get_or_init(|| data_dir.join("native-crash.log"));

    unsafe extern "system" fn handler(
        info: *const windows::Win32::System::Diagnostics::Debug::EXCEPTION_POINTERS,
    ) -> i32 {
        let code = if !info.is_null() && !(*info).ExceptionRecord.is_null() {
            (*(*info).ExceptionRecord).ExceptionCode.0
        } else {
            0
        };
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let msg = format!(
            "NATIVE CRASH at unix_ts={ts}\nException code: 0x{code:08X}\n\
             This is likely a WebView2/wry crash.\n\
             Check Windows Event Viewer > Application for more details.\n"
        );
        eprintln!("{msg}");
        if let Some(path) = CRASH_LOG_PATH.get() {
            let _ = std::fs::write(path, &msg);
        }
        // EXCEPTION_CONTINUE_SEARCH — let the default handler terminate the process
        0
    }

    unsafe {
        windows::Win32::System::Diagnostics::Debug::SetUnhandledExceptionFilter(Some(handler));
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn install_native_crash_handler(_data_dir: &Path) {}
