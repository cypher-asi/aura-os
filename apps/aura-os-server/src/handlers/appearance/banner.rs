//! Banner image endpoints. Thin wrappers over the shared
//! image-asset helpers in `image_asset.rs`.

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, State};
use axum::response::Response;
use axum::Json;
use serde_json::Value;

use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt};

use super::image_asset::{delete_image_asset, get_image_asset, put_image_asset, ImageAssetSpec};

pub(super) const BANNER_ASSET: ImageAssetSpec = ImageAssetSpec {
    label: "banner",
    png: "banner.png",
    jpg: "banner.jpg",
};

/// `PUT /api/projects/:project_id/appearance/banner` — writes the
/// uploaded image to `<workspace>/.aura/banner.{png,jpg}`.
pub(crate) async fn put_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    put_image_asset(
        &state,
        &project_id,
        &BANNER_ASSET,
        &body,
        "bannerUrl",
        |id| format!("/api/projects/{id}/appearance/banner"),
    )
    .await
}

/// `GET /api/projects/:project_id/appearance/banner` — serves the
/// stored banner.
pub(crate) async fn get_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> Response {
    get_image_asset(&state, &project_id, &BANNER_ASSET).await
}

/// `DELETE /api/projects/:project_id/appearance/banner` — removes
/// both possible banner files. Missing files are treated as success so
/// the endpoint is idempotent.
pub(crate) async fn delete_banner(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    delete_image_asset(&state, &project_id, &BANNER_ASSET).await
}
