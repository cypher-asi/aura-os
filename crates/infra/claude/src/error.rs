#[derive(Debug, thiserror::Error)]
pub enum ClaudeClientError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error {status}: {message}")]
    Api { status: u16, message: String },
    #[error("The AI model is temporarily overloaded. Please try again in a moment.")]
    Overloaded,
    #[error("response truncated: output hit max_tokens limit ({max_tokens}). Increase MAX_TOKENS or reduce input size.")]
    Truncated { max_tokens: u32 },
    #[error("response parse error: {0}")]
    Parse(String),
    #[error("Insufficient credits — please top up to continue.")]
    InsufficientCredits,
}

impl ClaudeClientError {
    /// Returns true for transient overload/rate-limit errors that are safe to retry.
    pub fn is_overloaded(&self) -> bool {
        match self {
            ClaudeClientError::Overloaded => true,
            ClaudeClientError::Api { status, .. } => *status == 429 || *status == 529,
            _ => false,
        }
    }
}
