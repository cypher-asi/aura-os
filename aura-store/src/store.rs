use std::path::Path;
use std::sync::Arc;

use rocksdb::{ColumnFamilyDescriptor, DBWithThreadMode, MultiThreaded, Options, WriteBatch};
use serde::de::DeserializeOwned;

use aura_core::*;

use crate::batch::BatchOp;
use crate::error::{StoreError, StoreResult};

const CF_NAMES: &[&str] = &[
    "projects",
    "sprints",
    "specs",
    "tasks",
    "agents",
    "sessions",
    "settings",
    "chat_sessions",
    "chat_messages",
    "orgs",
    "org_members",
    "user_orgs",
    "org_invites",
    "github_integrations",
    "github_repos",
];

type RocksDB = DBWithThreadMode<MultiThreaded>;

pub struct RocksStore {
    db: Arc<RocksDB>,
}

impl RocksStore {
    pub fn open(path: &Path) -> StoreResult<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        let cf_descriptors: Vec<ColumnFamilyDescriptor> = CF_NAMES
            .iter()
            .map(|name| {
                let mut cf_opts = Options::default();
                cf_opts.set_prefix_extractor(rocksdb::SliceTransform::create_fixed_prefix(36));
                ColumnFamilyDescriptor::new(*name, cf_opts)
            })
            .collect();

