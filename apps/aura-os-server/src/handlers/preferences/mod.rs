//! App-wide / per-user preferences, persisted server-side under the
//! `preferences:<feature>` key convention in the settings store.
//!
//! This module is the shared **skeleton** every preference feature
//! builds on. A feature adds one child module (e.g. `agent_order.rs`)
//! that:
//!   1. defines a `#[derive(Default, Serialize, Deserialize)]` struct,
//!   2. picks a feature name and stores under [`preferences_key`],
//!   3. exposes thin `get_*` / `put_*` (and optionally `delete_*`)
//!      handlers that delegate to [`get_pref`] / [`put_pref`] /
//!      [`delete_pref`],
//!   4. registers its route in `router/preferences.rs`.
//!
//! The store round-trips an opaque JSON blob, so evolving a
//! preference's frontend schema never requires a Rust change beyond
//! the struct itself. Reads of an unset key return `T::default()`
//! rather than 404, so clients never special-case "not configured."
//!
//! Every handler is `AuthJwt`-gated: anonymous reads can't leak
//! user-scoped prefs and anonymous writes can't poison the store.

// The skeleton ships these helpers ahead of any feature that calls
// them; each ported preference PR removes a helper from "unused" by
// wiring up its handlers. Allow dead_code so the skeleton compiles
// warning-clean on its own.
#![allow(dead_code)]

use axum::Json;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

// Feature modules register below. Each `pub(crate) use` re-exports the
// feature's route handlers so `router/preferences.rs` can reference
// them as `preferences::get_<feature>` etc.
//
// (Features are added by the ported PRs — keep this list alphabetical.)

/// Build the canonical settings-store key for a preference feature.
///
/// All app-wide preferences share the `preferences:` prefix so they
/// can be enumerated via `SettingsStore::list_settings_with_prefix`
/// and never collide with other settings keys. `feature` is the
/// snake_case feature name (e.g. `agent_order`, `aura_logo`,
/// `icon_select`).
pub(crate) fn preferences_key(feature: &str) -> String {
    format!("preferences:{feature}")
}

/// Read a preference blob, deserializing into `T`. Returns
/// `T::default()` when the key is unset or the stored bytes fail to
/// deserialize (e.g. a schema migration) — preferences are best-effort
/// and never hard-fail a read.
pub(crate) fn get_pref<T>(state: &AppState, feature: &str) -> Json<T>
where
    T: DeserializeOwned + Default,
{
    let prefs = state
        .store
        .get_setting(&preferences_key(feature))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    Json(prefs)
}

/// Persist a preference blob, echoing it back so the client can take
/// the server's stored shape as authoritative.
pub(crate) fn put_pref<T>(state: &AppState, feature: &str, prefs: T) -> ApiResult<Json<T>>
where
    T: Serialize,
{
    let bytes = serde_json::to_vec(&prefs)
        .map_err(|e| ApiError::internal(format!("serialize {feature} preferences: {e}")))?;
    state
        .store
        .put_setting(&preferences_key(feature), &bytes)
        .map_err(|e| ApiError::internal(format!("persist {feature} preferences: {e}")))?;
    Ok(Json(prefs))
}

/// Reset a preference to its default by deleting the stored key. The
/// next `get_pref` then returns `T::default()`. Idempotent: deleting an
/// already-absent key is not an error.
pub(crate) fn delete_pref(state: &AppState, feature: &str) -> ApiResult<axum::http::StatusCode> {
    state
        .store
        .delete_setting(&preferences_key(feature))
        .map_err(|e| ApiError::internal(format!("reset {feature} preferences: {e}")))?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
