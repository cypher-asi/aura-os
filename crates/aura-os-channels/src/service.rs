use std::sync::Arc;

use aura_os_store::{BatchOp, SettingsStore};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::ChannelError;
use crate::kind::ChannelKind;
use crate::records::{ChannelLink, PendingLink};

/// Storage choice (Phase 1):
///
/// The public `SettingsStore` API (`put_cf_bytes` / `get_cf_bytes` /
/// `scan_cf_prefix` / `write_batch`) accepts an arbitrary column-family
/// name, so channel records live in their own `"channels"` column family
/// (a dedicated `channels.json` file) rather than polluting the `settings`
/// CF. The matching CF name is registered in `aura_os_store`.
/// Records are JSON-serialized; deletes go through `write_batch` because
/// the public API has no per-CF delete helper.
pub const CHANNELS_CF: &str = "channels";

/// Lightweight pointer stored in a per-agent index so all links for an
/// agent can be resolved without scanning the whole column family.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelLinkRef {
    pub kind: ChannelKind,
    pub chat_id: String,
}

/// Persistence for pending-link codes and durable channel links, backed by
/// the local [`SettingsStore`]. Mirrors the shadow-store pattern used by
/// `aura_os_agents::AgentService` (prefixed keys + serde records).
pub struct ChannelService {
    store: Arc<SettingsStore>,
}

impl ChannelService {
    pub fn new(store: Arc<SettingsStore>) -> Self {
        Self { store }
    }

    fn pending_key(code: &str) -> String {
        format!("channel_pending:{code}")
    }

    fn link_key(kind: ChannelKind, chat_id: &str) -> String {
        format!("channel_link:{}:{}", kind.as_str(), chat_id)
    }

    fn index_key(agent_id: &str) -> String {
        format!("channel_link_index:{agent_id}")
    }

    /// Persist a single-use pending-link code (`channel_pending:<code>`).
    pub fn create_pending(&self, pending: &PendingLink) -> Result<(), ChannelError> {
        let key = Self::pending_key(&pending.code);
        let value = serde_json::to_vec(pending)?;
        self.store
            .put_cf_bytes(CHANNELS_CF, key.as_bytes(), &value)?;
        Ok(())
    }

    /// Read and consume a pending-link code. Always deletes the entry (it
    /// is single-use). Returns `None` if the code is missing or expired.
    pub fn take_pending(&self, code: &str) -> Result<Option<PendingLink>, ChannelError> {
        let key = Self::pending_key(code);
        let Some(bytes) = self.store.get_cf_bytes(CHANNELS_CF, key.as_bytes())? else {
            return Ok(None);
        };
        // Single-use: delete regardless of whether it turns out expired.
        self.store.write_batch(vec![BatchOp::Delete {
            cf: CHANNELS_CF.to_string(),
            key: key.clone(),
        }])?;
        let pending: PendingLink = serde_json::from_slice(&bytes)?;
        if pending.expires_at <= Utc::now() {
            return Ok(None);
        }
        Ok(Some(pending))
    }

    /// Upsert a durable link (`channel_link:<kind>:<chat_id>`) and record
    /// it in the agent's index (`channel_link_index:<agent_id>`).
    pub fn put_link(&self, link: &ChannelLink) -> Result<(), ChannelError> {
        let key = Self::link_key(link.kind, &link.chat_id);
        let value = serde_json::to_vec(link)?;
        self.store
            .put_cf_bytes(CHANNELS_CF, key.as_bytes(), &value)?;
        self.add_to_index(&link.agent_id, link.kind, &link.chat_id)?;
        Ok(())
    }

    /// Fetch a durable link by `(kind, chat_id)`.
    pub fn get_link(
        &self,
        kind: ChannelKind,
        chat_id: &str,
    ) -> Result<Option<ChannelLink>, ChannelError> {
        let key = Self::link_key(kind, chat_id);
        match self.store.get_cf_bytes(CHANNELS_CF, key.as_bytes())? {
            Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            None => Ok(None),
        }
    }

    /// Resolve all durable links bound to `agent_id` via its index.
    /// Stale index entries (link already deleted) are skipped.
    pub fn list_links_for_agent(&self, agent_id: &str) -> Result<Vec<ChannelLink>, ChannelError> {
        let refs = self.read_index(agent_id)?;
        let mut links = Vec::with_capacity(refs.len());
        for entry in refs {
            if let Some(link) = self.get_link(entry.kind, &entry.chat_id)? {
                links.push(link);
            }
        }
        Ok(links)
    }

    /// Delete a durable link and prune it from the owning agent's index.
    pub fn delete_link(&self, kind: ChannelKind, chat_id: &str) -> Result<(), ChannelError> {
        // Read first so we know which agent index to prune.
        let existing = self.get_link(kind, chat_id)?;
        self.store.write_batch(vec![BatchOp::Delete {
            cf: CHANNELS_CF.to_string(),
            key: Self::link_key(kind, chat_id),
        }])?;
        if let Some(link) = existing {
            self.remove_from_index(&link.agent_id, kind, chat_id)?;
        }
        Ok(())
    }

    /// Flip the `needs_relink` flag on an existing link.
    pub fn mark_needs_relink(
        &self,
        kind: ChannelKind,
        chat_id: &str,
        needs: bool,
    ) -> Result<(), ChannelError> {
        let Some(mut link) = self.get_link(kind, chat_id)? else {
            return Err(ChannelError::NotFound);
        };
        link.needs_relink = needs;
        let key = Self::link_key(kind, chat_id);
        let value = serde_json::to_vec(&link)?;
        self.store
            .put_cf_bytes(CHANNELS_CF, key.as_bytes(), &value)?;
        Ok(())
    }

    fn read_index(&self, agent_id: &str) -> Result<Vec<ChannelLinkRef>, ChannelError> {
        let key = Self::index_key(agent_id);
        match self.store.get_cf_bytes(CHANNELS_CF, key.as_bytes())? {
            Some(bytes) => Ok(serde_json::from_slice(&bytes)?),
            None => Ok(Vec::new()),
        }
    }

    fn write_index(&self, agent_id: &str, refs: &[ChannelLinkRef]) -> Result<(), ChannelError> {
        let key = Self::index_key(agent_id);
        let value = serde_json::to_vec(refs)?;
        self.store
            .put_cf_bytes(CHANNELS_CF, key.as_bytes(), &value)?;
        Ok(())
    }

    fn add_to_index(
        &self,
        agent_id: &str,
        kind: ChannelKind,
        chat_id: &str,
    ) -> Result<(), ChannelError> {
        let mut refs = self.read_index(agent_id)?;
        if !refs.iter().any(|r| r.kind == kind && r.chat_id == chat_id) {
            refs.push(ChannelLinkRef {
                kind,
                chat_id: chat_id.to_string(),
            });
            self.write_index(agent_id, &refs)?;
        }
        Ok(())
    }

    fn remove_from_index(
        &self,
        agent_id: &str,
        kind: ChannelKind,
        chat_id: &str,
    ) -> Result<(), ChannelError> {
        let mut refs = self.read_index(agent_id)?;
        let before = refs.len();
        refs.retain(|r| !(r.kind == kind && r.chat_id == chat_id));
        if refs.len() != before {
            self.write_index(agent_id, &refs)?;
        }
        Ok(())
    }
}
