//! Validation + normalization for marketplace-specific fields
//! (`listing_status`, `expertise`) on agent create / update requests.
//!
//! Phase 1 and Phase 2 folded these into `Agent.tags`. Phase 3 promotes
//! them to dedicated columns on the aura-network agent record and on the
//! core [`aura_os_core::Agent`] struct, so this module validates input
//! and hands back the typed values that go onto
//! [`aura_os_network::CreateAgentRequest`] /
//! [`aura_os_network::UpdateAgentRequest`].
//!
//! Until the aura-network schema lands (see
//! `docs/migrations/2026-04-17-marketplace-agent-fields.md`), we also
//! dual-write the legacy tag encoding via [`merge_marketplace_tags`] so
//! older aura-network instances still see the values.

use std::collections::HashSet;

use aura_os_core::expertise::{self, EXPERTISE_TAG_PREFIX};
use aura_os_core::listing_status::{AgentListingStatus, LISTING_STATUS_TAG_PREFIX};

use crate::error::{ApiError, ApiResult};

/// Validated marketplace fields ready to be forwarded to aura-network.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct MarketplaceFields {
    /// Canonical lowercase listing status (`"closed"` or `"hireable"`).
    /// `None` means "do not touch the stored value".
    pub listing_status: Option<String>,
    /// Deduplicated expertise slugs. `None` means "do not touch".
    pub expertise: Option<Vec<String>>,
}

/// Validate incoming marketplace fields and normalize them for transport.
///
/// - `listing_status`: when `Some`, must be `"closed"` or `"hireable"`
///   (case-insensitive, surrounding whitespace trimmed). Unknown values
///   are rejected with `400 Bad Request`.
/// - `expertise`: when `Some`, every slug must appear in
///   [`expertise::ALLOWED_SLUGS`]; duplicates are removed while preserving
///   input order.
pub(crate) fn normalize_marketplace_fields(
    listing_status: Option<&str>,
    expertise_slugs: Option<&[String]>,
) -> ApiResult<MarketplaceFields> {
    let listing_status = match listing_status {
        Some(raw) => Some(normalize_listing_status(raw)?),
        None => None,
    };

    let expertise = match expertise_slugs {
        Some(slugs) => Some(normalize_expertise(slugs)?),
        None => None,
    };

    Ok(MarketplaceFields {
        listing_status,
        expertise,
    })
}

fn normalize_listing_status(raw: &str) -> ApiResult<String> {
    AgentListingStatus::from_str(raw)
        .map(|status| status.as_str().to_string())
        .map_err(|_| {
            ApiError::bad_request(format!(
                "invalid listing_status `{raw}` (expected `closed` or `hireable`)"
            ))
        })
}

fn normalize_expertise(slugs: &[String]) -> ApiResult<Vec<String>> {
    expertise::validate(slugs).map_err(ApiError::bad_request)?;
    let mut seen = HashSet::with_capacity(slugs.len());
    let mut unique = Vec::with_capacity(slugs.len());
    for slug in slugs {
        if seen.insert(slug.clone()) {
            unique.push(slug.clone());
        }
    }
    Ok(unique)
}

// TODO(aura-network-migration): stop dual-writing tag forms once network
// schema is live (see docs/migrations/2026-04-17-marketplace-agent-fields.md).
//
// Merge the normalized marketplace fields into the outgoing tag vector as
// legacy-style `listing_status:<x>` and `expertise:<slug>` entries so aura-
// network instances that have not yet deployed the typed columns still see
// the values via the `tags` array.
//
// Semantics match the aura-network update contract:
//   - `tags = None`  means "don't touch"; we leave it as `None`.
//   - `tags = Some`  means "replace"; we strip any stale marketplace tags
//     off the replacement set and append the normalized values.
/// Merge the normalized marketplace fields into a replacement tag vector.
pub(crate) fn merge_marketplace_tags(
    tags: Option<Vec<String>>,
    fields: &MarketplaceFields,
) -> Option<Vec<String>> {
    let Some(mut merged) = tags else {
        return None;
    };
    merged.retain(|t| !is_marketplace_tag(t));
    if let Some(status) = fields.listing_status.as_deref() {
        merged.push(format!("{LISTING_STATUS_TAG_PREFIX}{status}"));
    }
    if let Some(exp) = fields.expertise.as_deref() {
        for slug in exp {
            merged.push(format!("{EXPERTISE_TAG_PREFIX}{slug}"));
        }
    }
    Some(merged)
}

