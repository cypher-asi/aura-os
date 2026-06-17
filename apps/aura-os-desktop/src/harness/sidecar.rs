//! Lifecycle for the bundled `aura-node` sidecar process: spawn, wait
//! for `/health`, and stop on shutdown.

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tracing::{info, warn};

use crate::harness::binary::{
    inherited_managed_harness_binary_env, resolve_managed_harness_binary,
};
use crate::init::env::env_string;
use crate::net::probe::{is_local_bind_host, parse_host_port, probe_http_ok};

pub(crate) fn preferred_local_harness_port() -> u16 {
    aura_os_core::Channel::current().preferred_sidecar_port()
}

pub(crate) fn maybe_spawn_local_harness_sidecar(data_dir: &Path) -> Option<Child> {
    let explicit_harness_url =
        env_string("LOCAL_HARNESS_URL").map(|value| value.trim_end_matches('/').to_string());
    let inherited_managed_harness_env = inherited_managed_harness_binary_env(data_dir);
    let has_external_harness_url = external_harness_url_configured(
        explicit_harness_url.as_deref(),
        inherited_managed_harness_env,
    );
    let harness_binary = resolve_managed_harness_binary(data_dir);
    let harness_url = explicit_harness_url
        .clone()
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", preferred_local_harness_port()));

    if has_external_harness_url {
        let configured_url = explicit_harness_url
            .as_ref()
            .expect("external harness URL requires a configured URL");
        if probe_http_ok(configured_url, "/health") {
            info!(url = %configured_url, "local harness already reachable");
            return None;
        }
    }

    let Some(harness_binary) = harness_binary else {
        if has_external_harness_url {
            info!(url = %harness_url, "no managed local harness sidecar found; relying on configured external harness");
        } else {
            info!("no bundled local harness sidecar found; local harness support stays disabled");
        }
        return None;
    };

    std::env::set_var("LOCAL_HARNESS_URL", &harness_url);
    std::env::set_var("AURA_HARNESS_BIN", &harness_binary);

    stop_stale_managed_sidecar_if_needed(&harness_url, data_dir, &harness_binary);
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
        if !has_external_harness_url {
            std::env::remove_var("LOCAL_HARNESS_URL");
        }
    }
    child
}

