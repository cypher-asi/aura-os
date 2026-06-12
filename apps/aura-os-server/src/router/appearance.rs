use axum::extract::DefaultBodyLimit;
use axum::routing::get;
use axum::Router;

use crate::handlers::appearance::{self, IMAGE_ASSET_MAX_BYTES};
use crate::state::AppState;

pub(super) fn appearance_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects/:project_id/appearance",
            get(appearance::get_appearance).put(appearance::put_appearance),
        )
        // Image asset uploads: body limit is raised above Axum's 2 MiB
        // default so a 5 MiB PNG/JPEG can be PUT. Handlers enforce the
        // same cap defensively; the +1 KiB allows for HTTP framing
        // overhead. The layer is harmless for GET/DELETE since they
        // carry no body.
        .route(
            "/api/projects/:project_id/appearance/banner",
            get(appearance::get_banner)
                .put(appearance::put_banner)
                .delete(appearance::delete_banner)
                .layer(DefaultBodyLimit::max(IMAGE_ASSET_MAX_BYTES + 1024)),
        )
        .route(
            "/api/projects/:project_id/appearance/background-image",
            get(appearance::get_background_image)
                .put(appearance::put_background_image)
                .delete(appearance::delete_background_image)
                .layer(DefaultBodyLimit::max(IMAGE_ASSET_MAX_BYTES + 1024)),
        )
}
