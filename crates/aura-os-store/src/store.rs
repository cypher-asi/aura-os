use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use rocksdb::{ColumnFamilyDescriptor, DBWithThreadMode, MultiThreaded, Options, WriteBatch};
use serde::de::DeserializeOwned;

use crate::batch::BatchOp;
use crate::error::{StoreError, StoreResult};

/// Only settings CF is persisted; projects, orgs, agents, messages are remote-only.
pub(crate) const CF_NAMES: &[&str] = &[
    "settings",
    "super_agent_orchestrations",
    "cron_jobs",
    "cron_job_runs",
    "cron_artifacts",
];

pub(crate) type RocksDB = DBWithThreadMode<MultiThreaded>;

pub struct RocksStore {
    pub(crate) db: Arc<RocksDB>,
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

        Ok(Self { db: Arc::new(db) })
    }

    pub(crate) fn cf_handle(&self, name: &str) -> StoreResult<Arc<rocksdb::BoundColumnFamily<'_>>> {
        self.db
            .cf_handle(name)
            .ok_or_else(|| StoreError::NotFound(format!("column family '{name}'")))
    }

    #[allow(dead_code)] // kept for potential future settings scan
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
                    tracing::warn!(key = %key_str, error = %e, "Skipping unreadable entry");
                }
            }
        }
        Ok(results)
    }

    pub fn put_cf_bytes(&self, cf_name: &str, key: &[u8], value: &[u8]) -> StoreResult<()> {
        let cf = self.cf_handle(cf_name)?;
        self.db.put_cf(&cf, key, value)?;
        Ok(())
    }

    pub fn get_cf_bytes(&self, cf_name: &str, key: &[u8]) -> StoreResult<Option<Vec<u8>>> {
        let cf = self.cf_handle(cf_name)?;
        Ok(self.db.get_cf(&cf, key)?)
    }

    pub fn scan_cf_all<T: DeserializeOwned>(&self, cf_name: &str) -> StoreResult<Vec<T>> {
        let cf = self.cf_handle(cf_name)?;
        let mut opts = rocksdb::ReadOptions::default();
        opts.set_total_order_seek(true);
        let iter = self
            .db
            .iterator_cf_opt(&cf, opts, rocksdb::IteratorMode::Start);
        let mut results = Vec::new();
        for item in iter {
            let (_key, value) = item?;
            if let Ok(val) = serde_json::from_slice::<T>(&value) {
                results.push(val);
            }
        }
        Ok(results)
    }

    pub fn write_batch(&self, ops: Vec<BatchOp>) -> StoreResult<()> {
        let mut batch = WriteBatch::default();
        for op in ops {
            match op {
                BatchOp::Put { cf, key, value } => {
                    batch.put_cf(&self.cf_handle(&cf)?, key.as_bytes(), &value);
                }
                BatchOp::Delete { cf, key } => {
                    batch.delete_cf(&self.cf_handle(&cf)?, key.as_bytes());
                }
            }
        }
        self.db.write(batch)?;
        Ok(())
    }
}
