use std::sync::Arc;

use aura_settings::SettingsService;
use aura_store::RocksStore;
use tempfile::TempDir;

fn setup() -> (Arc<RocksStore>, TempDir) {
    let dir = TempDir::new().expect("temp dir");
    let store = RocksStore::open(dir.path()).expect("open store");
    (Arc::new(store), dir)
}

#[test]
fn plain_text_settings_round_trip() {
    let (store, _dir) = setup();
    let svc = SettingsService::new(store);

    svc.set_setting("theme", "dark").unwrap();
    let val = svc.get_setting("theme").unwrap();
    assert_eq!(val, Some("dark".to_string()));
}

#[test]
fn missing_setting_returns_none() {
    let (store, _dir) = setup();
    let svc = SettingsService::new(store);

    let val = svc.get_setting("nonexistent").unwrap();
    assert_eq!(val, None);
}

#[test]
fn api_key_from_env() {
    let (store, _dir) = setup();
    let svc = SettingsService::new(store);

    std::env::remove_var("ANTHROPIC_API_KEY");
    assert!(!svc.has_api_key());
    let info = svc.get_api_key_info().unwrap();
    assert!(!info.configured);
    assert!(svc.get_decrypted_api_key().is_err());

    std::env::set_var("ANTHROPIC_API_KEY", "sk-test-key");
    assert!(svc.has_api_key());
    let info = svc.get_api_key_info().unwrap();
    assert!(info.configured);
    assert_eq!(svc.get_decrypted_api_key().unwrap(), "sk-test-key");

    std::env::remove_var("ANTHROPIC_API_KEY");
}
