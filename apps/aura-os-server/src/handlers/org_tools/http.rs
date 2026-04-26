//! Shared HTTP plumbing for provider tools.
//!
//! Extracted from the previous monolithic `org_tools.rs`. The original
//! `provider_json_request` accepted an unused `&AppState` reference; the
//! parameter has been dropped so the helper now matches the 5-parameter
//! ceiling for normal helpers without changing behaviour for any caller.

use aura_os_integrations::{app_provider_headers, AppProviderKind};
use reqwest::header::{HeaderMap, ACCEPT};
use serde_json::Value;

use crate::error::{ApiError, ApiResult};

pub(super) fn map_provider_headers(kind: AppProviderKind, secret: &str) -> ApiResult<HeaderMap> {
    app_provider_headers(kind, secret).map_err(ApiError::bad_request)
}

pub(super) async fn provider_json_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    headers: HeaderMap,
    body: Option<Value>,
) -> ApiResult<Value> {
    let mut request = client.request(method, url).headers(headers);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("provider request failed: {e}")))?;
    parse_provider_response(response).await
}

#[allow(dead_code)]
pub(super) async fn provider_form_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    form: Vec<(String, String)>,
) -> ApiResult<Value> {
    let response = client
        .request(method, url)
        .header(ACCEPT, "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("provider request failed: {e}")))?;
    parse_provider_response(response).await
}

async fn parse_provider_response(response: reqwest::Response) -> ApiResult<Value> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("reading provider response failed: {e}")))?;
    if !status.is_success() {
        return Err(ApiError::bad_gateway(format!(
            "provider request failed with {}: {}",
            status, text
        )));
    }
    serde_json::from_str(&text)
        .map_err(|e| ApiError::bad_gateway(format!("provider returned invalid JSON: {e}")))
}
