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

fn main() {
    let frontend_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend");
    let dist_dir = frontend_dir.join("dist");

    if !frontend_dir.join("package.json").exists() {
        panic!(
            "frontend directory not found at {}",
            frontend_dir.display()
        );
    }

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

    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("src").display()
    );
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
}
