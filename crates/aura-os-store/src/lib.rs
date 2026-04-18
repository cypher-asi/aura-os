//! Local JSON-backed key-value store for `aura-os`.
//!
//! Despite the historical `RocksStore` name (now renamed to [`SettingsStore`]),
//! this crate is **not** backed by RocksDB. It is a simple in-memory
//! [`std::collections::BTreeMap`] that is flushed to pretty-printed JSON files
//! on disk, one file per logical column family (e.g. `settings.json`). The
//! column-family abstraction is a vestige of the old RocksDB backend and is
//! retained only so existing call sites (keyed by prefix strings like
//! `agent:…`, `project:…`, `org_integration:…`) continue to work unchanged.
//!
//! Durable, event-sourced data (agent transcripts, harness record logs) lives
//! in the `aura-harness` record log, not here. This store holds only small,
//! latched state: the local auth session, agent/project/org records, and
//! integration secrets.

pub mod batch;
pub mod error;
pub mod store;
mod store_settings;

pub use batch::{BatchOp, ColumnFamilyName};
pub use error::{StoreError, StoreResult};
pub use store::SettingsStore;
