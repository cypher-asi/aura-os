//! Topic-scoped event hub for aura-os.
//!
//! Replaces the previous global `broadcast::Sender<serde_json::Value>` firehose
//! with a typed [`DomainEvent`] enum routed through an [`EventHub`] that fans
//! out per-subscriber `mpsc` queues filtered by [`Topic`].
//!
//! ## Why this exists
//!
//! With a single shared `broadcast` channel, every WebSocket subscriber
//! received every event in the system; isolation between concurrent agents,
//! projects, and chat loops depended entirely on client-side filtering of
//! free-form JSON fields. Any consumer that mis-filtered or any producer
//! that forgot to stamp a routing key produced cross-loop bleed.
//!
//! `EventHub` provides:
//!
//! - **Typed events** ([`DomainEvent`]) with explicit routing fields, so
//!   producers can never forget to stamp a key.
//! - **Topic-scoped subscriptions** ([`Topic`], [`SubscriptionFilter`]),
//!   so subscribers receive only the events they asked for.
//! - **Per-subscriber queues** (`mpsc::UnboundedSender`), so a slow
//!   consumer cannot block other consumers and cannot accidentally see
//!   other topics' traffic.
//!
//! ## Concurrency
//!
//! `EventHub` is `Clone` (cheap; it holds an `Arc` to its inner state) and
//! safe to share across tasks. `publish` is non-blocking and lock-free on
//! the hot path (DashMap reads). `subscribe` and `unsubscribe` take a brief
//! write lock on the topic index.

#![warn(missing_docs)]

pub mod activity;
pub mod hub;
pub mod loop_id;
pub mod topic;

pub use activity::{LoopActivity, LoopStatus};
pub use hub::{EventHub, SubscriptionFilter, SubscriptionGuard};
pub use loop_id::{LoopId, LoopKind};
pub use topic::Topic;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionId, TaskId};

/// Strongly-typed event variants that flow through the [`EventHub`].
///
/// Every variant carries the routing keys necessary to land in the right
/// subscribers. A producer cannot construct a variant without supplying
/// these keys, which is the point: forgetting to stamp `project_id` or
/// `agent_instance_id` is now a compile error rather than a cross-loop
/// leak.
///
/// ## Adding a new variant
///
/// 1. Choose the routing keys (project / instance / session / loop / task).
/// 2. Add a struct payload with those keys plus the variant-specific data.
/// 3. Implement [`DomainEvent::topics`] for the new variant so the hub
///    can route it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DomainEvent {
    /// Per-loop activity changed (status / percent / current step). Drives
    /// the unified circular progress indicator across the UI.
    LoopActivityChanged(LoopActivityChanged),
    /// A loop was opened (chat, automation, task run, spec gen). Subscribers
    /// can use this to seed UI state before any activity events arrive.
    LoopOpened(LoopLifecycle),
    /// A loop ended (completed, failed, or cancelled). Drop UI rows /
    /// stop spinners.
    LoopEnded(LoopLifecycle),
    /// A persisted chat message was created in storage. Used by the UI's
    /// chat-history sync hook to refetch when another session writes
    /// into the same agent's history.
    ChatMessagePersisted(ChatMessagePersisted),
    /// A task transitioned in storage (status / spec assignment / etc.).
    TaskSaved(TaskSaved),
    /// Generic structured event for legacy callers we have not yet
    /// migrated to a typed variant. New code MUST NOT use this; pick
    /// or add a typed variant.
    ///
    /// Carries the routing keys explicitly so the hub can still scope
    /// fan-out correctly during the migration.
    LegacyJson(LegacyJsonEvent),
}

/// Payload for [`DomainEvent::LoopActivityChanged`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoopActivityChanged {
    /// The loop whose activity changed.
    pub loop_id: LoopId,
    /// Snapshot of the loop's current activity.
    pub activity: LoopActivity,
}

