//! Public (unauthenticated) AURA OS whitepaper reads.
//!
//! The `/os` whitepaper is built exactly like the blog: its sections are
//! notes stored under the reserved
//! [`AURA_WHITEPAPER_PROJECT_ID`](crate::handlers::notes::AURA_WHITEPAPER_PROJECT_ID)
//! project. The published subset is served anonymously here — the viewer
//! has no credentials, so aura-os-server resolves the rows with its own
//! `X-Internal-Token` via `list_published_notes_internal`. Drafts never
//! reach this path. Unlike the blog (newest-first), whitepaper sections
//! read top-to-bottom, so they are sorted by `sortOrder` ascending.

use axum::extract::{Path, State};
use axum::Json;

use aura_os_storage::StorageNote;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::notes::AURA_WHITEPAPER_PROJECT_ID;
use crate::state::AppState;

/// Sort published whitepaper sections by `sortOrder` ascending so the
/// document reads in authored order; rows missing an order sort first.
fn sort_by_order(notes: &mut [StorageNote]) {
    notes.sort_by(|a, b| a.sort_order.cmp(&b.sort_order));
}

/// `GET /api/public/os`. All published whitepaper sections, in order.
pub(crate) async fn list_published_os(
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<StorageNote>>> {
    let storage = state.require_storage_client()?;
    let mut notes = storage
        .list_published_notes_internal(AURA_WHITEPAPER_PROJECT_ID)
        .await
        .map_err(map_storage_error)?;
    sort_by_order(&mut notes);
    Ok(Json(notes))
}

/// `GET /api/public/os/:slug`. The single published section matching
/// `slug`, or 404 when none matches.
pub(crate) async fn get_published_os_by_slug(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> ApiResult<Json<StorageNote>> {
    let storage = state.require_storage_client()?;
    let notes = storage
        .list_published_notes_internal(AURA_WHITEPAPER_PROJECT_ID)
        .await
        .map_err(map_storage_error)?;
    let note = notes
        .into_iter()
        .find(|n| n.slug.as_deref() == Some(slug.as_str()))
        .ok_or_else(|| ApiError::not_found("whitepaper section not found"))?;
    Ok(Json(note))
}
