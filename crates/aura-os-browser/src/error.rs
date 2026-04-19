//! Error type for the browser crate.

use std::path::PathBuf;

use thiserror::Error;

/// The crate's top-level error.
///
/// Every public fallible operation returns `Result<_, Error>`. Variants carry
/// enough context to produce useful HTTP mappings in the server handler.
#[derive(Debug, Error)]
pub enum Error {
    /// A session id was not found in the registry.
    #[error("browser session `{0}` not found")]
    SessionNotFound(String),

    /// An input failed validation at a public boundary.
    #[error("invalid input for field `{field}`: {reason}")]
    InvalidInput {
        /// The field name that failed validation.
        field: &'static str,
        /// Human-readable reason.
        reason: String,
    },

    /// Requested operation exceeded a configured cap.
    #[error("capacity exceeded: {0}")]
    CapacityExceeded(String),

    /// A bounded operation timed out at its configured budget.
    #[error("operation `{op}` timed out")]
    Timeout {
        /// The operation that timed out (`navigate`, `cdp_call`, etc.).
        op: &'static str,
    },

    /// The operation was cancelled (session killed, shutdown).
    #[error("operation cancelled")]
    Cancelled,

    /// The backend (Chromium, stub, …) returned an error while driving a page.
    #[error("browser backend error in `{op}`: {reason}")]
    Backend {
        /// The operation the backend was performing.
        op: &'static str,
        /// Human-readable reason from the backend.
        reason: String,
    },

    /// Settings file IO failed.
    #[error("settings IO error at `{}`: {detail}", path.display())]
    Settings {
        /// The file path that was being read or written.
        path: PathBuf,
        /// The underlying IO / serde error as a string (no cross-crate leakage).
        detail: String,
    },

    /// The active port probe failed.
    #[error("port probe error: {0}")]
    Discovery(String),

    /// A feature is not supported by the current backend (e.g. screencast on
    /// the stub backend).
    #[error("not supported by the current browser backend: {0}")]
    NotSupported(&'static str),
}

impl Error {
    /// Build an [`Error::InvalidInput`] with a borrowed field name.
    pub fn invalid_input(field: &'static str, reason: impl Into<String>) -> Self {
        Self::InvalidInput {
            field,
            reason: reason.into(),
        }
    }

    /// Build an [`Error::Backend`] with a labelled operation.
    pub fn backend(op: &'static str, reason: impl Into<String>) -> Self {
        Self::Backend {
            op,
            reason: reason.into(),
        }
    }
}
