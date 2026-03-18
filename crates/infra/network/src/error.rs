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
}
