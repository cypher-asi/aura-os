//! Vite frontend dev-server lifecycle: probe / wait / spawn / poll / stop.
//!
//! Two reasons to keep this separate from `frontend::config`: it depends on
//! the `tao` event loop (for `EventLoopProxy`), and it spawns child
//! processes — both concerns the pure config builder shouldn't carry.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tao::event_loop::EventLoopProxy;
use tracing::{info, warn};

use crate::events::UserEvent;
use crate::frontend::config::{FrontendDevServerCandidate, FrontendDevServerConfig};
use crate::net::probe::probe_vite_dev_server;

const FRONTEND_DEV_SERVER_POLL_INTERVAL: Duration = Duration::from_secs(1);
const FRONTEND_DEV_SERVER_READY_POLL_INTERVAL: Duration = Duration::from_millis(100);
const VITE_CLI_RELATIVE_PATH: &str = "node_modules/vite/bin/vite.js";

/// Polls `probe` at `interval` until it returns `true` or `timeout` elapses.
/// Returns whether the probe ever returned `true`. Factored out so tests can
/// inject a deterministic probe without touching the network.
///
/// `timeout == 0` skips the wait entirely and returns the result of a single
/// synchronous probe (the caller's existing one-shot behavior).
pub(crate) fn wait_for_frontend_dev_server_with_probe<F: FnMut() -> bool>(
    mut probe: F,
    timeout: Duration,
    interval: Duration,
) -> bool {
    if timeout.is_zero() {
        return probe();
    }
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if probe() {
            return true;
        }
        let now = std::time::Instant::now();
        if now >= deadline {
            return false;
        }
        let remaining = deadline - now;
        std::thread::sleep(interval.min(remaining));
    }
}

/// Block the current thread (up to `timeout`) until the Vite dev server at
/// `candidate.probe_url` responds. Called before `create_main_webview` so the
/// webview's first navigation can go straight to Vite and avoid the visible
/// "axum bundle first, then reload into Vite" flash.
pub(crate) fn wait_for_frontend_dev_server(
    candidate: &FrontendDevServerCandidate,
    timeout: Duration,
) -> bool {
    if timeout.is_zero() {
        return probe_vite_dev_server(&candidate.probe_url);
    }
    info!(
        frontend = %candidate.probe_url,
        timeout_ms = timeout.as_millis() as u64,
        "waiting for Vite frontend dev server before creating webview"
    );
    let started_at = std::time::Instant::now();
    let probe_url = candidate.probe_url.clone();
    let ready = wait_for_frontend_dev_server_with_probe(
        || probe_vite_dev_server(&probe_url),
        timeout,
        FRONTEND_DEV_SERVER_READY_POLL_INTERVAL,
    );
    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    if ready {
        info!(
            frontend = %candidate.probe_url,
            elapsed_ms,
            "Vite frontend dev server reachable before webview creation"
        );
    } else {
        warn!(
            frontend = %candidate.probe_url,
            elapsed_ms,
            "Vite frontend dev server not reachable before timeout; falling back to bundled frontend (a reload swap may flash when it does come up)"
        );
    }
    ready
}

pub(crate) fn spawn_frontend_dev_server_poller(
    proxy: EventLoopProxy<UserEvent>,
    frontend_dev_candidate: FrontendDevServerCandidate,
) {
    info!(
        frontend = %frontend_dev_candidate.probe_url,
        "waiting for Vite frontend dev server"
    );

    std::thread::spawn(move || loop {
        if probe_vite_dev_server(&frontend_dev_candidate.probe_url) {
            info!(
                frontend = %frontend_dev_candidate.probe_url,
                "Vite frontend dev server became available"
            );
            let _ = proxy.send_event(UserEvent::AttachFrontendDevServer {
                frontend_url: frontend_dev_candidate.frontend_url.clone(),
            });
            break;
        }

        std::thread::sleep(FRONTEND_DEV_SERVER_POLL_INTERVAL);
    });
}

fn find_interface_project_dir() -> Option<PathBuf> {
    let compile_time = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../interface");
    if compile_time.join("package.json").exists() {
        return Some(compile_time);
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|dir| dir.to_path_buf()));

    let mut candidates = vec![PathBuf::from("interface"), PathBuf::from("../../interface")];
    if let Some(ref dir) = exe_dir {
        candidates.push(dir.join("interface"));
        candidates.push(dir.join("../../interface"));
    }

    candidates
        .into_iter()
        .find(|path| path.join("package.json").exists())
}

