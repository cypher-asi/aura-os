use crate::error::StorageError;
use crate::types::{
    CreateStorageSkillRequest, StorageAgentSkillAssignment, StorageSkill, UpdateStorageSkillRequest,
};

use super::{validate_url_id, StorageClient};

fn scope_query(org_id: Option<&str>) -> Result<String, StorageError> {
    match org_id {
        Some(org_id) => {
            validate_url_id(org_id, "org_id")?;
            Ok(format!("?orgId={org_id}"))
        }
        None => Ok(String::new()),
    }
}

impl StorageClient {
    pub async fn create_skill(
        &self,
        jwt: &str,
        request: &CreateStorageSkillRequest,
    ) -> Result<StorageSkill, StorageError> {
        self.post_authed(&format!("{}/api/skills", self.base_url), jwt, request)
            .await
    }

    pub async fn list_skills(
        &self,
        jwt: &str,
        org_id: Option<&str>,
    ) -> Result<Vec<StorageSkill>, StorageError> {
        let query = scope_query(org_id)?;
        self.get_authed(&format!("{}/api/skills{query}", self.base_url), jwt)
            .await
    }

    pub async fn list_skills_for_sync(
        &self,
        jwt: &str,
        org_id: Option<&str>,
    ) -> Result<Vec<StorageSkill>, StorageError> {
        let query = scope_query(org_id)?;
        self.get_authed(&format!("{}/api/skills/sync{query}", self.base_url), jwt)
            .await
    }

    pub async fn get_skill(&self, skill_id: &str, jwt: &str) -> Result<StorageSkill, StorageError> {
        validate_url_id(skill_id, "skill_id")?;
        self.get_authed(&format!("{}/api/skills/{skill_id}", self.base_url), jwt)
            .await
    }

    pub async fn update_skill(
        &self,
        skill_id: &str,
        jwt: &str,
        request: &UpdateStorageSkillRequest,
    ) -> Result<StorageSkill, StorageError> {
        validate_url_id(skill_id, "skill_id")?;
        self.put_authed(
            &format!("{}/api/skills/{skill_id}", self.base_url),
            jwt,
            request,
        )
        .await
    }

    pub async fn delete_skill(&self, skill_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(skill_id, "skill_id")?;
        self.delete_authed(&format!("{}/api/skills/{skill_id}", self.base_url), jwt)
            .await
    }

    pub async fn list_agent_skills(
        &self,
        agent_id: &str,
        jwt: &str,
        org_id: Option<&str>,
    ) -> Result<Vec<StorageSkill>, StorageError> {
        validate_url_id(agent_id, "agent_id")?;
        let query = scope_query(org_id)?;
        self.get_authed(
            &format!("{}/api/agents/{agent_id}/skills{query}", self.base_url),
            jwt,
        )
        .await
    }

    pub async fn assign_agent_skill(
        &self,
        agent_id: &str,
        skill_id: &str,
        jwt: &str,
    ) -> Result<StorageAgentSkillAssignment, StorageError> {
        validate_url_id(agent_id, "agent_id")?;
        validate_url_id(skill_id, "skill_id")?;
        self.put_authed(
            &format!("{}/api/agents/{agent_id}/skills/{skill_id}", self.base_url),
            jwt,
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn unassign_agent_skill(
        &self,
        agent_id: &str,
        skill_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(agent_id, "agent_id")?;
        validate_url_id(skill_id, "skill_id")?;
        self.delete_authed(
            &format!("{}/api/agents/{agent_id}/skills/{skill_id}", self.base_url),
            jwt,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use axum::extract::Path;
    use axum::http::HeaderMap;
    use axum::routing::{get, put};
    use axum::{Json, Router};

    use super::{scope_query, StorageClient};

    #[test]
    fn scope_query_rejects_path_injection() {
        assert!(scope_query(Some("../other")).is_err());
        assert_eq!(scope_query(None).unwrap(), "");
    }

    #[tokio::test]
    async fn sync_and_assignment_requests_use_authenticated_portable_contracts() {
        async fn sync_feed(headers: HeaderMap) -> Json<serde_json::Value> {
            assert_eq!(
                headers
                    .get(axum::http::header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer user-jwt")
            );
            Json(serde_json::json!([{
                "id": "11111111-1111-4111-8111-111111111111",
                "createdBy": "22222222-2222-4222-8222-222222222222",
                "name": "release-check",
                "revision": 4,
                "contentHash": "abc123",
                "deletedAt": "2026-07-31T00:00:00Z"
            }]))
        }

        async fn assign(
            headers: HeaderMap,
            Path((agent_id, skill_id)): Path<(String, String)>,
            Json(body): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            assert_eq!(
                headers
                    .get(axum::http::header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer user-jwt")
            );
            assert_eq!(body, serde_json::json!({}));
            Json(serde_json::json!({
                "id": "33333333-3333-4333-8333-333333333333",
                "skillId": skill_id,
                "agentId": agent_id,
                "createdBy": "22222222-2222-4222-8222-222222222222"
            }))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new()
                    .route("/api/skills/sync", get(sync_feed))
                    .route("/api/agents/:agent/skills/:skill", put(assign)),
            )
            .await
            .unwrap();
        });
        let client = StorageClient::with_base_url(&format!("http://{address}"));

        let skills = client.list_skills_for_sync("user-jwt", None).await.unwrap();
        assert_eq!(skills.len(), 1);
        assert!(skills[0].deleted_at.is_some());

        let assignment = client
            .assign_agent_skill(
                "44444444-4444-4444-8444-444444444444",
                "11111111-1111-4111-8111-111111111111",
                "user-jwt",
            )
            .await
            .unwrap();
        assert_eq!(assignment.skill_id, skills[0].id);
        server.abort();
    }
}
