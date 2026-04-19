//! Live smoke test that launches real Chromium via the `cdp` feature.
//!
//! The test is `#[ignore]` so it doesn't run in CI by default. To run it
//! locally:
//!
//! ```text
//! cargo test -p aura-os-browser --features cdp --test cdp_smoke -- --ignored --nocapture
//! ```
//!
//! A Chromium/Chrome executable must be discoverable (in `$PATH`, the
//! system default location, or via `BROWSER_EXECUTABLE_PATH`). The test
//! opens `about:blank`, waits for a single screencast frame, and then
//! shuts the session down cleanly.

#![cfg(feature = "cdp")]

use std::sync::Arc;
use std::time::Duration;

use aura_os_browser::{
    BrowserConfig, BrowserManager, CdpBackend, CdpBackendConfig, ServerEvent, SpawnOptions,
};
use tempfile::tempdir;

#[tokio::test]
#[ignore = "launches real Chromium; run locally with --ignored"]
async fn cdp_smoke_end_to_end() {
    let dir = tempdir().expect("tempdir");
    let config = BrowserConfig::default().with_settings_root(dir.path().to_path_buf());
    let backend = Arc::new(CdpBackend::with_config(CdpBackendConfig {
        disable_sandbox: true,
        ..CdpBackendConfig::default()
    }));
    let manager = Arc::new(BrowserManager::with_backend(config, backend));

    let spawn = manager
        .spawn(SpawnOptions {
            width: 640,
            height: 480,
            project_id: None,
            initial_url: None,
            frame_quality: Some(60),
        })
        .await
        .expect("spawn");

    let mut events = manager
        .take_events(spawn.id)
        .expect("event channel available after spawn");

    let frame = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match events.recv().await {
                Some(ServerEvent::Frame { seq, .. }) => break seq,
                Some(_) => continue,
                None => panic!("event channel closed before first frame"),
            }
        }
    })
    .await
    .expect("at least one frame within 20s");
    assert!(frame >= 1, "frame seq must be >= 1");

    manager.kill(spawn.id).await.expect("kill");
}
