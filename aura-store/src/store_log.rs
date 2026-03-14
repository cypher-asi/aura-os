use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::StoreResult;
use crate::store::RocksStore;

static LOG_SEQ: AtomicU64 = AtomicU64::new(0);

const MAX_LOG_ENTRIES: usize = 2000;
const PRUNE_TRIGGER: usize = 2500;

impl RocksStore {
    fn cf_log_entries(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("log_entries")
    }

    /// Persist a log entry. `event_json` is the raw serialized EngineEvent.
    pub fn append_log_entry(&self, event_json: &[u8]) -> StoreResult<()> {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let seq = LOG_SEQ.fetch_add(1, Ordering::Relaxed);
        let key = format!("{millis:020}:{seq:010}");

        self.db
            .put_cf(&self.cf_log_entries(), key.as_bytes(), event_json)?;
        Ok(())
    }

    /// Return all log entries in chronological order as `(timestamp_ms, event_json_bytes)`.
    pub fn list_log_entries(&self, limit: usize) -> StoreResult<Vec<(i64, Vec<u8>)>> {
        let cf = self.cf_log_entries();
        let mut opts = rocksdb::ReadOptions::default();
        opts.set_total_order_seek(true);
        let iter = self
            .db
            .iterator_cf_opt(&cf, opts, rocksdb::IteratorMode::Start);

        let mut entries: Vec<(i64, Vec<u8>)> = Vec::new();
        for item in iter {
            let (key, value) = item?;
            let key_str = String::from_utf8_lossy(&key);
            let millis: i64 = key_str
                .split(':')
                .next()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
            entries.push((millis, value.to_vec()));
        }

        if entries.len() > limit {
            entries = entries.split_off(entries.len() - limit);
        }
        Ok(entries)
    }

    /// Remove oldest entries when the count exceeds the prune threshold.
    pub fn prune_log_entries_if_needed(&self) -> StoreResult<()> {
        let cf = self.cf_log_entries();
        let mut opts = rocksdb::ReadOptions::default();
        opts.set_total_order_seek(true);
        let iter = self
            .db
            .iterator_cf_opt(&cf, opts, rocksdb::IteratorMode::Start);

        let keys: Vec<Vec<u8>> = iter
            .filter_map(|item| item.ok().map(|(k, _)| k.to_vec()))
            .collect();

        if keys.len() <= PRUNE_TRIGGER {
            return Ok(());
        }

        let to_remove = keys.len() - MAX_LOG_ENTRIES;
        for key in keys.iter().take(to_remove) {
            self.db.delete_cf(&cf, key)?;
        }
        Ok(())
    }
}
