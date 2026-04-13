use std::io::{Read, Write};
use std::net::ToSocketAddrs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const DEFAULT_FRONTEND_DEV_URL: &str = "http://127.0.0.1:5173";

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

    let pub_key = std::env::var("UPDATER_PUBLIC_KEY")
        .unwrap_or_else(|_| "NOT_SET__generate_with_cargo_packager_signer_generate".into());
    println!("cargo:rustc-env=UPDATER_PUBLIC_KEY={pub_key}");
    println!("cargo:rerun-if-env-changed=UPDATER_PUBLIC_KEY");

    let update_base_url = std::env::var("AURA_UPDATE_BASE_URL")
        .unwrap_or_else(|_| "https://n3o.github.io/aura-app".into());
    println!("cargo:rustc-env=AURA_UPDATE_BASE_URL={update_base_url}");
    println!("cargo:rerun-if-env-changed=AURA_UPDATE_BASE_URL");
    println!("cargo:rerun-if-env-changed=AURA_DESKTOP_USE_PREBUILT_FRONTEND");
    println!("cargo:rerun-if-env-changed=AURA_DESKTOP_FRONTEND_DEV_URL");
    println!("cargo:rerun-if-env-changed=AURA_DESKTOP_DISABLE_FRONTEND_DEV_SERVER");
}