fn is_marketplace_tag(tag: &str) -> bool {
    let lower = tag.to_ascii_lowercase();
    lower.starts_with(LISTING_STATUS_TAG_PREFIX) || lower.starts_with(EXPERTISE_TAG_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_defaults_when_nothing_provided() {
        let fields = normalize_marketplace_fields(None, None).unwrap();
        assert_eq!(fields, MarketplaceFields::default());
    }

    #[test]
    fn normalizes_listing_status_to_canonical_lowercase() {
        let fields = normalize_marketplace_fields(Some("  HIREABLE "), None).unwrap();
        assert_eq!(fields.listing_status.as_deref(), Some("hireable"));
        assert!(fields.expertise.is_none());
    }

    #[test]
    fn rejects_unknown_listing_status_as_bad_request() {
        let err = normalize_marketplace_fields(Some("pending"), None)
            .expect_err("unknown listing_status must fail");
        assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
    }

    #[test]
    fn deduplicates_expertise_while_preserving_order() {
        let slugs: Vec<String> = ["coding", "devops", "coding", "ml-ai"]
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        let fields = normalize_marketplace_fields(None, Some(&slugs)).unwrap();
        assert_eq!(
            fields.expertise,
            Some(vec!["coding".into(), "devops".into(), "ml-ai".into()]),
        );
    }

    #[test]
    fn rejects_unknown_expertise_slug_as_bad_request() {
        let slugs = vec!["not-a-thing".into()];
        let err = normalize_marketplace_fields(None, Some(&slugs))
            .expect_err("unknown slug must fail");
        assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
    }

    #[test]
    fn empty_expertise_is_distinct_from_none() {
        // Callers use `Some(vec![])` to mean "clear all expertise"; we must
        // preserve that distinction so the network request carries an empty
        // list rather than leaving the stored value untouched.
        let slugs: Vec<String> = Vec::new();
        let fields = normalize_marketplace_fields(None, Some(&slugs)).unwrap();
        assert_eq!(fields.expertise, Some(Vec::new()));
    }

    #[test]
    fn merge_marketplace_tags_is_noop_when_tags_is_none() {
        let fields = MarketplaceFields {
            listing_status: Some("hireable".into()),
            expertise: Some(vec!["coding".into()]),
        };
        assert_eq!(merge_marketplace_tags(None, &fields), None);
    }

    #[test]
    fn merge_marketplace_tags_appends_typed_fields_onto_replacement_tagset() {
        let fields = MarketplaceFields {
            listing_status: Some("hireable".into()),
            expertise: Some(vec!["coding".into(), "devops".into()]),
        };
        let merged = merge_marketplace_tags(Some(vec!["super_agent".into()]), &fields).unwrap();
        assert_eq!(
            merged,
            vec![
                "super_agent".to_string(),
                "listing_status:hireable".to_string(),
                "expertise:coding".to_string(),
                "expertise:devops".to_string(),
            ]
        );
    }

    #[test]
    fn merge_marketplace_tags_strips_stale_marketplace_tags_before_appending() {
        let fields = MarketplaceFields {
            listing_status: Some("closed".into()),
            expertise: Some(vec![]),
        };
        let merged = merge_marketplace_tags(
            Some(vec![
                "host_mode:harness".into(),
                "listing_status:hireable".into(),
                "expertise:coding".into(),
            ]),
            &fields,
        )
        .unwrap();
        assert_eq!(
            merged,
            vec![
                "host_mode:harness".to_string(),
                "listing_status:closed".to_string(),
            ]
        );
    }

    #[test]
    fn merge_marketplace_tags_leaves_existing_tags_when_no_typed_fields_provided() {
        let fields = MarketplaceFields::default();
        let merged = merge_marketplace_tags(
            Some(vec!["host_mode:harness".into(), "super_agent".into()]),
            &fields,
        )
        .unwrap();
        assert_eq!(
            merged,
            vec!["host_mode:harness".to_string(), "super_agent".to_string()]
        );
    }
}
