use super::*;

// ---------------------------------------------------------------------------
// Per-request auth extractors (set by `require_verified_session` middleware)
// ---------------------------------------------------------------------------

/// JWT access token extracted from the `Authorization: Bearer <token>` header.
/// Injected as an Axum Extension by the auth middleware.
#[derive(Clone, Debug)]
pub(crate) struct AuthJwt(pub String);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthJwt {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthJwt>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth token"))
    }
}

/// Full authenticated session, available after middleware validation.
/// Injected as an Axum Extension by the auth middleware.
#[derive(Clone, Debug)]
pub(crate) struct AuthSession(pub ZeroAuthSession);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthSession {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthSession>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth session"))
    }
}

/// Metadata from the last zOS validation (Pro entitlement fetch), carried alongside [`AuthSession`].
#[derive(Clone, Debug)]
pub(crate) struct AuthZeroProMeta {
    pub zero_pro_refresh_error: Option<String>,
}

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthZeroProMeta {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthZeroProMeta>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth metadata"))
    }
}
