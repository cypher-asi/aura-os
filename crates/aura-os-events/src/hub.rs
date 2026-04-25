//! Topic-keyed pub/sub hub.
//!
//! Producers call [`EventHub::publish`]; the hub computes the event's
//! [`crate::Topic`]s and delivers it to every subscriber whose
//! [`SubscriptionFilter`] matches. Each subscriber owns a private
//! `mpsc::UnboundedReceiver`, so a slow consumer cannot block other
//! consumers.
//!
//! ## Concurrency invariants
//!
//! - `publish` does a DashMap read on the topic→subscribers index and
//!   `try_send` on each matching subscriber's mpsc. No mutex is held
//!   across an `await`. Disconnected subscribers are removed lazily
//!   via the [`SubscriptionGuard`] `Drop` impl.
//! - `subscribe` writes a single entry into the `DashMap`; the returned
//!   guard removes that entry on drop.

use std::collections::HashSet;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::topic::Topic;
use crate::DomainEvent;

/// Subscriber filter — what a subscriber wants to receive.
///
/// A subscriber matches an event when at least one of its topics is in
/// the event's topic set, OR when [`SubscriptionFilter::all_within`]
/// returns true for the topic union.
#[derive(Clone, Debug, Default)]
pub struct SubscriptionFilter {
    topics: HashSet<Topic>,
}

impl SubscriptionFilter {
    /// Empty filter — receives nothing. Useful as a starting point
    /// before chaining `with_*` methods.
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    /// Add a single topic to the filter set.
    #[must_use]
    pub fn with_topic(mut self, topic: Topic) -> Self {
        self.topics.insert(topic);
        self
    }

    /// Add multiple topics at once.
    #[must_use]
    pub fn with_topics(mut self, topics: impl IntoIterator<Item = Topic>) -> Self {
        self.topics.extend(topics);
        self
    }

    /// `true` when at least one of `event_topics` is in this filter.
    fn matches(&self, event_topics: &[Topic]) -> bool {
        event_topics.iter().any(|t| self.topics.contains(t))
    }

    /// Returns the configured topics. Useful for debugging and tests.
    #[must_use]
    pub fn topics(&self) -> &HashSet<Topic> {
        &self.topics
    }
}

type SubscriberId = Uuid;
type Sender = mpsc::UnboundedSender<DomainEvent>;

struct Subscriber {
    sender: Sender,
    filter: SubscriptionFilter,
    /// When `true`, bypass topic matching and deliver every event.
    /// Reserved for trusted in-process bridges (e.g. forwarding to the
    /// legacy websocket broadcast). External subscribers must always
    /// go through a filtered subscription.
    accept_all: bool,
}

/// Topic-scoped pub/sub hub. Cheap to clone (holds an `Arc`).
#[derive(Clone, Default)]
pub struct EventHub {
    inner: Arc<EventHubInner>,
}

#[derive(Default)]
struct EventHubInner {
    subscribers: DashMap<SubscriberId, Subscriber>,
}

impl EventHub {
    /// Construct an empty hub.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Publish an event. Non-blocking. Disconnected subscribers are
    /// removed lazily on the next `publish` that targets them.
    pub fn publish(&self, event: DomainEvent) {
        let topics = event.topics();
        if topics.is_empty() {
            return;
        }
        let mut dead: Vec<SubscriberId> = Vec::new();
        for entry in self.inner.subscribers.iter() {
            let subscriber = entry.value();
            if !(subscriber.accept_all || subscriber.filter.matches(&topics)) {
                continue;
            }
            if subscriber.sender.send(event.clone()).is_err() {
                dead.push(*entry.key());
            }
        }
        for id in dead {
            self.inner.subscribers.remove(&id);
        }
    }

    /// Subscribe to events matching `filter`. The returned receiver
    /// yields events in publish order. The returned [`SubscriptionGuard`]
    /// must stay alive for the duration of the subscription; dropping
    /// it removes the subscriber from the hub.
    #[must_use]
    pub fn subscribe(
        &self,
        filter: SubscriptionFilter,
    ) -> (SubscriptionGuard, mpsc::UnboundedReceiver<DomainEvent>) {
        self.subscribe_inner(filter, false)
    }

    /// Subscribe to **every** event on this hub, bypassing topic
    /// filtering. Intended for in-process bridges (e.g. the websocket
    /// rebroadcaster) that must observe the full event stream. Normal
    /// callers should use [`EventHub::subscribe`] with a filter.
    #[must_use]
    pub fn subscribe_all(&self) -> (SubscriptionGuard, mpsc::UnboundedReceiver<DomainEvent>) {
        self.subscribe_inner(SubscriptionFilter::empty(), true)
    }

