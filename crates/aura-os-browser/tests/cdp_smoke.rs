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

use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use aura_os_browser::{
    BrowserConfig, BrowserManager, CdpBackend, CdpBackendConfig, ClientMsg, InspectionKind,
    ServerEvent, SpawnOptions,
};
use tempfile::tempdir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

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
            proxy_server: None,
            proxy_bypass_list: None,
            cleanup_token: None,
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
            if page_loaded {
                if let Some(frame) = first_frame {
                    break frame;
                }
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

#[tokio::test]
#[ignore = "launches real Chromium; run locally with --ignored"]
async fn cdp_session_proxy_routes_localhost_without_implicit_bypass() {
    let page_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind test page");
    let page_port = page_listener.local_addr().unwrap().port();
    let page_url = format!("http://localhost:{page_port}/");
    let page_lifetime = CancellationToken::new();
    let page_task_lifetime = page_lifetime.clone();
    let page_task = tokio::spawn(async move {
        let body = br#"<!doctype html><title>Remote Preview Proxy</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#071a18;color:#e9fffa;font-family:system-ui}.card{border:1px solid #26d9b1;border-radius:18px;padding:42px 56px;box-shadow:0 20px 80px #0008}.ok{color:#26d9b1;font-size:14px;letter-spacing:.18em}h1{margin:12px 0 6px;font-size:36px}p{color:#9ccfc4}</style><main class="card"><div class="ok">REMOTE AGENT PREVIEW</div><h1>localhost routed correctly</h1><p>Chromium received this page through the agent tunnel.</p></main>"#;
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len(),
        );
        loop {
            let accepted = tokio::select! {
                _ = page_task_lifetime.cancelled() => break,
                accepted = page_listener.accept() => accepted,
            };
            let Ok((mut stream, _)) = accepted else { break };
            let response_head = head.clone();
            tokio::spawn(async move {
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request).await;
                let _ = stream.write_all(response_head.as_bytes()).await;
                let _ = stream.write_all(body).await;
            });
        }
    });

    let proxy_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind SOCKS proxy");
    let proxy_address = proxy_listener.local_addr().unwrap();
    let proxy_seen = Arc::new(AtomicBool::new(false));
    let proxy_lifetime = CancellationToken::new();
    let proxy_task = tokio::spawn(run_test_socks_proxy(
        proxy_listener,
        page_port,
        Arc::clone(&proxy_seen),
        proxy_lifetime.clone(),
    ));

    let dir = tempdir().expect("tempdir");
    let config = BrowserConfig::default().with_settings_root(dir.path().to_path_buf());
    let backend = Arc::new(CdpBackend::with_config(CdpBackendConfig {
        disable_sandbox: true,
        ..CdpBackendConfig::default()
    }));
    let manager = BrowserManager::with_backend(config, backend);
    let mut options = SpawnOptions::new(640, 480);
    options.initial_url = Some(page_url.parse().unwrap());
    options.proxy_server = Some(format!("socks5://{proxy_address}"));
    options.proxy_bypass_list = Some("<-loopback>".to_string());
    let spawn = manager.spawn(options).await.expect("spawn proxied browser");
    let mut events = manager.take_events(spawn.id).unwrap();

    let screenshot = tokio::time::timeout(Duration::from_secs(20), async {
        let mut navigated = false;
        let mut screenshot = None;
        loop {
            match events.recv().await {
                Some(ServerEvent::Nav(state)) if state.url == page_url => {
                    if !navigated {
                        // Discard the initial about:blank screencast frame;
                        // the next frame is the tunneled document we want to
                        // inspect visually.
                        screenshot = None;
                        navigated = true;
                        manager
                            .dispatch(
                                spawn.id,
                                ClientMsg::Resize {
                                    width: 641,
                                    height: 480,
                                },
                            )
                            .await
                            .unwrap();
                    }
                }
                Some(ServerEvent::Frame { seq, jpeg, .. }) => {
                    manager.ack_frame(spawn.id, seq).await.unwrap();
                    screenshot = Some(jpeg);
                }
                Some(_) => {}
                None => panic!("browser session closed before proxied page loaded"),
            }
            if navigated {
                if let Some(screenshot) = screenshot {
                    break screenshot;
                }
            }
        }
    })
    .await
    .expect("proxied localhost page loaded");

    assert!(screenshot.starts_with(&[0xff, 0xd8]));
    if let Ok(path) = std::env::var("AURA_CDP_SMOKE_SCREENSHOT") {
        tokio::fs::write(path, screenshot).await.unwrap();
    }

    manager
        .dispatch(
            spawn.id,
            ClientMsg::Inspect {
                request_id: 99,
                kind: InspectionKind::Select,
                x: 320.0,
                y: 240.0,
            },
        )
        .await
        .expect("dispatch proxied Design inspection");
    let element = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match events.recv().await {
                Some(ServerEvent::Inspection(result)) if result.request_id == 99 => {
                    break result.element.expect("element at proxied inspection point");
                }
                Some(ServerEvent::Frame { seq, .. }) => {
                    manager.ack_frame(spawn.id, seq).await.unwrap();
                }
                Some(_) => {}
                None => panic!("browser session closed before Design inspection"),
            }
        }
    })
    .await
    .expect("Design inspection completed through remote Preview");
    assert_eq!(element.tag_name, "h1");
    assert!(element.text.contains("localhost routed correctly"));

    assert!(
        proxy_seen.load(Ordering::SeqCst),
        "Chromium bypassed the per-session proxy for localhost"
    );
    manager.kill(spawn.id).await.unwrap();
    proxy_lifetime.cancel();
    page_lifetime.cancel();
    proxy_task.await.unwrap();
    page_task.await.unwrap();
}

async fn run_test_socks_proxy(
    listener: TcpListener,
    expected_port: u16,
    seen: Arc<AtomicBool>,
    lifetime: CancellationToken,
) {
    loop {
        let accepted = tokio::select! {
            _ = lifetime.cancelled() => break,
            accepted = listener.accept() => accepted,
        };
        let Ok((stream, _)) = accepted else { break };
        let connection_seen = Arc::clone(&seen);
        tokio::spawn(async move {
            let _ = handle_test_socks_connection(stream, expected_port, connection_seen).await;
        });
    }
}

async fn handle_test_socks_connection(
    mut client: TcpStream,
    expected_port: u16,
    seen: Arc<AtomicBool>,
) -> std::io::Result<()> {
    let mut greeting = [0_u8; 2];
    client.read_exact(&mut greeting).await?;
    let mut methods = vec![0_u8; greeting[1] as usize];
    client.read_exact(&mut methods).await?;
    client.write_all(&[5, 0]).await?;

    let mut header = [0_u8; 4];
    client.read_exact(&mut header).await?;
    match header[3] {
        1 => {
            let mut address = [0_u8; 4];
            client.read_exact(&mut address).await?;
        }
        3 => {
            let length = client.read_u8().await? as usize;
            let mut address = vec![0_u8; length];
            client.read_exact(&mut address).await?;
        }
        4 => {
            let mut address = [0_u8; 16];
            client.read_exact(&mut address).await?;
        }
        _ => return Ok(()),
    }
    let port = client.read_u16().await?;
    if port != expected_port {
        client.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
        return Ok(());
    }
    seen.store(true, Ordering::SeqCst);
    let mut upstream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
    client.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}
