use std::path::Path as FsPath;

use aura_core::ProjectId;
use aura_tasks::ProjectProgress;

use crate::state::AppState;

pub(crate) async fn aggregate_repo_metrics(
    state: &AppState,
    project_id: &ProjectId,
    progress: &mut ProjectProgress,
) {
    let Ok(project) = state.project_service.get_project_async(project_id).await else {
        return;
    };
    let folder = &project.linked_folder_path;
    if FsPath::new(folder).is_dir() {
        progress.lines_of_code = count_lines_of_code(folder).await;
        progress.total_commits = count_git_commits(folder).await;
        progress.total_tests = count_tests(folder).await;
    }
}

async fn count_lines_of_code(folder: &str) -> u64 {
    tokio::task::spawn_blocking({
        let folder = folder.to_string();
        move || count_loc_sync(&folder)
    })
    .await
    .unwrap_or(0)
}

fn count_loc_sync(folder: &str) -> u64 {
    use std::fs;

    const SKIP: &[&str] = &[
        ".git",
        "target",
        "node_modules",
        "__pycache__",
        ".venv",
        "dist",
        "build",
    ];
    const EXTS: &[&str] = &[
        "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "css", "html", "sql", "sh", "yaml",
        "yml", "toml", "json", "md",
    ];

    fn walk(dir: &FsPath, total: &mut u64) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !SKIP.contains(&name.as_str()) {
                    walk(&path, total);
                }
            } else if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or_default();
                if EXTS.contains(&ext) {
                    if let Ok(content) = fs::read_to_string(&path) {
                        *total += content.lines().count() as u64;
                    }
                }
            }
        }
    }

    let mut total = 0u64;
    walk(FsPath::new(folder), &mut total);
    total
}

async fn count_tests(folder: &str) -> u64 {
    tokio::task::spawn_blocking({
        let folder = folder.to_string();
        move || count_tests_sync(&folder)
    })
    .await
    .unwrap_or(0)
}

fn count_tests_sync(folder: &str) -> u64 {
    use std::fs;

    const SKIP: &[&str] = &[
        ".git", "target", "node_modules", "__pycache__", ".venv", "dist", "build",
    ];

    fn walk(dir: &FsPath, total: &mut u64) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !SKIP.contains(&name.as_str()) {
                    walk(&path, total);
                }
            } else if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default();
                if let Ok(content) = fs::read_to_string(&path) {
                    *total += count_tests_in_file(ext, &name, &content);
                }
            }
        }
    }

    let mut total = 0u64;
    walk(FsPath::new(folder), &mut total);
    total
}

fn count_tests_in_file(ext: &str, name: &str, content: &str) -> u64 {
    match ext {
        "rs" => {
            (content.matches("#[test]").count() + content.matches("#[tokio::test]").count()) as u64
        }
        "ts" | "tsx" | "js" | "jsx" if name.contains(".test.") || name.contains(".spec.") => {
            content
                .lines()
                .filter(|line| {
                    let t = line.trim_start();
                    t.starts_with("it(")
                        || t.starts_with("it.only(")
                        || t.starts_with("test(")
                        || t.starts_with("test.only(")
                })
                .count() as u64
        }
        "py" => content
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                t.starts_with("def test_") || t.starts_with("async def test_")
            })
            .count() as u64,
        _ => 0,
    }
}

async fn count_git_commits(folder: &str) -> u64 {
    let output = tokio::process::Command::new("git")
        .args(["rev-list", "--count", "HEAD"])
        .current_dir(folder)
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .trim()
            .parse::<u64>()
            .unwrap_or(0),
        _ => 0,
    }
}