fn external_harness_url_configured(
    configured_url: Option<&str>,
    inherited_managed_harness_env: bool,
) -> bool {
    configured_url.is_some() && !inherited_managed_harness_env
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

fn stop_stale_managed_sidecar_if_needed(
    harness_url: &str,
    data_dir: &Path,
    expected_binary: &Path,
) {
    let Some((host, port)) = parse_host_port(harness_url) else {
        return;
    };
    if !is_local_bind_host(&host) {
        return;
    }

    let managed_dir = data_dir.join("runtime/sidecar");
    for process in managed_sidecars_listening_on_port(port, &managed_dir, expected_binary) {
        match process.kind {
            ManagedSidecarKind::Current => {
                info!(
                    pid = process.pid,
                    binary = %expected_binary.display(),
                    "current managed local harness sidecar already owns the port"
                );
                return;
            }
            ManagedSidecarKind::Stale => {
                warn!(
                    pid = process.pid,
                    binary = %process.command_line,
                    expected = %expected_binary.display(),
                    "stopping stale managed local harness sidecar before launch"
                );
                terminate_stale_managed_sidecar(process.pid, harness_url);
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
// Variants are matched on every platform but only constructed by the
// Unix-only port-detection path (and the cross-platform tests).
#[cfg_attr(not(any(unix, test)), allow(dead_code))]
enum ManagedSidecarKind {
    Current,
    Stale,
}

#[derive(Debug, PartialEq, Eq)]
struct ManagedSidecarProcess {
    pid: u32,
    command_line: String,
    kind: ManagedSidecarKind,
}

#[cfg(any(unix, test))]
fn classify_managed_sidecar_command(
    command_line: &str,
    managed_dir: &Path,
    expected_binary: &Path,
) -> Option<ManagedSidecarKind> {
    let command_line = command_line
        .trim()
        .trim_start_matches('"')
        .trim_start_matches('\'');
    let managed_prefix = managed_dir.to_string_lossy();
    let expected_prefix = expected_binary.to_string_lossy();

    if command_line.starts_with(expected_prefix.as_ref()) {
        return Some(ManagedSidecarKind::Current);
    }
    if command_line.starts_with(managed_prefix.as_ref()) {
        return Some(ManagedSidecarKind::Stale);
    }
    None
}

#[cfg(unix)]
fn managed_sidecars_listening_on_port(
    port: u16,
    managed_dir: &Path,
    expected_binary: &Path,
) -> Vec<ManagedSidecarProcess> {
    pids_listening_on_tcp_port(port)
        .into_iter()
        .filter_map(|pid| {
            let command_line = command_line_for_pid(pid)?;
            let kind =
                classify_managed_sidecar_command(&command_line, managed_dir, expected_binary)?;
            Some(ManagedSidecarProcess {
                pid,
                command_line,
                kind,
            })
        })
        .collect()
}

#[cfg(not(unix))]
fn managed_sidecars_listening_on_port(
    _port: u16,
    _managed_dir: &Path,
    _expected_binary: &Path,
) -> Vec<ManagedSidecarProcess> {
    Vec::new()
}

#[cfg(unix)]
fn pids_listening_on_tcp_port(port: u16) -> Vec<u32> {
    let Ok(output) = Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_pid_lines(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(any(unix, test))]
fn parse_pid_lines(output: &str) -> Vec<u32> {
    output
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

#[cfg(unix)]
fn command_line_for_pid(pid: u32) -> Option<String> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let command_line = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!command_line.is_empty()).then_some(command_line)
}

#[cfg(unix)]
fn terminate_stale_managed_sidecar(pid: u32, harness_url: &str) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
    if wait_for_harness_health(Duration::from_secs(2), Duration::from_millis(100), || {
        !probe_http_ok(harness_url, "/health")
    }) {
        return;
    }

    warn!(
        pid,
        "stale managed local harness sidecar ignored TERM; forcing shutdown"
    );
    let _ = Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .status();
    let _ = wait_for_harness_health(Duration::from_secs(2), Duration::from_millis(100), || {
        !probe_http_ok(harness_url, "/health")
    });
}

#[cfg(not(unix))]
fn terminate_stale_managed_sidecar(_pid: u32, _harness_url: &str) {}

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
    use super::{
        classify_managed_sidecar_command, external_harness_url_configured, parse_pid_lines,
        wait_for_harness_health,
    };
    use std::path::Path;
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

    #[test]
    fn classify_managed_sidecar_command_detects_current_binary() {
        let managed_dir = Path::new("managed sidecar dir");
        let expected = managed_dir.join("aura-node-0.1.0-nightly.680.1-30458032-1781634098");
        let command_line = expected.to_string_lossy().to_string();

        assert_eq!(
            classify_managed_sidecar_command(&command_line, managed_dir, &expected),
            Some(super::ManagedSidecarKind::Current)
        );
    }

    #[test]
    fn classify_managed_sidecar_command_detects_stale_managed_binary() {
        let managed_dir = Path::new("managed sidecar dir");
        let expected = managed_dir.join("aura-node-0.1.0-nightly.680.1-30458032-1781634098");
        let stale = managed_dir
            .join("aura-node-0.1.0-nightly.632.1-30000000-1780000000")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            classify_managed_sidecar_command(&stale, managed_dir, &expected),
            Some(super::ManagedSidecarKind::Stale)
        );
    }

    #[test]
    fn classify_managed_sidecar_command_ignores_external_harnesses() {
        let managed_dir = Path::new("managed sidecar dir");
        let expected = managed_dir.join("aura-node-0.1.0-nightly.680.1-30458032-1781634098");

        assert_eq!(
            classify_managed_sidecar_command("/opt/aura-harness/aura-node", managed_dir, &expected),
            None
        );
    }

    #[test]
    fn parse_pid_lines_ignores_non_pid_lines() {
        assert_eq!(parse_pid_lines("123\nnot-a-pid\n456\n"), vec![123, 456]);
    }

    #[test]
    fn inherited_managed_env_does_not_make_local_harness_url_external() {
        let configured_url = Some("http://127.0.0.1:19080".to_string());

        assert!(external_harness_url_configured(
            configured_url.as_deref(),
            false
        ));
        assert!(!external_harness_url_configured(
            configured_url.as_deref(),
            true
        ));
        assert!(!external_harness_url_configured(None, false));
    }
}
