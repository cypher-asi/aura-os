use reqwest::{Method, RequestBuilder, Url};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Build a request to the configured Aura router without allowing the request
/// path to change the destination origin. The router bearer token must never be
/// attached to an arbitrary URL, even if a future caller accidentally threads
/// request-derived text into `path`.
pub(crate) fn request(state: &AppState, method: Method, path: &str) -> ApiResult<RequestBuilder> {
    trusted_request(&state.http_client, &state.router_url, method, path)
        .map_err(|_| ApiError::internal("Aura router URL is invalid"))
}

fn trusted_request(
    client: &reqwest::Client,
    configured_base: &str,
    method: Method,
    path: &str,
) -> Result<RequestBuilder, ()> {
    if !path.starts_with('/') {
        return Err(());
    }

    let configured_base = configured_base.trim_end_matches('/');
    let base_url = Url::parse(configured_base).map_err(|_| ())?;
    let request_url = Url::parse(&format!("{configured_base}{path}")).map_err(|_| ())?;

    let base_is_http = matches!(base_url.scheme(), "http" | "https");
    let base_has_origin = base_url.host_str().is_some();
    let base_is_clean = base_url.query().is_none() && base_url.fragment().is_none();
    let same_origin = request_url.scheme() == base_url.scheme()
        && request_url.host_str() == base_url.host_str()
        && request_url.port_or_known_default() == base_url.port_or_known_default();
    let has_embedded_credentials = !request_url.username().is_empty()
        || request_url.password().is_some()
        || !base_url.username().is_empty()
        || base_url.password().is_some();

    if !base_is_http || !base_has_origin || !base_is_clean {
        return Err(());
    }
    if !same_origin || has_embedded_credentials {
        return Err(());
    }

    // The origin check above is the security boundary. CodeQL cannot infer
    // that the configured base URL, rather than request data, owns the origin.
    // codeql[rust/request-forgery]
    Ok(client.request(method, request_url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_fixed_path_on_the_configured_origin() {
        let request = trusted_request(
            &reqwest::Client::new(),
            "https://router.example/gateway/",
            Method::POST,
            "/v1/messages",
        )
        .expect("configured router request should be accepted")
        .build()
        .expect("request should build");

        assert_eq!(
            request.url().as_str(),
            "https://router.example/gateway/v1/messages"
        );
    }

    #[test]
    fn rejects_unsafe_router_configurations() {
        for base in [
            "file:///tmp/router",
            "https://user@router.example",
            "https://router.example?redirect=https://attacker.example",
            "not a URL",
        ] {
            assert!(
                trusted_request(&reqwest::Client::new(), base, Method::POST, "/v1/messages")
                    .is_err()
            );
        }
    }

    #[test]
    fn rejects_non_absolute_paths() {
        assert!(trusted_request(
            &reqwest::Client::new(),
            "https://router.example",
            Method::POST,
            "https://attacker.example/v1/messages"
        )
        .is_err());
    }
}
