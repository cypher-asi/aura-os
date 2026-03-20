use serde::{Deserialize, Serialize};

fn build_clone_url(base_url: &str, owner: &str, repo: &str) -> String {
    let base = base_url.trim_end_matches('/');
    format!("{}/{}/{}.git", base, owner, repo)
}

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
            .unwrap_or_else(|| build_clone_url(base_url, &self.owner, &self.name))
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitRepoApiResponse {
    pub id: String,
    pub owner_id: String,
    pub org_id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub description: Option<String>,
}

impl OrbitRepoApiResponse {
    pub fn to_orbit_repo(&self, base_url: &str) -> OrbitRepo {
        let clone_url = build_clone_url(base_url, &self.org_id, &self.slug);
        OrbitRepo {
            id: Some(self.id.clone()),
            name: self.slug.clone(),
            owner: self.org_id.clone(),
            full_name: Some(format!("{}/{}", self.org_id, self.slug)),
            clone_url: Some(clone_url.clone()),
            git_url: Some(clone_url),
        }
    }

    pub fn to_create_repo_response(&self, base_url: &str) -> CreateRepoResponse {
        let clone_url = build_clone_url(base_url, &self.org_id, &self.slug);
        CreateRepoResponse {
            name: self.slug.clone(),
            owner: self.org_id.clone(),
            clone_url: Some(clone_url.clone()),
            git_url: Some(clone_url),
        }
    }
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