pub(crate) fn maybe_spawn_frontend_dev_server(
    server_port: u16,
    frontend_dev_server_config: Option<&FrontendDevServerConfig>,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
) -> Option<Child> {
    let (Some(frontend_dev_server_config), Some(frontend_dev_candidate)) =
        (frontend_dev_server_config, frontend_dev_candidate)
    else {
        return None;
    };

    if !frontend_dev_server_config.can_spawn_local
        || probe_vite_dev_server(&frontend_dev_candidate.probe_url)
    {
        return None;
    }

    let Some(interface_dir) = find_interface_project_dir() else {
        warn!("interface project directory not found; continuing with bundled frontend");
        return None;
    };
    let vite_cli = interface_dir.join(VITE_CLI_RELATIVE_PATH);
    if !vite_cli.exists() {
        warn!(
            path = %vite_cli.display(),
            "Vite CLI not found; continuing with bundled frontend"
        );
        return None;
    }

    let mut command = Command::new("node");
    command
        .arg(&vite_cli)
        .arg("--host")
        .arg(&frontend_dev_server_config.bind_host)
        .arg("--port")
        .arg(frontend_dev_server_config.port.to_string())
        .arg("--strictPort")
        .current_dir(&interface_dir)
        .env("AURA_SERVER_PORT", server_port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    match command.spawn() {
        Ok(child) => {
            info!(
                frontend = %frontend_dev_candidate.probe_url,
                pid = child.id(),
                "started managed Vite frontend dev server"
            );
            Some(child)
        }
        Err(error) => {
            warn!(
                %error,
                frontend = %frontend_dev_candidate.probe_url,
                "failed to start managed Vite frontend dev server"
            );
            None
        }
    }
}

pub(crate) fn stop_managed_frontend_dev_server(frontend_dev_server: &mut Option<Child>) {
    let Some(mut child) = frontend_dev_server.take() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => {
            if let Err(error) = child.kill() {
                warn!(
                    %error,
                    pid = child.id(),
                    "failed to stop managed Vite frontend dev server"
                );
            }
            let _ = child.wait();
        }
        Err(error) => {
            warn!(
                %error,
                pid = child.id(),
                "failed to query managed Vite frontend dev server"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::wait_for_frontend_dev_server_with_probe;
    use std::cell::Cell;
    use std::time::{Duration, Instant};

    #[test]
    fn wait_for_frontend_dev_server_returns_early_when_probe_succeeds() {
        let calls = Cell::new(0_u32);
        let started_at = Instant::now();

        let ready = wait_for_frontend_dev_server_with_probe(
            || {
                let count = calls.get() + 1;
                calls.set(count);
                count >= 3
            },
            Duration::from_secs(5),
            Duration::from_millis(5),
        );

        assert!(ready, "probe eventually succeeded, wait must return true");
        assert_eq!(
            calls.get(),
            3,
            "wait must stop calling the probe as soon as it returns true"
        );
        assert!(
            started_at.elapsed() < Duration::from_secs(1),
            "early-success path must not consume the full timeout"
        );
    }

    #[test]
    fn wait_for_frontend_dev_server_returns_false_after_timeout() {
        let calls = Cell::new(0_u32);
        let timeout = Duration::from_millis(60);
        let started_at = Instant::now();

        let ready = wait_for_frontend_dev_server_with_probe(
            || {
                calls.set(calls.get() + 1);
                false
            },
            timeout,
            Duration::from_millis(10),
        );

        assert!(!ready, "probe never succeeded, wait must return false");
        assert!(
            calls.get() >= 1,
            "wait must probe at least once before timing out"
        );
        assert!(
            started_at.elapsed() >= timeout,
            "wait must honor the full timeout before giving up"
        );
    }

    #[test]
    fn wait_for_frontend_dev_server_with_zero_timeout_probes_once() {
        let calls = Cell::new(0_u32);

        let ready = wait_for_frontend_dev_server_with_probe(
            || {
                calls.set(calls.get() + 1);
                true
            },
            Duration::ZERO,
            Duration::from_millis(10),
        );

        assert!(ready);
        assert_eq!(
            calls.get(),
            1,
            "zero-timeout wait must not loop — it's a single synchronous probe"
        );
    }
}
