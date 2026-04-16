use thiserror::Error;

#[derive(Debug, Error)]
pub enum NetworkError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("aura-network returned {status}: {body}")]
    Server { status: u16, body: String },

    #[error("Deserialization error: {0}")]
    Deserialize(String),

    #[error("aura-network is not configured (AURA_NETWORK_URL not set)")]
    NotConfigured,

    #[error("aura-network health check failed: {0}")]
    HealthCheckFailed(String),

    #[error("validation error: {0}")]
    Validation(String),
}

impl NetworkError {
    /// Whether this error is a transient upstream failure worth retrying (502, 503, 504).
    pub fn is_transient(&self) -> bool {
        matches!(self, NetworkError::Server { status, .. } if *status == 502 || *status == 503 || *status == 504)
    }
}
