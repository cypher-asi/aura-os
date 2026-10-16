//! Upload proxy handler — proxies presign requests to aura-router.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Log only S3's bounded error code, never signed URLs or full response bodies.
pub(crate) fn s3_error_code(body: &str) -> Option<&str> {
    let code = body.split_once("<Code>")?.1.split_once("</Code>")?.0;
    (!code.is_empty()
        && code.len() <= 80
        && code.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_'))
    .then_some(code)
}

#[derive(Debug, Deserialize)]
pub(crate) struct PresignRequest {
    pub content_type: String,
    pub filename: String,
    /// Optional key prefix forwarded to aura-router (e.g. `blogs`).
    #[serde(default)]
    pub prefix: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct PresignResponse {
    pub upload_url: String,
    pub file_url: String,
    pub key: String,
    pub expires_in: u64,
}

/// POST /api/upload/presign
///
/// Proxies to aura-router's `/v1/upload/presign` with the user's JWT
/// forwarded for auth. Returns a presigned S3 PUT URL for direct
/// client-side upload.
pub(crate) async fn presign_upload(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Json(body): Json<PresignRequest>,
) -> ApiResult<Json<PresignResponse>> {
    let url = format!("{}/v1/upload/presign", state.router_url);

    let mut payload = serde_json::json!({
        "content_type": body.content_type,
        "filename": body.filename,
    });
    if let Some(prefix) = &body.prefix {
        payload["prefix"] = serde_json::Value::String(prefix.clone());
    }

    let resp = state
        .http_client
        .post(&url)
        .bearer_auth(&jwt)
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Upload presign: router request failed");
            ApiError::bad_gateway(format!("upstream request failed: {e}"))
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!(%status, body = %text, "Upload presign: router returned error");
        return Err(ApiError::bad_gateway(format!(
            "upstream returned {status}: {text}"
        )));
    }

    let result: PresignResponse = resp.json().await.map_err(|e| {
        tracing::error!(error = %e, "Upload presign: failed to parse router response");
        ApiError::internal(format!("invalid upstream response: {e}"))
    })?;

    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::s3_error_code;

    #[test]
    fn captures_only_the_s3_code_not_credentials_or_signature_details() {
        assert_eq!(
            s3_error_code(
                "<Error><Code>AccessDenied</Code><Message>private details</Message></Error>"
            ),
            Some("AccessDenied")
        );
        assert_eq!(
            s3_error_code("<Code>SignatureDoesNotMatch</Code>"),
            Some("SignatureDoesNotMatch")
        );
        for body in [
            "not XML",
            "<Code></Code>",
            "<Code>key/secret</Code>",
            "<Code>truncated",
        ] {
            assert_eq!(s3_error_code(body), None);
        }
        assert_eq!(
            s3_error_code(&format!("<Code>{}</Code>", "A".repeat(81))),
            None
        );
    }
}
