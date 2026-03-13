use std::sync::Arc;

use aura_core::ApiKeyStatus;
use aura_settings::{KeyEncryption, SettingsService};
use aura_store::RocksStore;
use tempfile::TempDir;

fn setup() -> (Arc<RocksStore>, TempDir) {
    let dir = TempDir::new().expect("temp dir");
    let store = RocksStore::open(dir.path()).expect("open store");
    (Arc::new(store), dir)
}

// ---------------------------------------------------------------------------
// Encryption round-trip
// ---------------------------------------------------------------------------

#[test]
fn encrypt_decrypt_round_trip() {
    let dir = TempDir::new().unwrap();
    let enc = KeyEncryption::init(dir.path()).unwrap();

    let plaintext = b"sk-ant-api03-secret-key-value";
    let blob = enc.encrypt(plaintext).unwrap();
    let decrypted = enc.decrypt(&blob).unwrap();

    assert_eq!(decrypted, plaintext);
}

#[test]
fn different_encryptions_produce_different_ciphertexts() {
    let dir = TempDir::new().unwrap();
    let enc = KeyEncryption::init(dir.path()).unwrap();

    let plaintext = b"same-plaintext-value";
    let blob1 = enc.encrypt(plaintext).unwrap();
    let blob2 = enc.encrypt(plaintext).unwrap();

    assert_ne!(blob1.nonce, blob2.nonce);
    assert_ne!(blob1.ciphertext, blob2.ciphertext);
}

// ---------------------------------------------------------------------------
// Keyfile persistence across reopen
// ---------------------------------------------------------------------------

#[test]
fn keyfile_persists_across_reopen() {
    let dir = TempDir::new().unwrap();
    let plaintext = b"persistent-secret";

    let blob = {
        let enc = KeyEncryption::init(dir.path()).unwrap();
        enc.encrypt(plaintext).unwrap()
    };

    // Reopen with same data_dir -> same key -> can decrypt
    let enc2 = KeyEncryption::init(dir.path()).unwrap();
    let decrypted = enc2.decrypt(&blob).unwrap();
    assert_eq!(decrypted, plaintext);
}

// ---------------------------------------------------------------------------
// Settings service — API key lifecycle
// ---------------------------------------------------------------------------

#[test]
fn set_and_get_api_key_info() {
    let (store, dir) = setup();
    let svc = SettingsService::new(store, dir.path()).unwrap();

    let info = svc.set_api_key("sk-ant-api03-abcdefghijklmnop").unwrap();
    assert_eq!(info.status, ApiKeyStatus::ValidationPending);
    assert!(info.masked_key.is_some());
    assert!(info.masked_key.as_ref().unwrap().contains("..."));

    let fetched = svc.get_api_key_info().unwrap();
    assert_eq!(fetched.status, ApiKeyStatus::ValidationPending);
    assert!(fetched.masked_key.is_some());
}

#[test]
fn decrypt_api_key_returns_original() {
    let (store, dir) = setup();
    let svc = SettingsService::new(store, dir.path()).unwrap();
    let key = "sk-ant-api03-mysecretkey12345";

    svc.set_api_key(key).unwrap();
    let decrypted = svc.get_decrypted_api_key().unwrap();
    assert_eq!(decrypted, key);
}

#[test]
fn delete_api_key_results_in_not_set() {
    let (store, dir) = setup();
    let svc = SettingsService::new(store, dir.path()).unwrap();

    svc.set_api_key("sk-ant-secret").unwrap();
    svc.delete_api_key().unwrap();

    let info = svc.get_api_key_info().unwrap();
    assert_eq!(info.status, ApiKeyStatus::NotSet);
    assert!(info.masked_key.is_none());
}

#[test]
fn get_api_key_info_when_not_set() {
    let (store, dir) = setup();
    let svc = SettingsService::new(store, dir.path()).unwrap();

    let info = svc.get_api_key_info().unwrap();
    assert_eq!(info.status, ApiKeyStatus::NotSet);
    assert!(info.masked_key.is_none());
}

#[test]
fn update_api_key_status() {
    let (store, dir) = setup();
    let svc = SettingsService::new(store, dir.path()).unwrap();

    svc.set_api_key("sk-test-key-value-123").unwrap();
    svc.update_api_key_status(ApiKeyStatus::Valid).unwrap();

    let info = svc.get_api_key_info().unwrap();
    assert_eq!(info.status, ApiKeyStatus::Valid);
    assert!(info.last_validated_at.is_some());
}

// ---------------------------------------------------------------------------
// Plain-text settings
// ---------------------------------------------------------------------------

#[test]
fn plain_text_settings_round_trip() {
    let (store, dir) = setup();
    let svc = SettingsService::new(store, dir.path()).unwrap();

    svc.set_setting("theme", "dark").unwrap();
    let val = svc.get_setting("theme").unwrap();
    assert_eq!(val, Some("dark".to_string()));
}

#[test]
fn missing_setting_returns_none() {
    let (store, dir) = setup();
    let svc = SettingsService::new(store, dir.path()).unwrap();

    let val = svc.get_setting("nonexistent").unwrap();
    assert_eq!(val, None);
}
