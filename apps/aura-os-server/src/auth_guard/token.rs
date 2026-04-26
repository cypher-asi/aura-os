use super::*;

/// Extract a JWT from the request: first checks the `Authorization: Bearer`
/// header, then falls back to the `?token=` query parameter (used by WebSocket
/// connections where browsers cannot send custom headers).
pub(super) fn extract_request_token(req: &Request) -> Option<String> {
    // Primary: Authorization header
    if let Some(token) = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|val| val.strip_prefix("Bearer "))
    {
        return Some(token.to_string());
    }

    // Fallback: ?token= query param (WebSocket connections)
    req.uri()
        .query()
        .and_then(|q| q.split('&').find_map(|pair| pair.strip_prefix("token=")))
        .map(|t| t.to_string())
}
