use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use aura_os_core::ZeroAuthSession;
use serde::de::DeserializeOwned;

use crate::batch::BatchOp;
use crate::error::{StoreError, StoreResult};

/// Logical column families. Each maps to a `<name>.json` file on disk.
///
/// This is a historical holdover from the RocksDB-backed predecessor; the
/// current implementation is a plain JSON-file store per family.
///
/// NOTE: `super_agent_orchestrations` is a historical name from when
/// "super agents" were a distinct type. That distinction has been
/// unified into `Agent` + `AgentPermissions`; renaming the column
/// family here would require a data migration (existing on-disk
/// JSON files are keyed by this CF name), so the legacy name is
/// retained intentionally. Comments only — storage key is stable.
pub(crate) const CF_NAMES: &[&str] = &["settings", "super_agent_orchestrations"];
pub(crate) const ZERO_AUTH_SESSION_KEY: &str = "zero_auth_session";

type CfMap = BTreeMap<String, Vec<u8>>;

/// Local JSON-backed key-value store (see crate-level docs for why the name).
pub struct SettingsStore {
    data: RwLock<BTreeMap<String, CfMap>>,
    pub(crate) session_cache: RwLock<Option<ZeroAuthSession>>,
    dir: PathBuf,
}

impl SettingsStore {
    pub fn open(path: &Path) -> StoreResult<Self> {
        fs::create_dir_all(path)?;

        let mut data = BTreeMap::new();
        for &cf in CF_NAMES {
            let loaded = Self::load_cf(path, cf)?;
            data.insert(cf.to_string(), loaded);
        }
        let session_cache = Self::load_session_cache(&data);

        Ok(Self {
            data: RwLock::new(data),
            session_cache: RwLock::new(session_cache),
            dir: path.to_path_buf(),
        })
    }

    fn load_session_cache(data: &BTreeMap<String, CfMap>) -> Option<ZeroAuthSession> {
        let raw = data.get("settings")?.get(ZERO_AUTH_SESSION_KEY)?;
        match serde_json::from_slice::<ZeroAuthSession>(raw) {
            Ok(session) => Some(session),
            Err(error) => {
                tracing::warn!(%error, "failed to load cached zero_auth_session from settings");
                None
            }
        }
    }

    fn cf_path(dir: &Path, cf_name: &str) -> PathBuf {
        dir.join(format!("{cf_name}.json"))
    }

    fn load_cf(dir: &Path, cf_name: &str) -> StoreResult<CfMap> {
        let path = Self::cf_path(dir, cf_name);
        if !path.exists() {
            return Ok(BTreeMap::new());
        }
        let raw = fs::read_to_string(&path)?;
        let encoded: BTreeMap<String, String> = serde_json::from_str(&raw)?;
        let mut map = BTreeMap::new();
        for (k, v) in encoded {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(&v) {
                Ok(bytes) => {
                    map.insert(k, bytes);
                }
                Err(e) => {
                    tracing::warn!(key = %k, error = %e, "Skipping entry with invalid base64");
                }
            }
        }
        Ok(map)
    }

    fn persist_cf(dir: &Path, cf_name: &str, map: &CfMap) -> StoreResult<()> {
        use base64::Engine;
        fs::create_dir_all(dir)?;
        let encoded: BTreeMap<&str, String> = map
            .iter()
            .map(|(k, v)| {
                (
                    k.as_str(),
                    base64::engine::general_purpose::STANDARD.encode(v),
                )
            })
            .collect();
        let json = serde_json::to_string_pretty(&encoded)?;
        let path = Self::cf_path(dir, cf_name);
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json.as_bytes())?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub(crate) fn with_cf<F, R>(&self, cf_name: &str, f: F) -> StoreResult<R>
    where
        F: FnOnce(&CfMap) -> StoreResult<R>,
    {
        let guard = self.data.read().expect("store lock poisoned");
        let cf = guard
            .get(cf_name)
            .ok_or_else(|| StoreError::NotFound(format!("column family '{cf_name}'")))?;
        f(cf)
    }

    pub(crate) fn with_cf_mut<F, R>(&self, cf_name: &str, f: F) -> StoreResult<R>
    where
        F: FnOnce(&mut CfMap) -> StoreResult<R>,
    {
        let mut guard = self.data.write().expect("store lock poisoned");
        let cf = guard
            .get_mut(cf_name)
            .ok_or_else(|| StoreError::NotFound(format!("column family '{cf_name}'")))?;
        let result = f(cf)?;
        Self::persist_cf(&self.dir, cf_name, cf)?;
        Ok(result)
    }

    pub fn put_cf_bytes(&self, cf_name: &str, key: &[u8], value: &[u8]) -> StoreResult<()> {
        let key_str =
            String::from_utf8(key.to_vec()).map_err(|e| StoreError::KeyEncoding(e.to_string()))?;
        self.with_cf_mut(cf_name, |cf| {
            cf.insert(key_str, value.to_vec());
            Ok(())
        })
    }

    pub fn get_cf_bytes(&self, cf_name: &str, key: &[u8]) -> StoreResult<Option<Vec<u8>>> {
        let key_str =
            String::from_utf8(key.to_vec()).map_err(|e| StoreError::KeyEncoding(e.to_string()))?;
        self.with_cf(cf_name, |cf| Ok(cf.get(&key_str).cloned()))
    }

    pub fn scan_cf_prefix<T: DeserializeOwned>(
        &self,
        cf_name: &str,
        prefix: &str,
    ) -> StoreResult<Vec<T>> {
        self.with_cf(cf_name, |cf| {
            let mut results = Vec::new();
            for (key, value) in cf.range(prefix.to_string()..) {
                if !key.starts_with(prefix) {
                    break;
                }
                match serde_json::from_slice::<T>(value) {
                    Ok(v) => results.push(v),
                    Err(e) => {
                        tracing::warn!(key = %key, error = %e, "Skipping unreadable entry in prefix scan");
                    }
                }
            }
            Ok(results)
        })
    }

    pub fn scan_cf_all<T: DeserializeOwned>(&self, cf_name: &str) -> StoreResult<Vec<T>> {
        self.with_cf(cf_name, |cf| {
            let mut results = Vec::new();
            for (_key, value) in cf.iter() {
                if let Ok(val) = serde_json::from_slice::<T>(value) {
                    results.push(val);
                }
            }
            Ok(results)
        })
    }

    pub fn write_batch(&self, ops: Vec<BatchOp>) -> StoreResult<()> {
        let mut guard = self.data.write().expect("store lock poisoned");
        let mut touched_cfs = std::collections::HashSet::new();
        for op in ops {
            match op {
                BatchOp::Put { cf, key, value } => {
                    let map = guard
                        .get_mut(&cf)
                        .ok_or_else(|| StoreError::NotFound(format!("column family '{cf}'")))?;
                    map.insert(key, value);
                    touched_cfs.insert(cf);
                }
                BatchOp::Delete { cf, key } => {
                    let map = guard
                        .get_mut(&cf)
                        .ok_or_else(|| StoreError::NotFound(format!("column family '{cf}'")))?;
                    map.remove(&key);
                    touched_cfs.insert(cf);
                }
            }
        }
        for cf_name in touched_cfs {
            if let Some(cf) = guard.get(&cf_name) {
                Self::persist_cf(&self.dir, &cf_name, cf)?;
            }
        }
        Ok(())
    }
}