    fn subscribe_inner(
        &self,
        filter: SubscriptionFilter,
        accept_all: bool,
    ) -> (SubscriptionGuard, mpsc::UnboundedReceiver<DomainEvent>) {
        let (sender, receiver) = mpsc::unbounded_channel();
        let id = Uuid::new_v4();
        self.inner.subscribers.insert(
            id,
            Subscriber {
                sender,
                filter,
                accept_all,
            },
        );
        let guard = SubscriptionGuard {
            inner: self.inner.clone(),
            id,
        };
        (guard, receiver)
    }

    /// Number of currently-registered subscribers. Useful for tests
    /// and operational metrics.
    #[must_use]
    pub fn subscriber_count(&self) -> usize {
        self.inner.subscribers.len()
    }
}

/// RAII guard that removes its subscriber from the hub on drop.
pub struct SubscriptionGuard {
    inner: Arc<EventHubInner>,
    id: SubscriberId,
}

impl Drop for SubscriptionGuard {
    fn drop(&mut self) {
        self.inner.subscribers.remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::{LoopActivity, LoopStatus};
    use crate::loop_id::{LoopId, LoopKind};
    use crate::{LoopActivityChanged, LoopLifecycle};
    use aura_os_core::{AgentId, AgentInstanceId, ProjectId, UserId};
    use chrono::Utc;

    fn fresh_loop(project: ProjectId, instance: AgentInstanceId, kind: LoopKind) -> LoopId {
        LoopId::new(
            UserId::new(),
            Some(project),
            Some(instance),
            AgentId::new(),
            kind,
        )
    }

    fn activity_event(loop_id: LoopId) -> DomainEvent {
        let mut activity = LoopActivity::starting(Utc::now());
        activity.status = LoopStatus::Running;
        DomainEvent::LoopActivityChanged(LoopActivityChanged { loop_id, activity })
    }

    #[tokio::test]
    async fn project_subscriber_does_not_see_other_project() {
        let hub = EventHub::new();
        let p1 = ProjectId::new();
        let p2 = ProjectId::new();
        let i1 = AgentInstanceId::new();
        let i2 = AgentInstanceId::new();

        let (_g1, mut rx1) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(p1)));
        let l1 = fresh_loop(p1, i1, LoopKind::Automation);
        let l2 = fresh_loop(p2, i2, LoopKind::Automation);

        hub.publish(activity_event(l1.clone()));
        hub.publish(activity_event(l2));

        let received = rx1.recv().await.expect("expected a single event");
        match received {
            DomainEvent::LoopActivityChanged(p) => assert_eq!(p.loop_id, l1),
            other => panic!("unexpected variant: {other:?}"),
        }
        assert!(
            rx1.try_recv().is_err(),
            "subscriber received a foreign project event"
        );
    }

    #[tokio::test]
    async fn instance_subscriber_receives_project_routed_loop_event() {
        let hub = EventHub::new();
        let project = ProjectId::new();
        let instance = AgentInstanceId::new();
        let other_instance = AgentInstanceId::new();

        let (_g, mut rx) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::AgentInstance(instance)));

        let our_loop = fresh_loop(project, instance, LoopKind::Chat);
        let foreign_loop = fresh_loop(project, other_instance, LoopKind::Chat);

        hub.publish(activity_event(our_loop.clone()));
        hub.publish(activity_event(foreign_loop));

        let received = rx.recv().await.expect("expected one event");
        match received {
            DomainEvent::LoopActivityChanged(p) => assert_eq!(p.loop_id, our_loop),
            other => panic!("unexpected variant: {other:?}"),
        }
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn dropping_guard_unregisters_subscriber() {
        let hub = EventHub::new();
        let project = ProjectId::new();
        let (guard, _rx) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
        assert_eq!(hub.subscriber_count(), 1);
        drop(guard);
        assert_eq!(hub.subscriber_count(), 0);
    }

    #[tokio::test]
    async fn lifecycle_events_route_by_loop_keys() {
        let hub = EventHub::new();
        let project = ProjectId::new();
        let instance = AgentInstanceId::new();
        let loop_id = fresh_loop(project, instance, LoopKind::TaskRun);

        let (_g, mut rx) =
            hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Loop(loop_id.clone())));

        let activity = LoopActivity::starting(Utc::now());
        hub.publish(DomainEvent::LoopOpened(LoopLifecycle {
            loop_id: loop_id.clone(),
            activity: activity.clone(),
            at: Utc::now(),
        }));
        hub.publish(DomainEvent::LoopEnded(LoopLifecycle {
            loop_id: loop_id.clone(),
            activity,
            at: Utc::now(),
        }));

        let first = rx.recv().await.expect("opened");
        assert!(matches!(first, DomainEvent::LoopOpened(_)));
        let second = rx.recv().await.expect("ended");
        assert!(matches!(second, DomainEvent::LoopEnded(_)));
    }
}
