use std::io::{Read, Write};
use std::net::ToSocketAddrs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const DEFAULT_FRONTEND_DEV_URL: &str = "http://127.0.0.1:5173";
const DEFAULT_AURA_NETWORK_URL: &str = "https://aura-network.onrender.com";
const DEFAULT_AURA_STORAGE_URL: &str = "https://aura-storage.onrender.com";
const DEFAULT_AURA_INTEGRATIONS_URL: &str = "https://aura-integrations.onrender.com";
const DEFAULT_AURA_ROUTER_URL: &str = "https://aura-router.onrender.com";
const DEFAULT_Z_BILLING_URL: &str = "https://z-billing.onrender.com";
const DEFAULT_ORBIT_BASE_URL: &str = "https://orbit-sfvu.onrender.com";
const DEFAULT_SWARM_BASE_URL: &str =
    "http://ab6d2375031e74ce1976fdf62ea951a4-e757483aaffba396.elb.us-east-2.amazonaws.com";
const DEFAULT_REQUIRE_ZERO_PRO: &str = "true";
const DEFAULT_DISABLE_LOCAL_HARNESS_AUTOSPAWN: &str = "true";

fn npm() -> Command {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "npm"]);
        cmd
    } else {
        Command::new("npm")
    }
}

fn watch_dir(dir: &Path) {
    for entry in std::fs::read_dir(dir).expect("failed to read directory") {
        let entry = entry.expect("failed to read entry");
        let path = entry.path();
        if path.is_dir() {
            watch_dir(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

fn configured_frontend_dev_url() -> Option<String> {
    std::env::var("AURA_DESKTOP_FRONTEND_DEV_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn should_try_frontend_dev_server() -> bool {
    std::env::var("PROFILE")
        .map(|value| value == "debug")
        .unwrap_or(false)
        && !env_flag_enabled("AURA_DESKTOP_DISABLE_FRONTEND_DEV_SERVER")
}

fn emit_runtime_default(runtime_name: &str, compile_name: &str, fallback: &str) {
    let value = std::env::var(runtime_name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string());
    println!("cargo:rustc-env={compile_name}={value}");
    println!("cargo:rerun-if-env-changed={runtime_name}");
}

fn env_value_or_default(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn probe_vite_dev_server(base_url: &str) -> bool {
    let trimmed = base_url.trim().trim_end_matches('/');
    let (scheme, remainder) = if let Some(rest) = trimmed.strip_prefix("https://") {
        ("https", rest)
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        ("http", rest)
    } else {
        return false;
    };

    let (host_port, base_path) = match remainder.split_once('/') {
        Some((host_port, path)) => (host_port, format!("/{}", path.trim_start_matches('/'))),
        None => (remainder, String::new()),
    };
    if host_port.is_empty() {
        return false;
    }

    let default_port = if scheme == "https" { 443 } else { 80 };
    let addr_target = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{host_port}:{default_port}")
    };
    let Some(addr) = addr_target
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
    else {
        return false;
    };
    let path = if base_path.is_empty() {
        "/@vite/client".to_string()
    } else {
        format!("{}/@vite/client", base_path.trim_end_matches('/'))
    };

    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(250))
    else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));

    if write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {host_port}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }

    let mut buf = [0_u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    if n == 0 {
        return false;
    }

    let response = String::from_utf8_lossy(&buf[..n]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let interface_dir = Path::new(&manifest_dir).join("../../interface");
    let dist_dir = interface_dir.join("dist");

    if !interface_dir.join("package.json").exists() {
        eprintln!(
            "error: interface directory not found at {}",
            interface_dir.display()
        );
        std::process::exit(1);
    }

    let use_prebuilt_interface = std::env::var("AURA_DESKTOP_USE_PREBUILT_FRONTEND")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"));
    let use_frontend_dev_server = should_try_frontend_dev_server()
        && probe_vite_dev_server(
            &configured_frontend_dev_url().unwrap_or_else(|| DEFAULT_FRONTEND_DEV_URL.to_string()),
        );

    if use_prebuilt_interface {
        assert!(
            dist_dir.join("index.html").exists(),
            "AURA_DESKTOP_USE_PREBUILT_FRONTEND=1 was set but interface/dist/index.html is missing"
        );
    } else if use_frontend_dev_server {
        println!("cargo:warning=Vite frontend dev server detected; skipping npm run build");
    } else {
        if !interface_dir.join("node_modules").exists() {
            let status = npm()
                .arg("install")
                .current_dir(&interface_dir)
                .status()
                .expect("failed to run npm install — is Node.js installed?");

            assert!(status.success(), "npm install failed");
        }

        let status = npm()
            .args(["run", "build"])
            .current_dir(&interface_dir)
            .status()
            .expect("failed to run npm run build — is Node.js installed?");

        assert!(status.success(), "npm run build failed");
    }

    // Only watch interface source files when building dist from source.
    // When the Vite dev server is active, HMR handles live updates and
    // watching these files would only trigger unnecessary Cargo rebuilds
    // that restart the desktop shell (killing the live session).
    if !use_frontend_dev_server && !use_prebuilt_interface {
        watch_dir(&interface_dir.join("src"));
        println!(
            "cargo:rerun-if-changed={}",
            interface_dir.join("index.html").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            interface_dir.join("package.json").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            interface_dir.join("vite.config.ts").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            interface_dir.join("tsconfig.json").display()
        );
    }

    println!("cargo:rustc-env=INTERFACE_DIST_DIR={}", dist_dir.display());

    let pub_key = env_value_or_default(
        "UPDATER_PUBLIC_KEY",
        "NOT_SET__generate_with_cargo_packager_signer_generate",
    );
    println!("cargo:rustc-env=UPDATER_PUBLIC_KEY={pub_key}");
    println!("cargo:rerun-if-env-changed=UPDATER_PUBLIC_KEY");

    let update_base_url =
        env_value_or_default("AURA_UPDATE_BASE_URL", "https://n3o.github.io/aura-app");
    println!("cargo:rustc-env=AURA_UPDATE_BASE_URL={update_base_url}");
    println!("cargo:rerun-if-env-changed=AURA_UPDATE_BASE_URL");
    emit_runtime_default(
        "AURA_NETWORK_URL",
        "AURA_DESKTOP_DEFAULT_AURA_NETWORK_URL",
        DEFAULT_AURA_NETWORK_URL,
    );
    emit_runtime_default(
        "AURA_STORAGE_URL",
        "AURA_DESKTOP_DEFAULT_AURA_STORAGE_URL",
        DEFAULT_AURA_STORAGE_URL,
    );
    emit_runtime_default(
        "AURA_INTEGRATIONS_URL",
        "AURA_DESKTOP_DEFAULT_AURA_INTEGRATIONS_URL",
        DEFAULT_AURA_INTEGRATIONS_URL,
    );
    emit_runtime_default(
        "AURA_ROUTER_URL",
        "AURA_DESKTOP_DEFAULT_AURA_ROUTER_URL",
        DEFAULT_AURA_ROUTER_URL,
    );
    emit_runtime_default(
        "Z_BILLING_URL",
        "AURA_DESKTOP_DEFAULT_Z_BILLING_URL",
        DEFAULT_Z_BILLING_URL,
    );
    emit_runtime_default(
        "ORBIT_BASE_URL",
        "AURA_DESKTOP_DEFAULT_ORBIT_BASE_URL",
        DEFAULT_ORBIT_BASE_URL,
    );
    emit_runtime_default(
        "SWARM_BASE_URL",
        "AURA_DESKTOP_DEFAULT_SWARM_BASE_URL",
        DEFAULT_SWARM_BASE_URL,
    );
    emit_runtime_default(
        "REQUIRE_ZERO_PRO",
        "AURA_DESKTOP_DEFAULT_REQUIRE_ZERO_PRO",
        DEFAULT_REQUIRE_ZERO_PRO,
    );
    emit_runtime_default(
        "AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN",
        "AURA_DESKTOP_DEFAULT_DISABLE_LOCAL_HARNESS_AUTOSPAWN",
        DEFAULT_DISABLE_LOCAL_HARNESS_AUTOSPAWN,
    );
    println!("cargo:rerun-if-env-changed=AURA_DESKTOP_USE_PREBUILT_FRONTEND");
    println!("cargo:rerun-if-env-changed=AURA_DESKTOP_FRONTEND_DEV_URL");
    println!("cargo:rerun-if-env-changed=AURA_DESKTOP_DISABLE_FRONTEND_DEV_SERVER");
}
