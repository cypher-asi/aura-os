//! Shared transport-auth helpers for server-to-harness calls.

/// Optional server-side bearer token for protecting a hosted local
/// harness gateway. This token authenticates the transport hop only;
/// the end-user JWT still travels inside `RuntimeRequest.auth_jwt`.
pub const LOCAL_HARNESS_AUTH_TOKEN_ENV: &str = "LOCAL_HARNESS_AUTH_TOKEN";

#[must_use]
pub fn local_harness_transport_auth_token_from_env() -> Option<String> {
    std::env::var(LOCAL_HARNESS_AUTH_TOKEN_ENV)
        .ok()
        .and_then(normalize_auth_token)
}

pub(crate) fn normalize_auth_token(token: impl Into<String>) -> Option<String> {
    let token = token.into();
    let trimmed = token.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[must_use]
pub(crate) fn preferred_transport_auth<'a>(
    transport_token: Option<&'a str>,
    caller_token: Option<&'a str>,
) -> Option<&'a str> {
    transport_token
        .and_then(|token| {
            let trimmed = token.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .or_else(|| {
            caller_token.and_then(|token| {
                let trimmed = token.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_transport_auth_uses_shared_token_first() {
        assert_eq!(
            preferred_transport_auth(Some(" shared "), Some("user")),
            Some("shared")
        );
    }

    #[test]
    fn preferred_transport_auth_falls_back_to_caller_token() {
        assert_eq!(preferred_transport_auth(None, Some(" user ")), Some("user"));
        assert_eq!(
            preferred_transport_auth(Some(" "), Some("user")),
            Some("user")
        );
    }
}
