use axum::http::HeaderValue;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

const LOCAL_CORS_HOSTS: &[&str] = &["localhost", "127.0.0.1"];

pub(super) fn is_local_cors_origin(origin: &str) -> bool {
    let Some((scheme, remainder)) = origin.split_once("://") else {
        return false;
    };
    let host = remainder.split('/').next().unwrap_or(remainder);

    match scheme {
        "http" | "https" => LOCAL_CORS_HOSTS
            .iter()
            .any(|expected| host == *expected || host.starts_with(&format!("{expected}:"))),
        "capacitor" => host == "localhost",
        _ => false,
    }
}

pub(super) fn is_allowed_cors_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    // Native mobile shells authenticate cross-origin from localhost-like webview
    // origins, so cookie-based API access must allow those explicit origins.
    if is_local_cors_origin(origin) {
        return true;
    }

    std::env::var("AURA_ALLOWED_ORIGINS")
        .ok()
        .into_iter()
        .flat_map(|value| {
            value
                .split(',')
                .map(str::trim)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .any(|allowed| !allowed.is_empty() && allowed == origin)
}

pub fn build_local_api_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            is_allowed_cors_origin(origin)
        }))
        .allow_credentials(true)
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
}
