use super::*;

pub(super) fn is_sensitive_auth_path(method: &Method, path: &str) -> bool {
    if path.contains("/billing")
        || path.contains("/credits/")
        || path.ends_with("/account")
        || path.contains("/secrets")
        || path.contains("/secret")
        || path.contains("/integrations")
        || path.contains("/integration-config")
    {
        return true;
    }

    path.contains("/tool-actions") && *method != Method::GET
}
