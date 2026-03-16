use std::sync::Arc;

use aura_core::*;

use crate::error::StoreResult;
use crate::store::RocksStore;

impl RocksStore {
    fn cf_follows(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("follows")
    }

    pub fn put_follow(&self, follow: &Follow) -> StoreResult<()> {
        let key = format!(
            "{}:{}:{}",
            follow.follower_user_id,
            serde_json::to_value(&follow.target_type)
                .unwrap()
                .as_str()
                .unwrap(),
            follow.target_id
        );
        let value = serde_json::to_vec(follow)?;
        self.db.put_cf(&self.cf_follows(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn delete_follow(
        &self,
        follower_user_id: &str,
        target_type: FollowTargetType,
        target_id: &str,
    ) -> StoreResult<()> {
        let tt = serde_json::to_value(&target_type)
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        let key = format!("{follower_user_id}:{tt}:{target_id}");
        self.db.delete_cf(&self.cf_follows(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_follows_by_user(&self, follower_user_id: &str) -> StoreResult<Vec<Follow>> {
        let prefix = format!("{follower_user_id}:");
        let mut opts = rocksdb::ReadOptions::default();
        opts.set_total_order_seek(true);
        let iter = self.db.iterator_cf_opt(
            &self.cf_follows(),
            opts,
            rocksdb::IteratorMode::From(prefix.as_bytes(), rocksdb::Direction::Forward),
        );
        let mut results = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            match serde_json::from_slice(&value) {
                Ok(v) => results.push(v),
                Err(e) => {
                    let key_str = String::from_utf8_lossy(&key);
                    tracing::warn!("Skipping unreadable follow entry {key_str}: {e}");
                }
            }
        }
        Ok(results)
    }

    pub fn is_following(
        &self,
        follower_user_id: &str,
        target_type: FollowTargetType,
        target_id: &str,
    ) -> StoreResult<bool> {
        let tt = serde_json::to_value(&target_type)
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        let key = format!("{follower_user_id}:{tt}:{target_id}");
        Ok(self
            .db
            .get_cf(&self.cf_follows(), key.as_bytes())?
            .is_some())
    }
}
