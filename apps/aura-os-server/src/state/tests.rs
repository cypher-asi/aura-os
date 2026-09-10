use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use dashmap::DashMap;
use tokio::sync::{broadcast, mpsc, Mutex};

use super::{
    evict_chat_sessions_for_agent_in_registry, CachedSession, ChatSession, ChatSessionKey,
    ChatSessionRegistry, ValidationCache, CACHE_ENTRY_MAX_AGE,
};
use aura_os_core::ZeroAuthSession;
use aura_os_harness::{HarnessInbound, HarnessOutbound};

fn make_session() -> ZeroAuthSession {
    ZeroAuthSession {
        user_id: "u1".into(),
        network_user_id: None,
        profile_id: None,
        display_name: "Test".into(),
        profile_image: String::new(),
        primary_zid: "0://test".into(),
        zero_wallet: "0x0".into(),
        wallets: vec![],
        access_token: "tok".into(),
        is_zero_pro: false,
        is_access_granted: false,
        is_sys_admin: false,
        created_at: Utc::now(),
        validated_at: Utc::now(),
    }
}

#[test]
fn cache_retains_fresh_entries() {
    let cache: ValidationCache = Arc::new(DashMap::new());
    cache.insert(
        "fresh".into(),
        CachedSession {
            session: make_session(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: None,
        },
    );
    cache.retain(|_, entry| entry.validated_at.elapsed() < CACHE_ENTRY_MAX_AGE);
    assert_eq!(cache.len(), 1);
}

#[test]
fn cache_evicts_expired_entries() {
    let cache: ValidationCache = Arc::new(DashMap::new());
    cache.insert(
        "expired".into(),
        CachedSession {
            session: make_session(),
            validated_at: Instant::now() - CACHE_ENTRY_MAX_AGE - std::time::Duration::from_secs(1),
            zero_pro_refresh_error: None,
        },
    );
    cache.retain(|_, entry| entry.validated_at.elapsed() < CACHE_ENTRY_MAX_AGE);
    assert_eq!(cache.len(), 0);
}

#[test]
fn cache_mixed_fresh_and_expired() {
    let cache: ValidationCache = Arc::new(DashMap::new());
    cache.insert(
        "fresh".into(),
        CachedSession {
            session: make_session(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: None,
        },
    );
    cache.insert(
        "expired".into(),
        CachedSession {
            session: make_session(),
            validated_at: Instant::now() - CACHE_ENTRY_MAX_AGE - std::time::Duration::from_secs(1),
            zero_pro_refresh_error: None,
        },
    );
    cache.retain(|_, entry| entry.validated_at.elapsed() < CACHE_ENTRY_MAX_AGE);
    assert_eq!(cache.len(), 1);
    assert!(cache.contains_key("fresh"));
    assert!(!cache.contains_key("expired"));
}

/// Insert a minimal `ChatSession` keyed by `(session_key, model)` and
/// owned by `template_agent_id`. The harness channels are stand-ins;
/// the eviction sweep only reads `template_agent_id`.
fn insert_session(
    registry: &ChatSessionRegistry,
    session_key: &str,
    model: Option<&str>,
    template_agent_id: &str,
) {
    let (commands_tx, _commands_rx) = mpsc::channel::<HarnessInbound>(4);
    let (events_tx, _events_rx) = broadcast::channel::<HarnessOutbound>(8);
    registry.insert(
        ChatSessionKey::new(session_key, model.map(str::to_string)),
        ChatSession {
            last_used_at: std::time::Instant::now(),
            session_id: format!("session-{session_key}"),
            commands_tx,
            events_tx,
            model: model.map(str::to_string),
            agent_id: Some(template_agent_id.to_string()),
            template_agent_id: Some(template_agent_id.to_string()),
            turn_slot: Arc::new(Mutex::new(())),
            turn_pending_count: Arc::new(AtomicUsize::new(0)),
        },
    );
}

#[test]
fn evict_drops_only_the_target_agents_sessions() {
    let registry: ChatSessionRegistry = Arc::new(DashMap::new());
    // Two warm sessions for the recovered CEO (different model entries
    // on the same partition) plus an unrelated agent's session.
    insert_session(&registry, "ceo::default", Some("opus"), "ceo");
    insert_session(&registry, "ceo::default", Some("sonnet"), "ceo");
    insert_session(&registry, "other::default", None, "other-agent");
    assert_eq!(registry.len(), 3);

    evict_chat_sessions_for_agent_in_registry(&registry, "ceo");

    assert_eq!(registry.len(), 1, "both CEO entries should be evicted");
    assert!(
        registry
            .get(&ChatSessionKey::new("other::default", None))
            .is_some(),
        "the unrelated agent's session must survive",
    );
}

#[test]
fn evict_is_a_noop_when_no_sessions_match() {
    let registry: ChatSessionRegistry = Arc::new(DashMap::new());
    insert_session(&registry, "other::default", None, "other-agent");

    evict_chat_sessions_for_agent_in_registry(&registry, "ceo");

    assert_eq!(registry.len(), 1);
}
