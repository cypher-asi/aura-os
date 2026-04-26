/// Extracted context from a nested upstream error body of the form
/// `{"error":{"code":"...","message":"..."}}`.
#[derive(Debug, Default)]
pub(crate) struct UpstreamErrorContext {
    pub upstream_code: Option<String>,
    pub upstream_message: Option<String>,
}

impl UpstreamErrorContext {
    pub(crate) fn parse(body: &str) -> Self {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
            return Self::default();
        };
        let inner = value.get("error");
        let upstream_code = inner
            .and_then(|v| v.get("code"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let upstream_message = inner
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Self {
            upstream_code,
            upstream_message,
        }
    }
}
