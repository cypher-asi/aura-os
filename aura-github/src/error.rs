use aura_orgs::OrgError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("GitHub API error {status}: {message}")]
    Api { status: u16, message: String },
    #[error("JWT error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("not configured: {0}")]
    NotConfigured(String),
    #[error("org error: {0}")]
    Org(#[from] OrgError),
    #[error("integration not found")]
    IntegrationNotFound,
}
