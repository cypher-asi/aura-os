//! Lifecycle for the bundled `aura-node` sidecar process: spawn, wait
//! for `/health`, and stop on shutdown.

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tracing::{info, warn};

use crate::harness::binary::resolve_managed_harness_binary;
use crate::init::env::env_string;
use crate::net::probe::{is_local_bind_host, parse_host_port, probe_http_ok};

pub(crate) fn preferred_local_harness_port() -> u16 {
    aura_os_core::Channel::current().preferred_sidecar_port()
}

pub(crate) fn maybe_spawn_local_harness_sidecar(data_dir: &Path) -> Option<Child> {
    let explicit_harness_url =
        env_string("LOCAL_HARNESS_URL").map(|value| value.trim_end_matches('/').to_string());
    let harness_binary = resolve_managed_harness_binary(data_dir);
    let harness_url = explicit_harness_url.clone().unwrap_or_else(|| {
        format!("http://127.0.0.1:{}", preferred_local_harness_port())
    });

    if let Some(ref configured_url) = explicit_harness_url {
        if probe_http_ok(configured_url, "/health") {
            info!(url = %configured_url, "local harness already reachable");
            return None;
        }
    }

    let Some(harness_binary) = harness_binary else {
        if explicit_harness_url.is_some() {
            info!(url = %harness_url, "no managed local harness sidecar found; relying on configured external harness");
        } else {
            info!("no bundled local harness sidecar found; local harness support stays disabled");
        }
        return None;
    };

    std::env::set_var("LOCAL_HARNESS_URL", &harness_url);
    std::env::set_var("AURA_HARNESS_BIN", &harness_binary);

    if probe_http_ok(&harness_url, "/health") {
        info!(url = %harness_url, binary = %harness_binary.display(), "local harness already reachable");
        return None;
    }

    let Some((host, port)) = parse_host_port(&harness_url) else {
        warn!(url = %harness_url, "invalid LOCAL_HARNESS_URL for sidecar launch");
        return None;
    };
    if !is_local_bind_host(&host) {
        info!(url = %harness_url, "configured LOCAL_HARNESS_URL is not local; skipping bundled sidecar launch");
        return None;
    }

    let listen_addr = format!("{host}:{port}");
    let harness_data_dir = data_dir.join("harness");
    if let Err(error) = std::fs::create_dir_all(&harness_data_dir) {
        warn!(%error, path = %harness_data_dir.display(), "failed to create harness data directory");
        return None;
    }

    let mut command = Command::new(&harness_binary);
    command
        .env("AURA_LISTEN_ADDR", &listen_addr)
        .env("AURA_DATA_DIR", &harness_data_dir);
    configure_background_child(&mut command, &harness_data_dir.join("sidecar.log"));

    if let Some(orbit_url) = env_string("ORBIT_URL").or_else(|| env_string("ORBIT_BASE_URL")) {
        command.env("ORBIT_URL", orbit_url);
    }

    let child = spawn_and_wait_for_health(command, &harness_url, &harness_binary);
    if child.is_none() {
        std::env::remove_var("AURA_HARNESS_BIN");
        if explicit_harness_url.is_none() {
            std::env::remove_var("LOCAL_HARNESS_URL");
        }
    }
    child
}

fn spawn_and_wait_for_health(
    mut command: Command,
    harness_url: &str,
    harness_binary: &Path,
) -> Option<Child> {
    match command.spawn() {
        Ok(child) => {
            let pid = child.id();
            if wait_for_harness_health(Duration::from_secs(10), Duration::from_millis(250), || {
                probe_http_ok(harness_url, "/health")
            }) {
                info!(pid, url = %harness_url, binary = %harness_binary.display(), "started managed local harness sidecar");
                return Some(child);
            }
            warn!(pid, url = %harness_url, binary = %harness_binary.display(), "managed local harness sidecar did not become healthy before timeout");
            stop_unhealthy_local_harness(child);
            None
        }
        Err(error) => {
            warn!(%error, binary = %harness_binary.display(), "failed to start managed local harness sidecar");
            None
        }
    }
}

fn wait_for_harness_health(
    timeout: Duration,
    poll_interval: Duration,
    mut probe: impl FnMut() -> bool,
) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if probe() {
            return true;
        }
        std::thread::sleep(poll_interval);
    }
    false
}

fn stop_unhealthy_local_harness(mut child: Child) {
    let pid = child.id();
    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => {
            if let Err(error) = child.kill() {
                warn!(%error, pid, "failed to stop unhealthy bundled local harness sidecar");
            }
            if let Err(error) = child.wait() {
                warn!(%error, pid, "failed to wait for unhealthy bundled local harness sidecar");
            }
        }
        Err(error) => {
            warn!(%error, pid, "failed to query unhealthy bundled local harness sidecar");
        }
    }
}

/// Configure a `Command` so it runs fully in the background: no console
/// window on Windows (the desktop app is a GUI-subsystem process and would
/// otherwise get a fresh console allocated for the console-subsystem child,
/// which is what used to pop up as a visible terminal next to the app) and
/// stdout/stderr redirected to a log file under the data directory rather
/// than inherited from a non-existent parent console.
pub(crate) fn configure_background_child(command: &mut Command, log_path: &Path) {
    command.stdin(Stdio::null());

    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path);

    match log_file.and_then(|file| file.try_clone().map(|clone| (file, clone))) {
        Ok((stdout_file, stderr_file)) => {
            command
                .stdout(Stdio::from(stdout_file))
                .stderr(Stdio::from(stderr_file));
        }
        Err(error) => {
            warn!(
                %error,
                path = %log_path.display(),
                "failed to open sidecar log file; discarding stdout/stderr"
            );
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub(crate) fn stop_managed_local_harness(managed_local_harness: &mut Option<Child>) {
    let Some(mut child) = managed_local_harness.take() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => {
            if let Err(error) = child.kill() {
                warn!(%error, pid = child.id(), "failed to stop bundled local harness sidecar");
            }
            let _ = child.wait();
        }
        Err(error) => {
            warn!(%error, pid = child.id(), "failed to query bundled local harness sidecar");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::wait_for_harness_health;
    use std::time::Duration;

    #[test]
    fn wait_for_harness_health_returns_true_when_probe_passes() {
        assert!(wait_for_harness_health(
            Duration::from_millis(10),
            Duration::ZERO,
            || true,
        ));
    }

    #[test]
    fn wait_for_harness_health_returns_false_after_deadline() {
        assert!(!wait_for_harness_health(
            Duration::ZERO,
            Duration::ZERO,
            || true,
        ));
    }
}
