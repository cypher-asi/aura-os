//! Error type for the automation domain.
//!
//! Kept narrow on purpose: Phase G1 only has classifiers + budget
//! constants, none of which fail. The enum exists so callers in later
//! phases (failure synthesis, resolver traits, allowlists) can grow
//! the variant set without breaking the public type.

use thiserror::Error;

/// Errors produced by the automation domain.
///
/// New variants are added as later phases land. Production code must
/// match exhaustively rather than relying on a wildcard arm so the
/// compiler flags every new case.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum AutomationError {
    /// A harness event did not carry the structure the automation
    /// domain expected. `detail` is a short human-readable summary
    /// suitable for logging; it must not include user data that could
    /// inflate the log volume.
    #[error("invalid harness event: {detail}")]
    InvalidHarnessEvent {
        /// Short diagnostic describing which field was missing or
        /// malformed.
        detail: String,
    },
}
