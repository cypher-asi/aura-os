use thiserror::Error;

#[derive(Error, Debug)]
pub enum ProcessError {
    #[error("Process not found: {0}")]
    NotFound(String),
    #[error("Node not found: {0}")]
    NodeNotFound(String),
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("Run not found: {0}")]
    RunNotFound(String),
    #[error("Invalid process graph: {0}")]
    InvalidGraph(String),
    #[error("Store error: {0}")]
    Store(String),
    #[error("Execution error: {0}")]
    Execution(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
}

impl From<serde_json::Error> for ProcessError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serialization(e.to_string())
    }
}
