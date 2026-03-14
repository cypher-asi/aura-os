use thiserror::Error;

#[derive(Debug, Error)]
pub enum BillingError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("Billing server returned {status}: {body}")]
    ServerError { status: u16, body: String },

    #[error("Invalid internal token")]
    InvalidToken,

    #[error("Deserialization error: {0}")]
    Deserialize(String),
}
