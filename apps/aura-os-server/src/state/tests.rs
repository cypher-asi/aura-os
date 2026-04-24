use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use dashmap::DashMap;

use super::{CachedSession, ValidationCache, CACHE_ENTRY_MAX_AGE};
use aura_os_core::ZeroAuthSession;

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
