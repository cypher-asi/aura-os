use aura_store::*;
use tempfile::TempDir;

fn open_temp_store() -> (RocksStore, TempDir) {
    let dir = TempDir::new().expect("failed to create temp dir");
    let store = RocksStore::open(dir.path()).expect("failed to open store");
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
            cf: ColumnFamilyName::Settings,
            key: "key_a".to_string(),
            value: b"value_a".to_vec(),
        },
        BatchOp::Put {
            cf: ColumnFamilyName::Settings,
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
