use tracing::warn;

use aura_os_core::ZeroAuthSession;
use aura_os_network::NetworkOrgMember;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

/// Map a role string to a numeric level for comparison.
/// Matches the hierarchy in aura-network: owner (3) > admin (2) > member (1).
pub(crate) fn role_level(role: &str) -> u8 {
    match role {
        "owner" => 3,
        "admin" => 2,
        "member" => 1,
        _ => 0,
    }
}

/// Resolve the user's network-facing ID from the session.
/// Prefers `network_user_id` (set after sync to aura-network) and falls back
/// to `user_id` (zOS ID) if the user has not been synced yet.
fn resolve_user_id(session: &ZeroAuthSession) -> String {
    session
        .network_user_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| session.user_id.clone())
}

/// Check that a user has at least `min_role` given a list of org members.
/// Returns the user's actual role string on success, or 403 Forbidden on failure.
fn check_role_in_members(
    members: &[NetworkOrgMember],
    user_id: &str,
    org_id: &str,
    min_role: &str,
) -> ApiResult<String> {
    let member = members
        .iter()
        .find(|m| m.user_id == user_id)
        .ok_or_else(|| {
            warn!(
                user_id = %user_id,
                org_id = %org_id,
                "user not found in org members during role check"
            );
            ApiError::forbidden("not a member of this organization")
        })?;

    if role_level(&member.role) < role_level(min_role) {
        return Err(ApiError::forbidden(format!(
            "requires at least '{}' role",
            min_role
        )));
    }

    Ok(member.role.clone())
}

/// Check that the authenticated user has at least `min_role` in the given org.
/// Returns the user's actual role string on success, or 403 Forbidden on failure.
pub(crate) async fn require_org_role(
    state: &AppState,
    org_id: &str,
    jwt: &str,
    session: &ZeroAuthSession,
    min_role: &str,
) -> ApiResult<String> {
    let client = state.require_network_client()?;
    let members = client
        .list_org_members(org_id, jwt)
        .await
        .map_err(map_network_error)?;

    let user_id = resolve_user_id(session);
    check_role_in_members(&members, &user_id, org_id, min_role)
}

/// Check that the user is either the process creator or has admin+ role in the org.
/// Used for process update/delete and node/connection mutations.
pub(crate) async fn require_process_edit_permission(
    state: &AppState,
    org_id: &str,
    created_by: &str,
    jwt: &str,
    session: &ZeroAuthSession,
) -> ApiResult<()> {
    let user_id = resolve_user_id(session);

    // Creator can always edit their own process
    if created_by == user_id {
        return Ok(());
    }

    // Otherwise, require admin+ role
    require_org_role(state, org_id, jwt, session, "admin").await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_member(user_id: &str, org_id: &str, role: &str) -> NetworkOrgMember {
        NetworkOrgMember {
            user_id: user_id.to_string(),
            org_id: org_id.to_string(),
            role: role.to_string(),
            credit_budget: None,
            display_name: None,
            avatar_url: None,
            joined_at: None,
        }
    }

    fn make_session(user_id: &str) -> ZeroAuthSession {
        ZeroAuthSession {
            user_id: user_id.to_string(),
            network_user_id: None,
            profile_id: None,
            display_name: "Test".into(),
            profile_image: String::new(),
            primary_zid: "zid".into(),
            zero_wallet: "w".into(),
            wallets: vec![],
            access_token: "jwt".into(),
            is_zero_pro: false,
            is_access_granted: false,
            created_at: Utc::now(),
            validated_at: Utc::now(),
        }
    }

    // -----------------------------------------------------------------------
    // role_level
    // -----------------------------------------------------------------------

    #[test]
    fn role_level_hierarchy() {
        assert!(role_level("owner") > role_level("admin"));
        assert!(role_level("admin") > role_level("member"));
        assert!(role_level("member") > role_level("unknown"));
        assert_eq!(role_level("owner"), 3);
        assert_eq!(role_level("admin"), 2);
        assert_eq!(role_level("member"), 1);
        assert_eq!(role_level(""), 0);
    }

    // -----------------------------------------------------------------------
    // check_role_in_members
    // -----------------------------------------------------------------------

    #[test]
    fn admin_passes_admin_check() {
        let members = vec![make_member("u1", "org1", "admin")];
        let result = check_role_in_members(&members, "u1", "org1", "admin");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "admin");
    }

    #[test]
    fn owner_passes_admin_check() {
        let members = vec![make_member("u1", "org1", "owner")];
        let result = check_role_in_members(&members, "u1", "org1", "admin");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "owner");
    }

    #[test]
    fn member_fails_admin_check() {
        let members = vec![make_member("u1", "org1", "member")];
        let result = check_role_in_members(&members, "u1", "org1", "admin");
        assert!(result.is_err());
    }

    #[test]
    fn member_passes_member_check() {
        let members = vec![make_member("u1", "org1", "member")];
        let result = check_role_in_members(&members, "u1", "org1", "member");
        assert!(result.is_ok());
    }

    #[test]
    fn user_not_in_members_fails() {
        let members = vec![make_member("u1", "org1", "admin")];
        let result = check_role_in_members(&members, "u2", "org1", "member");
        assert!(result.is_err());
    }

    #[test]
    fn empty_members_list_fails() {
        let members: Vec<NetworkOrgMember> = vec![];
        let result = check_role_in_members(&members, "u1", "org1", "member");
        assert!(result.is_err());
    }

    #[test]
    fn unknown_role_fails_any_check() {
        let members = vec![make_member("u1", "org1", "viewer")];
        let result = check_role_in_members(&members, "u1", "org1", "member");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // resolve_user_id
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_user_id_prefers_network_id() {
        let net_id = aura_os_core::UserId::new();
        let mut session = make_session("zos-id");
        session.network_user_id = Some(net_id);
        assert_eq!(resolve_user_id(&session), net_id.to_string());
    }

    #[test]
    fn resolve_user_id_falls_back_to_user_id() {
        let session = make_session("zos-id");
        assert_eq!(resolve_user_id(&session), "zos-id");
    }

    // -----------------------------------------------------------------------
    // creator bypass (process edit permission logic)
    // -----------------------------------------------------------------------

    #[test]
    fn creator_matches_user_id() {
        let session = make_session("u1");
        let user_id = resolve_user_id(&session);
        assert_eq!(user_id, "u1");
        // Creator check: created_by == user_id → would return Ok(()) in require_process_edit_permission
        assert_eq!("u1", user_id);
    }

    #[test]
    fn non_creator_does_not_match() {
        let session = make_session("u2");
        let user_id = resolve_user_id(&session);
        // Non-creator: created_by != user_id → would fall through to admin check
        assert_ne!("u1", user_id);
    }
}
