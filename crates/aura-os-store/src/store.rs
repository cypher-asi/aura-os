use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Component;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use aura_os_core::ZeroAuthSession;
use serde::de::DeserializeOwned;

use crate::batch::BatchOp;
use crate::error::{StoreError, StoreResult};

pub(crate) const ZERO_AUTH_SESSION_KEY: &str = "zero_auth_session";

type CfMap = BTreeMap<String, Vec<u8>>;

/// Logical column families. Each maps to a static `<name>.json` file on disk.
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum KnownCf {
    Settings,
    SuperAgentOrchestrations,
    BugReports,
    Channels,
}

impl KnownCf {
    const ALL: [Self; 4] = [
        Self::Settings,
        Self::SuperAgentOrchestrations,
        Self::BugReports,
        Self::Channels,
    ];

    fn parse(cf_name: &str) -> StoreResult<Self> {
        match cf_name {
            "settings" => Ok(Self::Settings),
            "super_agent_orchestrations" => Ok(Self::SuperAgentOrchestrations),
            "bug_reports" => Ok(Self::BugReports),
            "channels" => Ok(Self::Channels),
            _ => Err(StoreError::NotFound(format!("column family '{cf_name}'"))),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Settings => "settings",
            Self::SuperAgentOrchestrations => "super_agent_orchestrations",
            Self::BugReports => "bug_reports",
            Self::Channels => "channels",
        }
    }

    fn file_name(self) -> &'static str {
        match self {
            Self::Settings => "settings.json",
            Self::SuperAgentOrchestrations => "super_agent_orchestrations.json",
            Self::BugReports => "bug_reports.json",
            Self::Channels => "channels.json",
        }
    }

    fn tmp_file_name(self) -> &'static str {
        match self {
            Self::Settings => "settings.json.tmp",
            Self::SuperAgentOrchestrations => "super_agent_orchestrations.json.tmp",
            Self::BugReports => "bug_reports.json.tmp",
            Self::Channels => "channels.json.tmp",
        }
    }
}

/// Local JSON-backed key-value store (see crate-level docs for why the name).
pub struct SettingsStore {
    data: RwLock<BTreeMap<String, CfMap>>,
    pub(crate) session_cache: RwLock<Option<ZeroAuthSession>>,
    dir: PathBuf,
}

impl SettingsStore {
    pub fn open(path: &Path) -> StoreResult<Self> {
        let dir = Self::normalize_store_dir(path)?;
        fs::create_dir_all(&dir)?;
        let dir = dir.canonicalize()?;

        let mut data = BTreeMap::new();
        for cf in KnownCf::ALL {
            let loaded = Self::load_cf(&dir, cf)?;
            data.insert(cf.as_str().to_string(), loaded);
        }
        let session_cache = Self::load_session_cache(&data);

        Ok(Self {
            data: RwLock::new(data),
            session_cache: RwLock::new(session_cache),
            dir,
        })
    }

    fn normalize_store_dir(path: &Path) -> StoreResult<PathBuf> {
        let checked_path = path
            .to_str()
            .ok_or_else(|| Self::invalid_path("store path must be valid UTF-8"))?;
        if checked_path.is_empty() {
            return Err(Self::invalid_path("store path must not be empty"));
        }
        if checked_path.contains("..") {
            return Err(Self::invalid_path(
                "store path must not contain parent-directory syntax",
            ));
        }
        let path = Path::new(checked_path);

        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };

        let mut normalized = PathBuf::new();
        for component in absolute.components() {
            match component {
                Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
                Component::RootDir => normalized.push(component.as_os_str()),
                Component::CurDir => {}
                Component::Normal(part) => normalized.push(part),
                Component::ParentDir => {
                    return Err(Self::invalid_path(
                        "store path must not contain parent-directory segments",
                    ));
                }
            }
        }

