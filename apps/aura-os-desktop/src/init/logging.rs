//! tracing-subscriber wiring for the desktop binary.
//!
//! Shipped builds use `windows_subsystem = "windows"` (or are launched from
//! Finder on macOS), which means stdout/stderr are not connected to anything
//! the user can read. Without a file appender, every `tracing::warn!` emitted
//! by the updater (or any other subsystem) is lost — which is exactly why
//! every prior auto-updater failure has been impossible to diagnose
//! post-mortem. We always layer a rolling file appender under
//! `<data_dir>/logs/desktop.log` in addition to stderr so the same diagnostic
//! is available from a packaged build.

use std::path::PathBuf;
use std::sync::OnceLock;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use crate::init::paths::default_data_dir;

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_PREFIX: &str = "desktop.log";

/// Holds the non-blocking writer guards for the duration of the process.
/// Dropping these flushes pending log messages, so we keep them alive in a
/// process-wide `OnceLock`.
static GUARDS: OnceLock<Vec<WorkerGuard>> = OnceLock::new();

fn default_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new(
            "aura_os_desktop=info,aura_os_server=info,aura_engine=info,tower_http=warn,info",
        )
    })
}

/// Returns the directory where rolling log files live. Created if missing.
pub(crate) fn log_dir() -> PathBuf {
    let data_dir = default_data_dir();
    let dir = data_dir.join(LOG_DIR_NAME);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub(crate) fn init_logging() {
    let log_dir = log_dir();
    let file_appender = rolling::daily(&log_dir, LOG_FILE_PREFIX);
    let (file_writer, file_guard) = tracing_appender::non_blocking(file_appender);

    let stderr_layer = fmt::layer().with_writer(std::io::stderr);
    let file_layer = fmt::layer().with_ansi(false).with_writer(file_writer);

    let init_result = tracing_subscriber::registry()
        .with(default_filter())
        .with(stderr_layer)
        .with(file_layer)
        .try_init();

    if init_result.is_ok() {
        // Hold the guard for the lifetime of the process. Dropping it here
        // would cause every subsequent log write to be discarded.
        let _ = GUARDS.set(vec![file_guard]);
    }
}
