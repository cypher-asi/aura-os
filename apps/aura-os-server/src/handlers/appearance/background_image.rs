//! Background-image endpoints. Used by the Appearance tab's `Image`
//! background pattern. Thin wrappers over the shared image-asset
//! helpers in `image_asset.rs`.

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, State};
use axum::response::Response;
use axum::Json;
use serde_json::Value;

use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt};

use super::image_asset::{delete_image_asset, get_image_asset, put_image_asset, ImageAssetSpec};

pub(super) const BACKGROUND_ASSET: ImageAssetSpec = ImageAssetSpec {
    label: "background image",
    png: "background.png",
    jpg: "background.jpg",
};

/// `PUT /api/projects/:project_id/appearance/background-image` — writes
/// the uploaded image to `<workspace>/.aura/background.{png,jpg}`.
pub(crate) async fn put_background_image(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    put_image_asset(
        &state,
        &project_id,
        &BACKGROUND_ASSET,
        &body,
        "backgroundImageUrl",
        |id| format!("/api/projects/{id}/appearance/background-image"),
    )
    .await
}

/// `GET /api/projects/:project_id/appearance/background-image` — serves
/// the stored background image.
pub(crate) async fn get_background_image(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    get_image_asset(&state, &project_id, &BACKGROUND_ASSET).await
}

/// `DELETE /api/projects/:project_id/appearance/background-image` —
/// removes the stored background image (both PNG and JPEG variants).
pub(crate) async fn delete_background_image(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    delete_image_asset(&state, &project_id, &BACKGROUND_ASSET).await
}
