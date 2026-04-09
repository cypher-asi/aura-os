use thiserror::Error;

#[derive(Debug, Error)]
pub enum IntegrationsError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("aura-integrations returned {status}: {body}")]
    Server { status: u16, body: String },

    #[error("Deserialization error: {0}")]
    Deserialize(String),

    #[error("aura-integrations is not configured; Aura OS is using compatibility-only local integration storage")]
    NotConfigured,
}

impl IntegrationsError {
    pub fn is_transient(&self) -> bool {
        matches!(self, IntegrationsError::Server { status, .. } if *status == 502 || *status == 503 || *status == 504)
    }
}
