use super::*;
use tempfile::tempdir;

fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

fn detected(u: &str, source: DetectionSource) -> DetectedUrl {
    DetectedUrl {
        url: url(u),
        source,
        at: Utc::now(),
    }
}

#[tokio::test]
async fn missing_file_reads_as_default() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let project = ProjectId::new();
    let settings = store.read_project(&project).await;
    assert_eq!(settings, ProjectBrowserSettings::default());
}

#[tokio::test]
async fn patch_pinned_url_round_trips() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let project = ProjectId::new();
    let patch = SettingsPatch {
        pinned_url: Some(Some(url("http://localhost:5173"))),
        ..SettingsPatch::default()
    };
    let updated = store.patch_project(&project, patch).await.unwrap();
    assert_eq!(updated.pinned_url, Some(url("http://localhost:5173")));

    let reloaded = store.read_project(&project).await;
    assert_eq!(reloaded.pinned_url, Some(url("http://localhost:5173")));
}

#[tokio::test]
async fn patch_clear_pinned_url() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let project = ProjectId::new();
    store
        .patch_project(
            &project,
            SettingsPatch {
                pinned_url: Some(Some(url("http://localhost:5173"))),
                ..SettingsPatch::default()
            },
        )
        .await
        .unwrap();
    let cleared = store
        .patch_project(
            &project,
            SettingsPatch {
                pinned_url: Some(None),
                ..SettingsPatch::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(cleared.pinned_url, None);
}

#[tokio::test]
async fn record_detected_dedups_and_caps() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let project = ProjectId::new();
    for port in 3000..3000 + (DETECTED_URLS_CAP as u16) + 3 {
        store
            .record_detected(
                Some(&project),
                detected(
                    &format!("http://localhost:{port}"),
                    DetectionSource::Terminal,
                ),
            )
            .await
            .unwrap();
    }
    store
        .record_detected(
            Some(&project),
            detected("http://localhost:3000", DetectionSource::Probe),
        )
        .await
        .unwrap();
    let settings = store.read_project(&project).await;
    assert_eq!(settings.detected_urls.len(), DETECTED_URLS_CAP);
    assert_eq!(settings.detected_urls[0].url, url("http://localhost:3000"));
    assert_eq!(settings.detected_urls[0].source, DetectionSource::Probe);
}

#[tokio::test]
async fn record_visit_sets_last_url_and_history() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let project = ProjectId::new();
    store
        .record_visit(
            Some(&project),
            url("http://localhost:5173"),
            Some("Vite".into()),
        )
        .await
        .unwrap();
    store
        .record_visit(Some(&project), url("http://localhost:5173/about"), None)
        .await
        .unwrap();
    let settings = store.read_project(&project).await;
    assert_eq!(settings.last_url, Some(url("http://localhost:5173/about")));
    assert_eq!(settings.history.len(), 2);
    assert_eq!(settings.history[0].url, url("http://localhost:5173/about"));
}

#[tokio::test]
async fn corrupt_file_is_treated_as_empty() {
    let dir = tempdir().unwrap();
    let project = ProjectId::new();
    let path = dir.path().join("projects").join(format!("{project}.json"));
    tokio::fs::create_dir_all(path.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::write(&path, b"not json").await.unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let settings = store.read_project(&project).await;
    assert_eq!(settings, ProjectBrowserSettings::default());
}

#[tokio::test]
async fn clear_flags_reset_collections() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new(dir.path().to_path_buf());
    let project = ProjectId::new();
    store
        .record_visit(Some(&project), url("http://localhost:5173"), None)
        .await
        .unwrap();
    store
        .record_detected(
            Some(&project),
            detected("http://localhost:3000", DetectionSource::Terminal),
        )
        .await
        .unwrap();
    let cleared = store
        .patch_project(
            &project,
            SettingsPatch {
                clear_detected: true,
                clear_history: true,
                ..SettingsPatch::default()
            },
        )
        .await
        .unwrap();
    assert!(cleared.history.is_empty());
    assert!(cleared.detected_urls.is_empty());
}
