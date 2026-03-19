use serde::{Deserialize, Serialize};

/// Repo descriptor returned by list_repos / search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitRepo {
    pub id: Option<String>,
    pub name: String,
    pub owner: String,
    #[serde(default)]
    pub full_name: Option<String>,
    #[serde(default)]
    pub clone_url: Option<String>,
    #[serde(default)]
    pub git_url: Option<String>,
}

impl OrbitRepo {
    /// Prefer clone_url, fall back to git_url, or build from base URL.
    pub fn clone_url_or(&self, base_url: &str) -> String {
        self.clone_url
            .clone()
            .or_else(|| self.git_url.clone())
            .unwrap_or_else(|| {
                let base = base_url.trim_end_matches('/');
                format!("{}/{}/{}", base, self.owner, self.name)
            })
    }
}

/// Response from create_repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRepoResponse {
    pub name: String,
    pub owner: String,
    #[serde(default)]
    pub clone_url: Option<String>,
    #[serde(default)]
    pub git_url: Option<String>,
}

/// Collaborator returned by list_collaborators. Repo owner and users with owner role can add people.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitCollaborator {
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub role: String,
    #[serde(default)]
    pub display_name: Option<String>,
}
