use std::path::Path;
use std::process::Command;

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

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let frontend_dir = Path::new(&manifest_dir).join("../../frontend");
    let dist_dir = frontend_dir.join("dist");

    if !frontend_dir.join("package.json").exists() {
        eprintln!(
            "error: frontend directory not found at {}",
            frontend_dir.display()
        );
        std::process::exit(1);
    }

    let use_prebuilt_frontend = std::env::var("AURA_DESKTOP_USE_PREBUILT_FRONTEND")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"));

    if use_prebuilt_frontend {
        assert!(
            dist_dir.join("index.html").exists(),
            "AURA_DESKTOP_USE_PREBUILT_FRONTEND=1 was set but frontend/dist/index.html is missing"
        );
    } else {
        if !frontend_dir.join("node_modules").exists() {
            let status = npm()
                .arg("install")
                .current_dir(&frontend_dir)
                .status()
                .expect("failed to run npm install — is Node.js installed?");

            assert!(status.success(), "npm install failed");
        }

        let status = npm()
            .args(["run", "build"])
            .current_dir(&frontend_dir)
            .status()
            .expect("failed to run npm run build — is Node.js installed?");

        assert!(status.success(), "npm run build failed");
    }

    watch_dir(&frontend_dir.join("src"));
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("index.html").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("vite.config.ts").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("tsconfig.json").display()
    );

    println!("cargo:rustc-env=FRONTEND_DIST_DIR={}", dist_dir.display());

    // Updater signing public key – set via env var during CI, fall back to a
    // dev placeholder so local `cargo build` still succeeds.
    let pub_key = std::env::var("UPDATER_PUBLIC_KEY")
        .unwrap_or_else(|_| "NOT_SET__generate_with_cargo_packager_signer_generate".into());
    println!("cargo:rustc-env=UPDATER_PUBLIC_KEY={pub_key}");
    println!("cargo:rerun-if-env-changed=UPDATER_PUBLIC_KEY");

    let update_base_url = std::env::var("AURA_UPDATE_BASE_URL")
        .unwrap_or_else(|_| "https://n3o.github.io/aura-app".into());
    println!("cargo:rustc-env=AURA_UPDATE_BASE_URL={update_base_url}");
    println!("cargo:rerun-if-env-changed=AURA_UPDATE_BASE_URL");
    println!("cargo:rerun-if-env-changed=AURA_DESKTOP_USE_PREBUILT_FRONTEND");
}