/// Payload for [`DomainEvent::LoopOpened`] / [`DomainEvent::LoopEnded`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoopLifecycle {
    /// The affected loop.
    pub loop_id: LoopId,
    /// Initial / final activity snapshot.
    pub activity: LoopActivity,
    /// When the lifecycle event occurred.
    pub at: DateTime<Utc>,
}

/// Payload for [`DomainEvent::ChatMessagePersisted`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessagePersisted {
    /// Aura storage session id this message was appended to.
    pub session_id: SessionId,
    /// The originating agent (org-level) for this chat.
    pub agent_id: AgentId,
    /// The project agent binding receiving the message, if any.
    pub agent_instance_id: Option<AgentInstanceId>,
    /// The project this message belongs to, if any.
    pub project_id: Option<ProjectId>,
    /// The persisted event id (storage primary key).
    pub event_id: String,
    /// `"user"` or `"assistant"`, mirrored from storage.
    pub role: String,
}

/// Payload for [`DomainEvent::TaskSaved`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskSaved {
    /// Project the task belongs to.
    pub project_id: ProjectId,
    /// Task id.
    pub task_id: TaskId,
    /// Current task status.
    pub status: String,
}

/// Legacy JSON event with explicit routing keys. New code MUST NOT
/// produce this variant; it exists only so existing call sites can be
/// migrated to typed variants incrementally without losing routing
/// fidelity in the meantime.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LegacyJsonEvent {
    /// Project the event applies to, if any.
    pub project_id: Option<ProjectId>,
    /// Agent instance the event applies to, if any.
    pub agent_instance_id: Option<AgentInstanceId>,
    /// Session the event applies to, if any.
    pub session_id: Option<SessionId>,
    /// Loop the event applies to, if any.
    pub loop_id: Option<LoopId>,
    /// Free-form payload.
    pub payload: serde_json::Value,
}

impl DomainEvent {
    /// All [`Topic`]s this event should be routed to. The hub fans the
    /// event out to every subscriber whose [`SubscriptionFilter`]
    /// matches any of these topics.
    #[must_use]
    pub fn topics(&self) -> Vec<Topic> {
        match self {
            DomainEvent::LoopActivityChanged(payload) => topics_for_loop(&payload.loop_id),
            DomainEvent::LoopOpened(payload) | DomainEvent::LoopEnded(payload) => {
                topics_for_loop(&payload.loop_id)
            }
            DomainEvent::ChatMessagePersisted(payload) => {
                let mut topics = vec![Topic::Session(payload.session_id)];
                if let Some(instance_id) = payload.agent_instance_id {
                    topics.push(Topic::AgentInstance(instance_id));
                }
                if let Some(project_id) = payload.project_id {
                    topics.push(Topic::Project(project_id));
                }
                topics
            }
            DomainEvent::TaskSaved(payload) => {
                vec![
                    Topic::Project(payload.project_id),
                    Topic::Task(payload.task_id),
                ]
            }
            DomainEvent::LegacyJson(payload) => topics_for_legacy(payload),
        }
    }
}

fn topics_for_loop(loop_id: &LoopId) -> Vec<Topic> {
    let mut topics = vec![Topic::Loop(loop_id.clone())];
    if let Some(project_id) = loop_id.project_id {
        topics.push(Topic::Project(project_id));
    }
    if let Some(instance_id) = loop_id.agent_instance_id {
        topics.push(Topic::AgentInstance(instance_id));
    }
    topics.push(Topic::AgentId(loop_id.agent_id));
    topics
}

fn topics_for_legacy(payload: &LegacyJsonEvent) -> Vec<Topic> {
    let mut topics = Vec::with_capacity(4);
    if let Some(project_id) = payload.project_id {
        topics.push(Topic::Project(project_id));
    }
    if let Some(instance_id) = payload.agent_instance_id {
        topics.push(Topic::AgentInstance(instance_id));
    }
    if let Some(session_id) = payload.session_id {
        topics.push(Topic::Session(session_id));
    }
    if let Some(loop_id) = &payload.loop_id {
        topics.push(Topic::Loop(loop_id.clone()));
    }
    topics
}
