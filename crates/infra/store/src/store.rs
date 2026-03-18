use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rocksdb::{ColumnFamilyDescriptor, DBWithThreadMode, MultiThreaded, Options, WriteBatch};
use serde::de::DeserializeOwned;

use crate::batch::BatchOp;
use crate::error::StoreResult;

pub(crate) const CF_NAMES: &[&str] = &[
    "projects",
    "specs",
    "tasks",
    "agents",
    "agent_instances",
    "sessions",
    "settings",
    "messages",
    "orgs",
    "log_entries",
];

pub(crate) type RocksDB = DBWithThreadMode<MultiThreaded>;

pub struct RocksStore {
    pub(crate) db: Arc<RocksDB>,
    /// Serializes all read-modify-write cycles on task records to prevent
    /// concurrent clobbering between engine step persistence and server
    /// live_output flushes.
    pub(crate) task_write_lock: Mutex<()>,
}

impl RocksStore {
    pub fn open(path: &Path) -> StoreResult<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        let desired: HashSet<&str> = CF_NAMES.iter().copied().collect();

        // Discover CFs already on disk so we can open them (RocksDB requires it)
        // and then drop any that are no longer in our schema.
        let on_disk: Vec<String> = RocksDB::list_cf(&opts, path).unwrap_or_default();
        let stale: Vec<String> = on_disk
            .iter()
            .filter(|name| name.as_str() != "default" && !desired.contains(name.as_str()))
            .cloned()
            .collect();

        let mut all_names: HashSet<&str> = desired;
        for name in &on_disk {
            all_names.insert(name.as_str());
        }

        let cf_descriptors: Vec<ColumnFamilyDescriptor> = all_names
            .iter()
            .filter(|name| **name != "default")
            .map(|name| {
                let mut cf_opts = Options::default();
                cf_opts.set_prefix_extractor(rocksdb::SliceTransform::create_fixed_prefix(36));
                ColumnFamilyDescriptor::new(*name, cf_opts)
            })
            .collect();

        let db = RocksDB::open_cf_descriptors(&opts, path, cf_descriptors)?;

        for name in &stale {
            tracing::info!(cf = %name, "dropping stale column family");
            db.drop_cf(name)?;
        }

        Ok(Self {
            db: Arc::new(db),
            task_write_lock: Mutex::new(()),
        })
    }

    /// Acquire the task write lock. Callers outside the store crate can use this
    /// to serialize their own read-modify-write sequences on task records.
    pub fn lock_task_writes(&self) -> std::sync::MutexGuard<'_, ()> {
        self.task_write_lock.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn cf_handle(&self, name: &str) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.db
            .cf_handle(name)
            .unwrap_or_else(|| panic!("column family '{name}' not found"))
    }

    pub(crate) fn scan_cf<T: DeserializeOwned>(
        &self,
        cf: &impl rocksdb::AsColumnFamilyRef,
        prefix: Option<&str>,
    ) -> StoreResult<Vec<T>> {
        let iter = match prefix {
            Some(p) => self.db.prefix_iterator_cf(cf, p.as_bytes()),
            None => {
                let mut opts = rocksdb::ReadOptions::default();
                opts.set_total_order_seek(true);
                self.db
                    .iterator_cf_opt(cf, opts, rocksdb::IteratorMode::Start)
            }
        };

        let mut results = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if let Some(p) = prefix {
                if !key.starts_with(p.as_bytes()) {
                    break;
                }
            }
            match serde_json::from_slice(&value) {
                Ok(v) => results.push(v),
                Err(e) => {
                    let key_str = String::from_utf8_lossy(&key);
                    tracing::warn!("Skipping unreadable entry {key_str}: {e}");
                }
            }
        }
        Ok(results)
    }

    pub fn write_batch(&self, ops: Vec<BatchOp>) -> StoreResult<()> {
        let mut batch = WriteBatch::default();
        for op in ops {
            match op {
                BatchOp::Put { cf, key, value } => {
                    batch.put_cf(&self.cf_handle(cf.as_str()), key.as_bytes(), &value);
                }
                BatchOp::Delete { cf, key } => {
                    batch.delete_cf(&self.cf_handle(cf.as_str()), key.as_bytes());
                }
            }
        }
        self.db.write(batch)?;
        Ok(())
    }
}