        let db = RocksDB::open_cf_descriptors(&opts, path, cf_descriptors)?;
        Ok(Self { db: Arc::new(db) })
    }

    // -- Column family handle helpers --

    fn cf_handle(&self, name: &str) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.db
            .cf_handle(name)
            .unwrap_or_else(|| panic!("column family '{name}' not found"))
    }

    fn cf_projects(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("projects")
    }

    fn cf_sprints(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("sprints")
    }

    fn cf_specs(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("specs")
    }

    fn cf_tasks(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("tasks")
    }

    fn cf_agents(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("agents")
    }

    fn cf_sessions(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("sessions")
    }

    fn cf_settings(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("settings")
    }

    fn cf_chat_sessions(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("chat_sessions")
    }

    fn cf_chat_messages(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("chat_messages")
    }

    fn cf_orgs(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("orgs")
    }

    fn cf_org_members(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("org_members")
    }

    fn cf_user_orgs(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("user_orgs")
    }

    fn cf_org_invites(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("org_invites")
    }

    fn cf_github_integrations(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("github_integrations")
    }

    fn cf_github_repos(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("github_repos")
    }

    // -- Generic prefix scan --

    fn scan_cf<T: DeserializeOwned>(
        &self,
        cf: &impl rocksdb::AsColumnFamilyRef,
        prefix: Option<&str>,
    ) -> StoreResult<Vec<T>> {
        let iter = match prefix {
            Some(p) => self.db.prefix_iterator_cf(cf, p.as_bytes()),
            None => {
                let mut opts = rocksdb::ReadOptions::default();
                opts.set_total_order_seek(true);
                self.db
                    .iterator_cf_opt(cf, opts, rocksdb::IteratorMode::Start)
            }
        };

        let mut results = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if let Some(p) = prefix {
                if !key.starts_with(p.as_bytes()) {
                    break;
                }
            }
            results.push(serde_json::from_slice(&value)?);
        }
        Ok(results)
    }

    // -----------------------------------------------------------------------
    // Project CRUD
    // -----------------------------------------------------------------------

    pub fn put_project(&self, project: &Project) -> StoreResult<()> {
        let key = project.project_id.to_string();
        let value = serde_json::to_vec(project)?;
        self.db
            .put_cf(&self.cf_projects(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_project(&self, id: &ProjectId) -> StoreResult<Project> {
        let key = id.to_string();
        let bytes = self
            .db
            .get_cf(&self.cf_projects(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("project:{id}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_project(&self, id: &ProjectId) -> StoreResult<()> {
        let key = id.to_string();
        self.db.delete_cf(&self.cf_projects(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_projects(&self) -> StoreResult<Vec<Project>> {
        self.scan_cf::<Project>(&self.cf_projects(), None)
    }

    // -----------------------------------------------------------------------
    // Sprint CRUD
    // -----------------------------------------------------------------------

    pub fn put_sprint(&self, sprint: &Sprint) -> StoreResult<()> {
        let key = format!("{}:{}", sprint.project_id, sprint.sprint_id);
        let value = serde_json::to_vec(sprint)?;
        self.db
            .put_cf(&self.cf_sprints(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_sprint(
        &self,
        project_id: &ProjectId,
        sprint_id: &SprintId,
    ) -> StoreResult<Sprint> {
        let key = format!("{project_id}:{sprint_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_sprints(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("sprint:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_sprint(
        &self,
        project_id: &ProjectId,
        sprint_id: &SprintId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{sprint_id}");
        self.db.delete_cf(&self.cf_sprints(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_sprints_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Sprint>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Sprint>(&self.cf_sprints(), Some(&prefix))
    }

    // -----------------------------------------------------------------------
    // Spec CRUD
    // -----------------------------------------------------------------------

    pub fn put_spec(&self, spec: &Spec) -> StoreResult<()> {
        let key = format!("{}:{}", spec.project_id, spec.spec_id);
        let value = serde_json::to_vec(spec)?;
        self.db.put_cf(&self.cf_specs(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_spec(&self, project_id: &ProjectId, spec_id: &SpecId) -> StoreResult<Spec> {
        let key = format!("{project_id}:{spec_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_specs(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("spec:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_spec(&self, project_id: &ProjectId, spec_id: &SpecId) -> StoreResult<()> {
        let key = format!("{project_id}:{spec_id}");
        self.db.delete_cf(&self.cf_specs(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_specs_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Spec>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Spec>(&self.cf_specs(), Some(&prefix))
    }

    // -----------------------------------------------------------------------
    // Task CRUD
    // -----------------------------------------------------------------------

    pub fn put_task(&self, task: &Task) -> StoreResult<()> {
        let key = format!("{}:{}:{}", task.project_id, task.spec_id, task.task_id);
        let value = serde_json::to_vec(task)?;
        self.db.put_cf(&self.cf_tasks(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> StoreResult<Task> {
        let key = format!("{project_id}:{spec_id}:{task_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_tasks(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("task:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{spec_id}:{task_id}");
        self.db.delete_cf(&self.cf_tasks(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_tasks_by_spec(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
    ) -> StoreResult<Vec<Task>> {
        let prefix = format!("{project_id}:{spec_id}:");
        self.scan_cf::<Task>(&self.cf_tasks(), Some(&prefix))
    }

    pub fn list_tasks_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Task>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Task>(&self.cf_tasks(), Some(&prefix))
    }

    // -----------------------------------------------------------------------
    // Agent CRUD
    // -----------------------------------------------------------------------

    pub fn put_agent(&self, agent: &Agent) -> StoreResult<()> {
        let key = format!("{}:{}", agent.project_id, agent.agent_id);
        let value = serde_json::to_vec(agent)?;
        self.db.put_cf(&self.cf_agents(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_agent(&self, project_id: &ProjectId, agent_id: &AgentId) -> StoreResult<Agent> {
        let key = format!("{project_id}:{agent_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_agents(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("agent:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_agent(&self, project_id: &ProjectId, agent_id: &AgentId) -> StoreResult<()> {
        let key = format!("{project_id}:{agent_id}");
        self.db.delete_cf(&self.cf_agents(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_agents_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Agent>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Agent>(&self.cf_agents(), Some(&prefix))
    }

    // -----------------------------------------------------------------------
    // Session CRUD
    // -----------------------------------------------------------------------

    pub fn put_session(&self, session: &Session) -> StoreResult<()> {
        let key = format!(
            "{}:{}:{}",
            session.project_id, session.agent_id, session.session_id
        );
        let value = serde_json::to_vec(session)?;
        self.db
            .put_cf(&self.cf_sessions(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
    ) -> StoreResult<Session> {
        let key = format!("{project_id}:{agent_id}:{session_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_sessions(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("session:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{agent_id}:{session_id}");
        self.db.delete_cf(&self.cf_sessions(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_sessions_by_agent(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> StoreResult<Vec<Session>> {
        let prefix = format!("{project_id}:{agent_id}:");
        self.scan_cf::<Session>(&self.cf_sessions(), Some(&prefix))
    }

    // -----------------------------------------------------------------------
    // Settings CRUD
    // -----------------------------------------------------------------------

    pub fn put_setting(&self, key: &str, value: &[u8]) -> StoreResult<()> {
        self.db.put_cf(&self.cf_settings(), key.as_bytes(), value)?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> StoreResult<Vec<u8>> {
        let bytes = self
            .db
            .get_cf(&self.cf_settings(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("settings:{key}")))?;
        Ok(bytes)
    }

    pub fn delete_setting(&self, key: &str) -> StoreResult<()> {
        self.db.delete_cf(&self.cf_settings(), key.as_bytes())?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // ChatSession CRUD
    // -----------------------------------------------------------------------

    pub fn put_chat_session(&self, session: &ChatSession) -> StoreResult<()> {
        let key = format!("{}:{}", session.project_id, session.chat_session_id);
        let value = serde_json::to_vec(session)?;
        self.db
            .put_cf(&self.cf_chat_sessions(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_chat_session(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<ChatSession> {
        let key = format!("{project_id}:{chat_session_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_chat_sessions(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("chat_session:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_chat_session(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{chat_session_id}");
        self.db
            .delete_cf(&self.cf_chat_sessions(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_chat_sessions(&self, project_id: &ProjectId) -> StoreResult<Vec<ChatSession>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<ChatSession>(&self.cf_chat_sessions(), Some(&prefix))
    }

    // -----------------------------------------------------------------------
    // ChatMessage CRUD
    // -----------------------------------------------------------------------

    pub fn put_chat_message(&self, message: &ChatMessage) -> StoreResult<()> {
        let key = format!(
            "{}:{}:{}",
            message.project_id, message.chat_session_id, message.message_id
        );
        let value = serde_json::to_vec(message)?;
        self.db
            .put_cf(&self.cf_chat_messages(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn list_chat_messages(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<Vec<ChatMessage>> {
        let prefix = format!("{project_id}:{chat_session_id}:");
        self.scan_cf::<ChatMessage>(&self.cf_chat_messages(), Some(&prefix))
    }

    pub fn delete_chat_messages_by_session(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<()> {
        let prefix = format!("{project_id}:{chat_session_id}:");
        let cf = self.cf_chat_messages();
        let iter = self.db.prefix_iterator_cf(&cf, prefix.as_bytes());
        for item in iter {
            let (key, _) = item?;
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            self.db.delete_cf(&cf, &key)?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Org CRUD
    // -----------------------------------------------------------------------

    pub fn put_org(&self, org: &Org) -> StoreResult<()> {
        let key = org.org_id.to_string();
        let value = serde_json::to_vec(org)?;
        self.db.put_cf(&self.cf_orgs(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_org(&self, org_id: &OrgId) -> StoreResult<Org> {
        let key = org_id.to_string();
        let bytes = self
            .db
            .get_cf(&self.cf_orgs(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("org:{org_id}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_org(&self, org_id: &OrgId) -> StoreResult<()> {
        let key = org_id.to_string();
        self.db.delete_cf(&self.cf_orgs(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_orgs(&self) -> StoreResult<Vec<Org>> {
        self.scan_cf::<Org>(&self.cf_orgs(), None)
    }

    // -----------------------------------------------------------------------
    // OrgMember CRUD (dual-write to org_members + user_orgs)
    // -----------------------------------------------------------------------

    pub fn put_org_member(&self, member: &OrgMember) -> StoreResult<()> {
        let value = serde_json::to_vec(member)?;
        let om_key = format!("{}:{}", member.org_id, member.user_id);
        let uo_key = format!("{}:{}", member.user_id, member.org_id);

        let mut batch = WriteBatch::default();
        batch.put_cf(&self.cf_org_members(), om_key.as_bytes(), &value);
        batch.put_cf(&self.cf_user_orgs(), uo_key.as_bytes(), &value);
        self.db.write(batch)?;
        Ok(())
    }

    pub fn get_org_member(&self, org_id: &OrgId, user_id: &str) -> StoreResult<OrgMember> {
        let key = format!("{org_id}:{user_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_org_members(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("org_member:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_org_member(&self, org_id: &OrgId, user_id: &str) -> StoreResult<()> {
        let om_key = format!("{org_id}:{user_id}");
        let uo_key = format!("{user_id}:{org_id}");

        let mut batch = WriteBatch::default();
        batch.delete_cf(&self.cf_org_members(), om_key.as_bytes());
        batch.delete_cf(&self.cf_user_orgs(), uo_key.as_bytes());
        self.db.write(batch)?;
        Ok(())
    }

    pub fn list_org_members(&self, org_id: &OrgId) -> StoreResult<Vec<OrgMember>> {
        let prefix = format!("{org_id}:");
        self.scan_cf::<OrgMember>(&self.cf_org_members(), Some(&prefix))
    }

    pub fn list_user_orgs(&self, user_id: &str) -> StoreResult<Vec<OrgMember>> {
        let prefix = format!("{user_id}:");
        self.scan_cf::<OrgMember>(&self.cf_user_orgs(), Some(&prefix))
    }

    // -----------------------------------------------------------------------
    // OrgInvite CRUD
    // -----------------------------------------------------------------------

    pub fn put_org_invite(&self, invite: &OrgInvite) -> StoreResult<()> {
        let key = format!("{}:{}", invite.org_id, invite.invite_id);
        let value = serde_json::to_vec(invite)?;
        self.db
            .put_cf(&self.cf_org_invites(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_org_invite(
        &self,
        org_id: &OrgId,
        invite_id: &InviteId,
    ) -> StoreResult<OrgInvite> {
        let key = format!("{org_id}:{invite_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_org_invites(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("org_invite:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn list_org_invites(&self, org_id: &OrgId) -> StoreResult<Vec<OrgInvite>> {
        let prefix = format!("{org_id}:");
        self.scan_cf::<OrgInvite>(&self.cf_org_invites(), Some(&prefix))
    }

    pub fn get_org_invite_by_token(&self, token: &str) -> StoreResult<OrgInvite> {
        let invites = self.scan_cf::<OrgInvite>(&self.cf_org_invites(), None)?;
        invites
            .into_iter()
            .find(|inv| inv.token == token)
            .ok_or_else(|| StoreError::NotFound(format!("org_invite:token:{token}")))
    }

    // -----------------------------------------------------------------------
    // Batch writes
    // -----------------------------------------------------------------------

    pub fn write_batch(&self, ops: Vec<BatchOp>) -> StoreResult<()> {
        let mut batch = WriteBatch::default();
        for op in ops {
            match op {
                BatchOp::Put { cf, key, value } => {
                    batch.put_cf(&self.cf_handle(cf.as_str()), key.as_bytes(), &value);
                }
                BatchOp::Delete { cf, key } => {
                    batch.delete_cf(&self.cf_handle(cf.as_str()), key.as_bytes());
                }
            }
        }
        self.db.write(batch)?;
        Ok(())
    }
}
