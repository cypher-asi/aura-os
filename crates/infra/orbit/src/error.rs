use thiserror::Error;

#[derive(Debug, Error)]
pub enum OrbitError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("orbit API error: status {status}, body: {body}")]
    Api { status: u16, body: String },

    #[error("invalid response: {0}")]
    InvalidResponse(String),
}

impl OrbitError {
    /// Message suitable for API responses when Orbit is unreachable or returns an error.
    pub fn message_for_api(&self) -> String {
        match self {
            OrbitError::Request(e) => {
                if e.is_connect() || e.is_timeout() || e.is_request() {
                    "Orbit server is not reachable. Ensure Orbit is running (e.g. at the URL in ORBIT_BASE_URL).".to_string()
                } else {
                    format!("Orbit request failed: {}", e)
                }
            }
            OrbitError::Api { status, body } => {
                let body_trim = body.trim();
                if body_trim.is_empty() {
                    format!("Orbit API error (status {})", status)
                } else {
                    format!("Orbit API error (status {}): {}", status, body_trim)
                }
            }
            OrbitError::InvalidResponse(msg) => format!("Orbit returned invalid response: {}", msg),
        }
    }
}
