//! Generic PUT / GET / DELETE for image assets in the `.aura/`
//! directory. Used by both the banner and the background-image
//! endpoints — same magic-byte validation, atomic-rename writes,
//! format-swap cleanup, and probe-first GET, just under different
//! filenames.
//!
//! Concrete assets are described by [`ImageAssetSpec`] and live in
//! sibling modules (`banner.rs`, `background_image.rs`) that wrap
//! the generic helpers.

use std::path::Path;

use axum::body::Bytes;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use tracing::warn;

use aura_os_core::ProjectId;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::paths::{appearance_dir, parse_project_id};

/// Cap an uploaded image asset (banner, background image) at 5 MiB.
/// Large enough for a hero-resolution PNG/JPEG without blowing up
/// request memory; small enough that a pathological client can't keep
/// posting unbounded payloads.
pub(crate) const IMAGE_ASSET_MAX_BYTES: usize = 5 * 1024 * 1024;

pub(super) const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
pub(super) const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];

/// One pair of `(png_name, jpg_name)` filenames the image-asset
/// handlers probe / write under in the `.aura/` directory. Lets the
/// banner and background-image flows share PUT/GET/DELETE bodies
/// without copy-pasting magic-byte handling, atomic-rename, etc.
pub(super) struct ImageAssetSpec {
    pub(super) label: &'static str,
    pub(super) png: &'static str,
    pub(super) jpg: &'static str,
}

/// Identify an image upload's format by magic bytes and return the
/// canonical filename it should be written under for the given asset
/// spec. PNG and JPEG only — covers the formats every browser file
/// picker can produce out of the box.
pub(super) fn detect_image_format(body: &[u8], spec: &ImageAssetSpec) -> Option<&'static str> {
    if body.len() >= PNG_MAGIC.len() && &body[..PNG_MAGIC.len()] == PNG_MAGIC {
        Some(spec.png)
    } else if body.len() >= JPEG_MAGIC.len() && &body[..JPEG_MAGIC.len()] == JPEG_MAGIC {
        Some(spec.jpg)
    } else {
        None
    }
}

/// Shared body for image-asset uploads. Validates size + magic bytes,
/// writes atomically via tmp+rename, removes any stale
/// other-extension file so format swaps don't leave orphans. Returns
/// the asset-specific URL keyed by `url_key` so the caller's JSON
/// shape stays predictable.
pub(super) async fn put_image_asset(
    state: &AppState,
    project_id_raw: &str,
    spec: &ImageAssetSpec,
    body: &Bytes,
    url_key: &str,
    url_path: impl Fn(&ProjectId) -> String,
) -> ApiResult<Json<Value>> {
    if body.len() > IMAGE_ASSET_MAX_BYTES {
        return Err(ApiError::bad_request(format!(
            "{} payload {} bytes exceeds the {} byte limit",
            spec.label,
            body.len(),
            IMAGE_ASSET_MAX_BYTES
        )));
    }
    let filename = detect_image_format(body, spec).ok_or_else(|| {
        ApiError::bad_request(format!(
            "{} body must be a PNG or JPEG image",
            spec.label
        ))
    })?;

    let project_id = parse_project_id(project_id_raw)?;
    let dir = appearance_dir(state, &project_id);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to create appearance directory {}: {e}",
            dir.display()
        ))
    })?;

    let target = dir.join(filename);
    let tmp = dir.join(format!("{filename}.tmp"));
    tokio::fs::write(&tmp, body).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to write {} tmp file {}: {e}",
            spec.label,
            tmp.display()
        ))
    })?;
    tokio::fs::rename(&tmp, &target).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to commit {} file {}: {e}",
            spec.label,
            target.display()
        ))
    })?;

    // Best-effort: clean up the other-extension file so swapping formats
    // doesn't leave a stale file that the GET handler (which probes PNG
    // first) would keep serving.
    let other = if filename == spec.png { spec.jpg } else { spec.png };
    let _ = tokio::fs::remove_file(dir.join(other)).await;

    Ok(Json(json!({ url_key: url_path(&project_id) })))
}

/// Shared body for image-asset GETs. Probes PNG then JPEG; 404 when
/// neither exists. Frontend treats 404 as "no asset yet" rather than
/// surfacing an error.
pub(super) async fn get_image_asset(
    state: &AppState,
    project_id_raw: &str,
    spec: &ImageAssetSpec,
) -> Response {
    let project_id = match parse_project_id(project_id_raw) {
        Ok(id) => id,
        Err((status, body)) => return (status, body).into_response(),
    };
    let dir = appearance_dir(state, &project_id);
    for (filename, mime) in [(spec.png, "image/png"), (spec.jpg, "image/jpeg")] {
        let path = dir.join(filename);
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                return (
                    [
                        (header::CONTENT_TYPE, mime),
                        // Frontend cache-busts on update so a modest
                        // cache here is safe and avoids re-downloading
                        // the asset on every project navigation.
                        (header::CACHE_CONTROL, "private, max-age=300"),
                    ],
                    bytes,
                )
                    .into_response();
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                warn!(path = %path.display(), %err, "failed to read {} file", spec.label);
                return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
            }
        }
    }
    (StatusCode::NOT_FOUND, format!("{} not found", spec.label)).into_response()
}

/// Shared body for image-asset DELETEs. Removes both possible files
/// (png + jpg) so format swaps and follow-up deletes stay consistent.
/// Missing files are not an error.
pub(super) async fn delete_image_asset(
    state: &AppState,
    project_id_raw: &str,
    spec: &ImageAssetSpec,
) -> ApiResult<Json<Value>> {
    let project_id = parse_project_id(project_id_raw)?;
    let dir = appearance_dir(state, &project_id);
    remove_if_present(&dir.join(spec.png)).await;
    remove_if_present(&dir.join(spec.jpg)).await;
    Ok(Json(json!({ "deleted": true })))
}

async fn remove_if_present(path: &Path) {
    match tokio::fs::remove_file(path).await {
        Ok(()) | Err(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::super::banner::BANNER_ASSET;
    use super::super::background_image::BACKGROUND_ASSET;
    use super::{detect_image_format, JPEG_MAGIC, PNG_MAGIC};

    #[test]
    fn detect_image_format_recognises_png() {
        let mut body = Vec::from(PNG_MAGIC);
        body.extend_from_slice(b"trailing pixels");
        assert_eq!(detect_image_format(&body, &BANNER_ASSET), Some(BANNER_ASSET.png));
    }

    #[test]
    fn detect_image_format_recognises_jpeg() {
        let mut body = Vec::from(JPEG_MAGIC);
        body.extend_from_slice(b"trailing pixels");
        assert_eq!(detect_image_format(&body, &BANNER_ASSET), Some(BANNER_ASSET.jpg));
    }

    #[test]
    fn detect_image_format_rejects_unknown_magic() {
        assert_eq!(detect_image_format(b"GIF89a", &BANNER_ASSET), None);
        assert_eq!(detect_image_format(b"", &BANNER_ASSET), None);
        assert_eq!(detect_image_format(b"\x89", &BANNER_ASSET), None);
    }

    #[test]
    fn detect_image_format_routes_to_the_named_asset() {
        let mut body = Vec::from(PNG_MAGIC);
        body.extend_from_slice(b"pixels");
        // Same body, different spec → different target filename.
        assert_eq!(detect_image_format(&body, &BANNER_ASSET), Some(BANNER_ASSET.png));
        assert_eq!(
            detect_image_format(&body, &BACKGROUND_ASSET),
            Some(BACKGROUND_ASSET.png),
        );
    }
}
