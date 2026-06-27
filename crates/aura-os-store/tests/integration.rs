use aura_os_store::*;
use chrono::Utc;
use tempfile::TempDir;

fn open_temp_store() -> (SettingsStore, TempDir) {
    let dir = TempDir::new().expect("failed to create temp dir");
    let store = SettingsStore::open(dir.path()).expect("failed to open store");
    (store, dir)
}

// ---------------------------------------------------------------------------
// Settings CRUD (only CF kept after migration to remote-only projects, orgs, agents, messages)
// ---------------------------------------------------------------------------

#[test]
fn settings_crud_round_trip() {
    let (store, _dir) = open_temp_store();

    store
        .put_setting("claude_api_key", b"sk-secret-123")
        .unwrap();
    let val = store.get_setting("claude_api_key").unwrap();
    assert_eq!(val, b"sk-secret-123");

    store.delete_setting("claude_api_key").unwrap();
    let result = store.get_setting("claude_api_key");
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

// ---------------------------------------------------------------------------
// Batch writes (settings only)
// ---------------------------------------------------------------------------

#[test]
fn batch_write_is_atomic() {
    let (store, _dir) = open_temp_store();

    let ops = vec![
        BatchOp::Put {
            cf: "settings".to_string(),
            key: "key_a".to_string(),
            value: b"value_a".to_vec(),
        },
        BatchOp::Put {
            cf: "settings".to_string(),
            key: "key_b".to_string(),
            value: b"value_b".to_vec(),
        },
    ];

    store.write_batch(ops).unwrap();

    let a = store.get_setting("key_a").unwrap();
    assert_eq!(a, b"value_a");
    let b = store.get_setting("key_b").unwrap();
    assert_eq!(b, b"value_b");
}

// ---------------------------------------------------------------------------
// Not-found error
// ---------------------------------------------------------------------------

#[test]
fn get_missing_setting_returns_not_found() {
    let (store, _dir) = open_temp_store();
    let result = store.get_setting("nonexistent");
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

#[test]
fn open_rejects_parent_directory_segments() {
    let dir = TempDir::new().expect("failed to create temp dir");
    let bad_path = dir.path().join("..").join("outside-store");

    let err = match SettingsStore::open(&bad_path) {
        Ok(_) => panic!("parent segments must be rejected"),
        Err(err) => err,
    };

    assert!(matches!(err, StoreError::Io(_)));
}

#[test]
fn unknown_column_family_is_rejected() {
    let (store, _dir) = open_temp_store();
    let err = store
        .put_cf_bytes("../settings", b"key", b"value")
        .expect_err("unknown column family must be rejected");

    assert!(matches!(err, StoreError::NotFound(_)));
}

#[test]
fn list_settings_with_prefix_returns_org_integration_keys() {
    let (store, _dir) = open_temp_store();

    let key_a = "org_integration:897c5e55-f80a-4b1d-948f-18a5723d3a28:alpha";
    let key_b = "org_integration:897c5e55-f80a-4b1d-948f-18a5723d3a28:beta";
    let other = "org_integration:f8b1ca16-7557-4214-b828-ac024162527e:gamma";

    store.put_setting(key_a, b"a").unwrap();
    store.put_setting(key_b, b"b").unwrap();
    store.put_setting(other, b"c").unwrap();

    let values = store
        .list_settings_with_prefix("org_integration:897c5e55-f80a-4b1d-948f-18a5723d3a28:")
        .unwrap();

    let keys: Vec<String> = values.into_iter().map(|(key, _)| key).collect();
    assert_eq!(keys, vec![key_a.to_string(), key_b.to_string()]);
}

// ---------------------------------------------------------------------------
// Self-healing on torn / corrupt store files
// ---------------------------------------------------------------------------
//
// These cover the failure mode that took the Windows desktop app down
// silently: a previous crash left `settings.json` the right size but
// full of NUL bytes (or otherwise unparseable), and the next launch
// panicked the embedded server thread on `serde_json::from_str`. The
// store now ignores the bad file while loading and starts with an empty CF so
// the app can boot. The next successful write replaces the bad file.

#[test]
fn open_ignores_all_zero_settings_file_and_next_write_replaces_it() {
    let dir = TempDir::new().expect("failed to create temp dir");
    // Pre-stage a 1KiB all-NUL `settings.json`, the exact shape the
    // real Windows install left on disk after a torn write.
    std::fs::write(dir.path().join("settings.json"), vec![0u8; 1024])
        .expect("failed to stage corrupt settings.json");

    let store = SettingsStore::open(dir.path()).expect("open must self-heal corrupt cf file");

    // The store is usable: writes go through and round-trip cleanly.
    store.put_setting("k", b"v").expect("put after self-heal");
    assert_eq!(store.get_setting("k").expect("get after self-heal"), b"v");
    drop(store);

    let reopened = SettingsStore::open(dir.path()).expect("reopen after self-heal write");
    assert_eq!(reopened.get_setting("k").expect("get after reopen"), b"v");
}

#[test]
fn open_ignores_garbage_json_settings_file_and_next_write_replaces_it() {
    let dir = TempDir::new().expect("failed to create temp dir");
    std::fs::write(dir.path().join("settings.json"), b"not json {")
        .expect("failed to stage garbage settings.json");

    let store = SettingsStore::open(dir.path()).expect("open must self-heal garbage cf file");

    store.put_setting("k", b"v").expect("put after self-heal");
    assert_eq!(store.get_setting("k").expect("get after self-heal"), b"v");
    drop(store);

    let reopened = SettingsStore::open(dir.path()).expect("reopen after self-heal write");
    assert_eq!(reopened.get_setting("k").expect("get after reopen"), b"v");
}

#[test]
fn zero_auth_session_persists_across_store_reopen() {
    let dir = TempDir::new().expect("failed to create temp dir");
    let session = aura_os_core::ZeroAuthSession {
        user_id: "u1".into(),
        network_user_id: None,
        profile_id: None,
        display_name: "Test User".into(),
        profile_image: String::new(),
        primary_zid: "0://test".into(),
        zero_wallet: "0x0".into(),
        wallets: vec!["0x0".into()],
        access_token: "persisted-jwt".into(),
        is_zero_pro: true,
        is_access_granted: true,
        is_sys_admin: false,
        created_at: Utc::now(),
        validated_at: Utc::now(),
    };

    let store = SettingsStore::open(dir.path()).expect("failed to open store");
    store
        .put_setting(
            "zero_auth_session",
            &serde_json::to_vec(&session).expect("failed to encode session"),
        )
        .expect("failed to persist session");
    drop(store);

    let reopened = SettingsStore::open(dir.path()).expect("failed to reopen store");
    let restored = reopened
        .get_cached_zero_auth_session()
        .expect("session should survive reopen");
    assert_eq!(restored.access_token, session.access_token);
    assert_eq!(restored.user_id, session.user_id);

    reopened
        .delete_setting("zero_auth_session")
        .expect("failed to delete session");
    drop(reopened);

    let empty = SettingsStore::open(dir.path()).expect("failed to reopen empty store");
    assert!(empty.get_cached_zero_auth_session().is_none());
    assert!(matches!(
        empty.get_setting("zero_auth_session"),
        Err(StoreError::NotFound(_))
    ));
}
