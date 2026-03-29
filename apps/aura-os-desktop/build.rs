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
    let interface_dir = Path::new(&manifest_dir).join("../../interface");
    let dist_dir = interface_dir.join("dist");

    if !interface_dir.join("package.json").exists() {
        eprintln!(
            "error: interface directory not found at {}",
            interface_dir.display()
        );
        std::process::exit(1);
    }

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

    println!("cargo:rustc-env=INTERFACE_DIST_DIR={}", dist_dir.display());

    // Updater signing public key – set via env var during CI, fall back to a
    // dev placeholder so local `cargo build` still succeeds.
    let pub_key = std::env::var("UPDATER_PUBLIC_KEY")
        .unwrap_or_else(|_| "NOT_SET__generate_with_cargo_packager_signer_generate".into());
    println!("cargo:rustc-env=UPDATER_PUBLIC_KEY={pub_key}");
    println!("cargo:rerun-if-env-changed=UPDATER_PUBLIC_KEY");
}
