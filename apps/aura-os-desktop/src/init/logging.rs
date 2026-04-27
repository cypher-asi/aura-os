//! tracing-subscriber wiring for the desktop binary.

use tracing_subscriber::EnvFilter;

pub(crate) fn init_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new(
                "aura_os_desktop=info,aura_os_server=info,aura_engine=info,tower_http=warn,info",
            )
        }))
        .init();
}