        Ok(normalized)
    }

    fn invalid_path(message: &'static str) -> StoreError {
        StoreError::Io(io::Error::new(io::ErrorKind::InvalidInput, message))
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

    fn cf_path(dir: &Path, cf: KnownCf) -> PathBuf {
        dir.join(cf.file_name())
    }

    fn cf_tmp_path(dir: &Path, cf: KnownCf) -> PathBuf {
        dir.join(cf.tmp_file_name())
    }

    fn load_cf(dir: &Path, cf: KnownCf) -> StoreResult<CfMap> {
        let path = Self::cf_path(dir, cf);
        if !path.exists() {
            return Ok(BTreeMap::new());
        }
        let raw = fs::read_to_string(&path)?;
        // Self-heal a corrupt store file instead of taking the whole
        // process down. Torn writes on Windows (BSOD, hard kill, power
        // loss between `fs::write` and the OS flushing the file's
        // contents) routinely leave a `<cf>.json` that is the right
        // length but full of NUL bytes, which `serde_json` rejects with
        // "expected value at line 1 column 1". Without this branch the
        // error propagated up through `SettingsStore::open` ->
        // `aura_os_server::build_app_state` -> the `.expect(...)` on the
        // embedded server thread inside `aura-os-desktop`, which dropped
        // the ready-channel sender and panicked the main thread with a
        // RecvError. On a windows-subsystem build that means the app
        // exits silently with no UI and only `crash.log` to show for it.
        // Starting with an empty in-memory CF lets the user keep
        // launching the app; the next successful write replaces the bad
        // file through the normal atomic persist path. The auth cache
        // will be re-bootstrapped on next login and any other state in
        // this CF is best-effort recoverable from remote services.
        let encoded: BTreeMap<String, String> = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(
                    cf = cf.as_str(),
                    error = %err,
                    "settings store file unreadable; starting with an empty column family"
                );
                return Ok(BTreeMap::new());
            }
        };
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

    fn persist_cf(dir: &Path, cf: KnownCf, map: &CfMap) -> StoreResult<()> {
        let json = Self::encode_cf(map)?;
        Self::write_atomic_json(dir, cf, json.as_bytes())
    }

    fn encode_cf(map: &CfMap) -> StoreResult<String> {
        use base64::Engine;
        let encoded: BTreeMap<&str, String> = map
            .iter()
            .map(|(k, v)| {
                (
                    k.as_str(),
                    base64::engine::general_purpose::STANDARD.encode(v),
                )
            })
            .collect();
        Ok(serde_json::to_string_pretty(&encoded)?)
    }

    fn write_atomic_json(dir: &Path, cf: KnownCf, bytes: &[u8]) -> StoreResult<()> {
        use std::io::Write;
        let checked_dir = dir
            .to_str()
            .ok_or_else(|| Self::invalid_path("store path must be valid UTF-8"))?;
        if checked_dir.contains("..") {
            return Err(Self::invalid_path(
                "store path must not contain parent-directory syntax",
            ));
        }
        let dir = PathBuf::from(checked_dir);
        // Both leaf names come from the closed KnownCf enum. Construct them at
        // the sink so persisted data can never influence either filesystem
        // path, and retain the canonical store directory as their parent.
        let tmp = Self::cf_tmp_path(&dir, cf);
        let path = Self::cf_path(&dir, cf);
        if tmp.parent() != Some(dir.as_path()) || path.parent() != Some(dir.as_path()) {
            return Err(Self::invalid_path(
                "column-family files must remain inside the store directory",
            ));
        }
        // Write + flush + fsync the tmp file BEFORE rename so the
        // atomic-rename promise actually holds across crashes. NTFS
        // happily renames a file whose contents the OS hasn't yet
        // flushed; without `sync_all` a power loss between the
        // `fs::write` and the rename leaves the destination as the
        // right size but filled with NUL bytes, which is exactly the
        // failure mode that took the desktop app down silently
        // (`load_cf` then sees `\\0\\0\\0...` and returns a JSON
        // parse error). The cost is a single fsync per persist, which
        // is already the dominant cost of the rename pattern.
        {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp)?;
            f.write_all(bytes)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub(crate) fn with_cf<F, R>(&self, cf_name: &str, f: F) -> StoreResult<R>
    where
        F: FnOnce(&CfMap) -> StoreResult<R>,
    {
        let cf = KnownCf::parse(cf_name)?;
        let guard = self.data.read().expect("store lock poisoned");
        let map = guard
            .get(cf.as_str())
            .ok_or_else(|| StoreError::NotFound(format!("column family '{cf_name}'")))?;
        f(map)
    }

    pub(crate) fn with_cf_mut<F, R>(&self, cf_name: &str, f: F) -> StoreResult<R>
    where
        F: FnOnce(&mut CfMap) -> StoreResult<R>,
    {
        let cf = KnownCf::parse(cf_name)?;
        let mut guard = self.data.write().expect("store lock poisoned");
        let map = guard
            .get_mut(cf.as_str())
            .ok_or_else(|| StoreError::NotFound(format!("column family '{cf_name}'")))?;
        let result = f(map)?;
        Self::persist_cf(&self.dir, cf, map)?;
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
                    let cf_name = KnownCf::parse(&cf)?;
                    let map = guard
                        .get_mut(cf_name.as_str())
                        .ok_or_else(|| StoreError::NotFound(format!("column family '{cf}'")))?;
                    map.insert(key, value);
                    touched_cfs.insert(cf_name);
                }
                BatchOp::Delete { cf, key } => {
                    let cf_name = KnownCf::parse(&cf)?;
                    let map = guard
                        .get_mut(cf_name.as_str())
                        .ok_or_else(|| StoreError::NotFound(format!("column family '{cf}'")))?;
                    map.remove(&key);
                    touched_cfs.insert(cf_name);
                }
            }
        }
        for cf in touched_cfs {
            if let Some(map) = guard.get(cf.as_str()) {
                Self::persist_cf(&self.dir, cf, map)?;
            }
        }
        Ok(())
    }
}
