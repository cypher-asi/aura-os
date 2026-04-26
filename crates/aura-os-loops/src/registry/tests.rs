use super::*;
use aura_os_core::{AgentId, AgentInstanceId, ProjectId, UserId};
use aura_os_events::{LoopKind, SubscriptionFilter, Topic};

fn fresh_loop_id(project: ProjectId, instance: AgentInstanceId, kind: LoopKind) -> LoopId {
    LoopId::new(
        UserId::new(),
        Some(project),
        Some(instance),
        AgentId::new(),
        kind,
    )
}

#[tokio::test]
async fn opening_a_loop_emits_loop_opened() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let loop_id = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Chat);
    let _handle = registry.open(loop_id.clone());

    let evt = rx.recv().await.expect("opened");
    assert!(matches!(evt, DomainEvent::LoopOpened(p) if p.loop_id == loop_id));
    assert_eq!(registry.len(), 1);
}

#[tokio::test]
async fn dropping_handle_without_terminal_publishes_cancelled() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    {
        let loop_id = fresh_loop_id(project, AgentInstanceId::new(), LoopKind::Automation);
        let _h = registry.open(loop_id);
    }
    let opened = rx.recv().await.unwrap();
    assert!(matches!(opened, DomainEvent::LoopOpened(_)));
    let ended = rx.recv().await.unwrap();
    match ended {
        DomainEvent::LoopEnded(p) => assert_eq!(p.activity.status, LoopStatus::Cancelled),
        other => panic!("expected LoopEnded, got {other:?}"),
    }
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn transitions_publish_activity_changed() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let handle = registry.open(fresh_loop_id(
        project,
        AgentInstanceId::new(),
        LoopKind::TaskRun,
    ));

    // Drain the LoopOpened.
    let _ = rx.recv().await;

    handle
        .mark_running(Some(0.25), Some("thinking".into()))
        .await;

    let evt = rx.recv().await.unwrap();
    match evt {
        DomainEvent::LoopActivityChanged(p) => {
            assert_eq!(p.activity.status, LoopStatus::Running);
            assert_eq!(p.activity.percent, Some(0.25));
            assert_eq!(p.activity.current_step.as_deref(), Some("thinking"));
        }
        other => panic!("expected LoopActivityChanged, got {other:?}"),
    }
    handle.mark_completed().await;
    let evt = rx.recv().await.unwrap();
    assert!(matches!(
        evt,
        DomainEvent::LoopEnded(p) if p.activity.status == LoopStatus::Completed
    ));
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn transition_throttles_same_status_updates() {
    use std::time::Duration as StdDuration;

    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub.clone());
    let project = ProjectId::new();
    let (_g, mut rx) =
        hub.subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(project)));
    let handle = registry.open(fresh_loop_id(
        project,
        AgentInstanceId::new(),
        LoopKind::Chat,
    ));

    // Drain the LoopOpened.
    let _ = rx.recv().await;

    // First transition into Running: status changes, so it bypasses
    // the throttle and publishes immediately.
    handle
        .mark_running(Some(0.1), Some("thinking".into()))
        .await;
    let first = rx.recv().await.unwrap();
    assert!(matches!(first, DomainEvent::LoopActivityChanged(_)));

    // A burst of same-status transitions within the throttle window
    // should NOT publish more events.
    for i in 0..20 {
        handle
            .transition(|activity| {
                activity.percent = Some(0.1 + (i as f32) * 0.01);
            })
            .await;
    }
    let drained = tokio::time::timeout(StdDuration::from_millis(50), rx.recv()).await;
    assert!(
        drained.is_err(),
        "throttle must suppress same-status updates within the 250ms window"
    );

    // A real status change (Running -> WaitingTool) must bypass the
    // throttle and publish immediately, even while we're still
    // inside the 250ms window.
    handle.mark_waiting_tool("read_file").await;
    let after_status_change = tokio::time::timeout(StdDuration::from_millis(50), rx.recv())
        .await
        .expect("status change must bypass throttle")
        .expect("event");
    match after_status_change {
        DomainEvent::LoopActivityChanged(p) => {
            assert_eq!(p.activity.status, LoopStatus::WaitingTool);
        }
        other => panic!("expected LoopActivityChanged, got {other:?}"),
    }

    // After the throttle window elapses, a same-status transition
    // publishes again.
    tokio::time::sleep(ACTIVITY_PUBLISH_INTERVAL + StdDuration::from_millis(50)).await;
    handle
        .transition(|activity| {
            activity.current_step = Some("tool: read_file (still)".into());
        })
        .await;
    let after_window = tokio::time::timeout(StdDuration::from_millis(100), rx.recv())
        .await
        .expect("throttle must release after window")
        .expect("event");
    assert!(matches!(after_window, DomainEvent::LoopActivityChanged(_)));

    handle.mark_completed().await;
    let end = rx.recv().await.unwrap();
    assert!(matches!(end, DomainEvent::LoopEnded(_)));
}

#[tokio::test]
async fn snapshot_filters_by_project() {
    let hub = EventHub::new();
    let registry = LoopRegistry::new(hub);
    let p1 = ProjectId::new();
    let p2 = ProjectId::new();
    let l1 = registry.open(fresh_loop_id(p1, AgentInstanceId::new(), LoopKind::Chat));
    let _l2 = registry.open(fresh_loop_id(p2, AgentInstanceId::new(), LoopKind::Chat));

    let snap = registry.snapshot_where(loops_in_project(p1));
    assert_eq!(snap.len(), 1);
    assert_eq!(snap[0].loop_id, *l1.loop_id());
}
