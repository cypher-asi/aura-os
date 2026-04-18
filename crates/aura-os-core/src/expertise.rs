//! Canonical marketplace expertise slug registry.
//!
//! The UI in `interface/src/apps/marketplace/marketplace-expertise.ts`
//! is the source of truth for presentational labels and icons; this module
//! mirrors the slug list so the server can validate `expertise` fields on
//! agent create / update requests without taking a dependency on the UI.
//!
//! Keep this list in sync with `MARKETPLACE_EXPERTISE` on the frontend.
//! Ordering is stable but not meaningful.

/// Canonical marketplace expertise slugs. Append-only — removing a slug is a
/// breaking change because existing agents carry `expertise:<slug>` tags.
pub const ALLOWED_SLUGS: &[&str] = &[
    "coding",
    "cyber-security",
    "ui-ux",
    "design",
    "strategy",
    "accounting",
    "legal",
    "research",
    "marketing",
    "sales",
    "data-analysis",
    "writing",
    "social-media",
    "devops",
    "ml-ai",
    "product-management",
    "operations",
    "finance",
    "customer-support",
    "education",
    "translation",
    "logistics",
];

/// Tag prefix used to encode marketplace expertise in `Agent.tags` until
/// Phase 3 promotes it to a dedicated column on the network agent record.
pub const EXPERTISE_TAG_PREFIX: &str = "expertise:";

/// Return `true` if `slug` is a known marketplace expertise identifier.
/// Matching is case-sensitive — unknown casings are rejected so the server
/// does not silently accept `UI-UX` and then fail to match UI filters.
pub fn is_valid_slug(slug: &str) -> bool {
    ALLOWED_SLUGS.iter().any(|allowed| *allowed == slug)
}

/// Validate every slug in `slugs` against [`ALLOWED_SLUGS`].
///
/// Returns a human-readable error naming the first offending slug. Duplicates
/// are allowed here — the caller (CRUD handler) is responsible for
/// deduplicating before persisting.
pub fn validate(slugs: &[String]) -> Result<(), String> {
    for slug in slugs {
        if !is_valid_slug(slug) {
            return Err(format!("unknown expertise slug: {slug}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_every_known_slug() {
        let slugs: Vec<String> = ALLOWED_SLUGS.iter().map(|s| (*s).to_string()).collect();
        assert!(validate(&slugs).is_ok());
    }

    #[test]
    fn rejects_unknown_slug_by_name() {
        let slugs = vec!["coding".to_string(), "not-a-real-slug".to_string()];
        let err = validate(&slugs).expect_err("unknown slug must fail");
        assert!(err.contains("not-a-real-slug"), "error was: {err}");
    }

    #[test]
    fn empty_input_is_valid() {
        assert!(validate(&[]).is_ok());
    }

    #[test]
    fn duplicates_are_allowed_at_validation_time() {
        let slugs = vec!["coding".to_string(), "coding".to_string()];
        assert!(validate(&slugs).is_ok());
    }

    #[test]
    fn is_valid_slug_is_case_sensitive() {
        assert!(is_valid_slug("coding"));
        assert!(!is_valid_slug("Coding"));
        assert!(!is_valid_slug("UI-UX"));
    }

    #[test]
    fn expected_slug_count_matches_ui() {
        assert_eq!(
            ALLOWED_SLUGS.len(),
            22,
            "expertise registry drifted from the UI list (frontend has 22)"
        );
    }
}
