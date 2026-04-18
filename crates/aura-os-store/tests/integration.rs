use aura_os_store::*;
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
