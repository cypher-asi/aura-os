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
//! opens a local page, waits for a screencast frame, inspects a real DOM
//! element, and then shuts the session down cleanly.

#![cfg(feature = "cdp")]

use std::sync::Arc;
use std::time::Duration;

use aura_os_browser::{
    BrowserConfig, BrowserManager, CdpBackend, CdpBackendConfig, ClientMsg, InspectionKind,
    ServerEvent, SpawnOptions,
};
use tempfile::tempdir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[tokio::test]
#[ignore = "launches real Chromium; run locally with --ignored"]
async fn cdp_smoke_end_to_end() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test page");
    let address = listener.local_addr().expect("test page address");
    let page_url = format!("http://{address}/");
    let page_task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept page request");
        let mut request = [0_u8; 2048];
        let _ = stream.read(&mut request).await.expect("read page request");
        let body = br#"<!doctype html><style>body{margin:0}#hero{position:absolute;left:40px;top:30px;width:200px;height:80px}</style><button id="hero" class="primary">Ship preview</button>"#;
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len(),
        );
        stream
            .write_all(head.as_bytes())
            .await
            .expect("write headers");
        stream.write_all(body).await.expect("write page");
    });

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
            initial_url: Some(page_url.parse().expect("valid local page URL")),
            frame_quality: Some(60),
        })
        .await
        .expect("spawn");

    let mut events = manager
        .take_events(spawn.id)
        .expect("event channel available after spawn");

    let frame = tokio::time::timeout(Duration::from_secs(20), async {
        let mut first_frame = None;
        let mut page_loaded = false;
        loop {
            match events.recv().await {
                Some(ServerEvent::Frame { seq, .. }) => {
                    manager.ack_frame(spawn.id, seq).await.expect("ack frame");
                    first_frame.get_or_insert(seq);
                }
                Some(ServerEvent::Nav(state)) => {
                    page_loaded = state.url == page_url && !state.loading;
                }
                Some(_) => continue,
                None => panic!("event channel closed before first frame"),
            }
            if page_loaded && first_frame.is_some() {
                break first_frame.expect("frame was set");
            }
        }
    })
    .await
    .expect("at least one frame within 20s");
    assert!(frame >= 1, "frame seq must be >= 1");

    manager
        .dispatch(
            spawn.id,
            ClientMsg::Inspect {
                request_id: 77,
                kind: InspectionKind::Select,
                x: 100.0,
                y: 60.0,
            },
        )
        .await
        .expect("dispatch inspection");

    let element = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match events.recv().await {
                Some(ServerEvent::Inspection(result)) if result.request_id == 77 => {
                    break result.element.expect("element at inspected point");
                }
                Some(ServerEvent::Frame { seq, .. }) => {
                    manager.ack_frame(spawn.id, seq).await.expect("ack frame");
                }
                Some(_) => continue,
                None => panic!("event channel closed before inspection result"),
            }
        }
    })
    .await
    .expect("inspection result within 20s");
    assert_eq!(element.tag_name, "button");
    assert_eq!(element.id.as_deref(), Some("hero"));
    assert_eq!(element.selector, "#hero");
    assert!(element.text.contains("Ship preview"));

    manager.kill(spawn.id).await.expect("kill");
    page_task.await.expect("test page task");
}
