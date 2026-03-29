#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("zOS API error {status}: {message}")]
    ZosApi {
        status: u16,
        code: String,
        message: String,
    },
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}
