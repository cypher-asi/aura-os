//! Marketplace listing status for agents.
//!
//! Phase 1 and Phase 2 encoded this as a `listing_status:<value>` tag on
//! `Agent.tags`. Phase 3 promotes it to a typed field on `Agent`. The tag
//! form is still read as a fallback on the frontend loader, but the server
//! and network client treat the typed field as the source of truth.

use serde::{Deserialize, Serialize};

/// Whether an agent is publicly listed for hire on the marketplace.
///
/// Defaults to [`AgentListingStatus::Closed`] so existing agents without a
/// stored value stay private until their owner opts in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentListingStatus {
    /// The agent is not listed on the marketplace.
    #[default]
    Closed,
    /// The agent is available for hire on the marketplace.
    Hireable,
}

/// Tag prefix used by Phase 1/Phase 2 to encode this value on `Agent.tags`.
/// Retained so the frontend loader can fall back to tags for agents that
/// have not yet been backfilled with typed fields.
pub const LISTING_STATUS_TAG_PREFIX: &str = "listing_status:";

impl AgentListingStatus {
    /// Parse a marketplace listing status from a string. Accepts
    /// `"closed"` and `"hireable"` case-insensitively, surrounding
    /// whitespace is trimmed.
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "closed" => Ok(Self::Closed),
            "hireable" => Ok(Self::Hireable),
            other => Err(format!("unknown listing_status: {other}")),
        }
    }

    /// Canonical lowercase string representation. Matches the serde form.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Hireable => "hireable",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_closed() {
        assert_eq!(AgentListingStatus::default(), AgentListingStatus::Closed);
    }

    #[test]
    fn from_str_accepts_canonical_lowercase() {
        assert_eq!(
            AgentListingStatus::from_str("closed").unwrap(),
            AgentListingStatus::Closed
        );
        assert_eq!(
            AgentListingStatus::from_str("hireable").unwrap(),
            AgentListingStatus::Hireable
        );
    }

    #[test]
    fn from_str_is_case_insensitive_and_trims_whitespace() {
        assert_eq!(
            AgentListingStatus::from_str("  Closed  ").unwrap(),
            AgentListingStatus::Closed
        );
        assert_eq!(
            AgentListingStatus::from_str("HIREABLE").unwrap(),
            AgentListingStatus::Hireable
        );
    }

    #[test]
    fn from_str_rejects_unknown_values() {
        let err = AgentListingStatus::from_str("pending").expect_err("unknown value must fail");
        assert!(err.contains("pending"), "error was: {err}");
    }

    #[test]
    fn as_str_roundtrips_through_from_str() {
        for status in [AgentListingStatus::Closed, AgentListingStatus::Hireable] {
            assert_eq!(
                AgentListingStatus::from_str(status.as_str()).unwrap(),
                status
            );
        }
    }

    #[test]
    fn serde_uses_snake_case() {
        let json = serde_json::to_string(&AgentListingStatus::Hireable).unwrap();
        assert_eq!(json, "\"hireable\"");
        let parsed: AgentListingStatus = serde_json::from_str("\"closed\"").unwrap();
        assert_eq!(parsed, AgentListingStatus::Closed);
    }
}
