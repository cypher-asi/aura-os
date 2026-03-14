mod error;
pub use error::OrgError;

use std::sync::Arc;

use chrono::{Duration, Utc};
use uuid::Uuid;

use aura_core::*;
use aura_store::RocksStore;

pub struct OrgService {
    store: Arc<RocksStore>,
}

impl OrgService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn create_org(&self, user_id: &str, name: &str, display_name: &str) -> Result<Org, OrgError> {
        if name.trim().is_empty() {
            return Err(OrgError::InvalidInput("org name must not be empty".into()));
        }
        let now = Utc::now();
        let org_id = OrgId::new();
        let org = Org { org_id, name: name.trim().to_string(), owner_user_id: user_id.to_string(), billing: None, github: None, created_at: now, updated_at: now };
        let member = OrgMember { org_id, user_id: user_id.to_string(), display_name: display_name.to_string(), role: OrgRole::Owner, joined_at: now };
        self.store.put_org(&org)?;
        self.store.put_org_member(&member)?;
        Ok(org)
    }

    pub fn get_org(&self, org_id: &OrgId) -> Result<Org, OrgError> {
        self.store.get_org(org_id).map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => OrgError::NotFound(*org_id),
            other => OrgError::Store(other),
        })
    }

    pub fn list_user_orgs(&self, user_id: &str) -> Result<Vec<Org>, OrgError> {
        let memberships = self.store.list_user_orgs(user_id)?;
        let mut orgs = Vec::with_capacity(memberships.len());
        for m in memberships {
            match self.store.get_org(&m.org_id) {
                Ok(org) => orgs.push(org),
                Err(aura_store::StoreError::NotFound(_)) => continue,
                Err(e) => return Err(OrgError::Store(e)),
            }
        }
        Ok(orgs)
    }

    pub fn update_org(&self, org_id: &OrgId, actor_user_id: &str, name: &str) -> Result<Org, OrgError> {
        self.require_admin_or_owner(org_id, actor_user_id)?;
        if name.trim().is_empty() {
            return Err(OrgError::InvalidInput("org name must not be empty".into()));
        }
        let mut org = self.get_org(org_id)?;
        org.name = name.trim().to_string();
        org.updated_at = Utc::now();
        self.store.put_org(&org)?;
        Ok(org)
    }

    pub fn list_members(&self, org_id: &OrgId) -> Result<Vec<OrgMember>, OrgError> {
        Ok(self.store.list_org_members(org_id)?)
    }

    pub fn set_role(&self, org_id: &OrgId, actor_user_id: &str, target_user_id: &str, new_role: OrgRole) -> Result<OrgMember, OrgError> {
        let actor = self.get_member(org_id, actor_user_id)?;
        if new_role == OrgRole::Owner && actor.role != OrgRole::Owner {
            return Err(OrgError::Forbidden("only Owner can transfer ownership".into()));
        }
        if actor.role != OrgRole::Owner && actor.role != OrgRole::Admin {
            return Err(OrgError::Forbidden("only Owner/Admin can change roles".into()));
        }
        let mut target = self.get_member(org_id, target_user_id)?;
        target.role = new_role;
        self.store.put_org_member(&target)?;
        if new_role == OrgRole::Owner {
            let mut prev_owner = self.get_member(org_id, actor_user_id)?;
            prev_owner.role = OrgRole::Admin;
            self.store.put_org_member(&prev_owner)?;
            let mut org = self.get_org(org_id)?;
            org.owner_user_id = target_user_id.to_string();
            org.updated_at = Utc::now();
            self.store.put_org(&org)?;
        }
        Ok(target)
    }

    pub fn remove_member(&self, org_id: &OrgId, actor_user_id: &str, target_user_id: &str) -> Result<(), OrgError> {
        let actor = self.get_member(org_id, actor_user_id)?;
        let target = self.get_member(org_id, target_user_id)?;
        if target.role == OrgRole::Owner {
            return Err(OrgError::Forbidden("cannot remove the Owner".into()));
        }
        if actor.role != OrgRole::Owner && actor.role != OrgRole::Admin {
            return Err(OrgError::Forbidden("only Owner/Admin can remove members".into()));
        }
        self.store.delete_org_member(org_id, target_user_id)?;
        Ok(())
    }

    pub fn create_invite(&self, org_id: &OrgId, actor_user_id: &str) -> Result<OrgInvite, OrgError> {
        self.require_admin_or_owner(org_id, actor_user_id)?;
        let now = Utc::now();
        let invite = OrgInvite { invite_id: InviteId::new(), org_id: *org_id, token: generate_url_safe_token(), created_by: actor_user_id.to_string(), status: InviteStatus::Pending, accepted_by: None, created_at: now, expires_at: now + Duration::days(7), accepted_at: None };
        self.store.put_org_invite(&invite)?;
        Ok(invite)
    }

    pub fn accept_invite(&self, token: &str, user_id: &str, display_name: &str) -> Result<OrgMember, OrgError> {
        let mut invite = self.store.get_org_invite_by_token(token).map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => OrgError::InviteNotFound,
            other => OrgError::Store(other),
        })?;
        if invite.status != InviteStatus::Pending { return Err(OrgError::InviteInvalid); }
        if Utc::now() > invite.expires_at {
            invite.status = InviteStatus::Expired;
            let _ = self.store.put_org_invite(&invite);
            return Err(OrgError::InviteInvalid);
        }
        if self.store.get_org_member(&invite.org_id, user_id).is_ok() { return Err(OrgError::AlreadyMember); }
        let now = Utc::now();
        invite.status = InviteStatus::Accepted;
        invite.accepted_by = Some(user_id.to_string());
        invite.accepted_at = Some(now);
        self.store.put_org_invite(&invite)?;
        let member = OrgMember { org_id: invite.org_id, user_id: user_id.to_string(), display_name: display_name.to_string(), role: OrgRole::Member, joined_at: now };
        self.store.put_org_member(&member)?;
        Ok(member)
    }

    pub fn revoke_invite(&self, org_id: &OrgId, invite_id: &InviteId, actor_user_id: &str) -> Result<OrgInvite, OrgError> {
        self.require_admin_or_owner(org_id, actor_user_id)?;
        let mut invite = self.store.get_org_invite(org_id, invite_id).map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => OrgError::InviteNotFound,
            other => OrgError::Store(other),
        })?;
        invite.status = InviteStatus::Revoked;
        self.store.put_org_invite(&invite)?;
        Ok(invite)
    }

    pub fn list_invites(&self, org_id: &OrgId) -> Result<Vec<OrgInvite>, OrgError> {
        Ok(self.store.list_org_invites(org_id)?)
    }

    pub fn set_billing(&self, org_id: &OrgId, actor_user_id: &str, billing: OrgBilling) -> Result<Org, OrgError> {
        self.require_admin_or_owner(org_id, actor_user_id)?;
        let mut org = self.get_org(org_id)?;
        org.billing = Some(billing);
        org.updated_at = Utc::now();
        self.store.put_org(&org)?;
        Ok(org)
    }

    pub fn get_billing(&self, org_id: &OrgId) -> Result<Option<OrgBilling>, OrgError> {
        let org = self.get_org(org_id)?;
        Ok(org.billing)
    }

    pub fn set_github(&self, org_id: &OrgId, actor_user_id: &str, github_org: &str) -> Result<Org, OrgError> {
        self.require_admin_or_owner(org_id, actor_user_id)?;
        let mut org = self.get_org(org_id)?;
        org.github = Some(OrgGithub { github_org: github_org.to_string(), connected_by: actor_user_id.to_string(), connected_at: Utc::now() });
        org.updated_at = Utc::now();
        self.store.put_org(&org)?;
        Ok(org)
    }

    pub fn remove_github(&self, org_id: &OrgId, actor_user_id: &str) -> Result<Org, OrgError> {
        self.require_admin_or_owner(org_id, actor_user_id)?;
        let mut org = self.get_org(org_id)?;
        org.github = None;
        org.updated_at = Utc::now();
        self.store.put_org(&org)?;
        Ok(org)
    }

    pub fn get_github(&self, org_id: &OrgId) -> Result<Option<OrgGithub>, OrgError> {
        let org = self.get_org(org_id)?;
        Ok(org.github)
    }

    fn get_member(&self, org_id: &OrgId, user_id: &str) -> Result<OrgMember, OrgError> {
        self.store.get_org_member(org_id, user_id).map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => OrgError::Forbidden(format!("user {user_id} is not a member of org {org_id}")),
            other => OrgError::Store(other),
        })
    }

    pub fn require_admin_or_owner_pub(&self, org_id: &OrgId, user_id: &str) -> Result<OrgMember, OrgError> {
        self.require_admin_or_owner(org_id, user_id)
    }

    fn require_admin_or_owner(&self, org_id: &OrgId, user_id: &str) -> Result<OrgMember, OrgError> {
        let member = self.get_member(org_id, user_id)?;
        if member.role != OrgRole::Owner && member.role != OrgRole::Admin {
            return Err(OrgError::Forbidden("requires Admin or Owner role".into()));
        }
        Ok(member)
    }

    pub fn ensure_default_org(&self, user_id: &str, display_name: &str) -> Result<(), OrgError> {
        let existing = self.store.list_user_orgs(user_id)?;
        if existing.is_empty() { self.create_org(user_id, "My Team", display_name)?; }
        Ok(())
    }
}

fn generate_url_safe_token() -> String {
    let bytes = Uuid::new_v4().as_bytes().to_vec();
    base64_url_encode(&bytes)
}

fn base64_url_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut result = String::with_capacity((data.len() * 4).div_ceil(3));
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        result.push(CHARS[(b0 >> 2) & 0x3f] as char);
        result.push(CHARS[((b0 << 4) | (b1 >> 4)) & 0x3f] as char);
        if chunk.len() > 1 { result.push(CHARS[((b1 << 2) | (b2 >> 6)) & 0x3f] as char); }
        if chunk.len() > 2 { result.push(CHARS[b2 & 0x3f] as char); }
    }
    result
}
