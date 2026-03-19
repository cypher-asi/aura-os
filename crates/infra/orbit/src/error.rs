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
