use super::resolve_local_server_base_url;
use super::*;
use std::sync::Mutex;

struct EnvGuard {
    key: &'static str,
    prev: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let prev = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, prev }
    }

    fn unset(key: &'static str) -> Self {
        let prev = std::env::var(key).ok();
        std::env::remove_var(key);
        Self { key, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

fn env_lock() -> &'static Mutex<()> {
    static LOCK: Mutex<()> = Mutex::new(());
    &LOCK
}

#[test]
fn resolve_local_server_base_url_uses_canonical_explicit_base_url() {
    let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let _base = EnvGuard::set("AURA_SERVER_BASE_URL", " https://aura.example.com/ ");
    let _vite = EnvGuard::unset("VITE_API_URL");
    let _host = EnvGuard::set("AURA_SERVER_HOST", "10.0.0.5");
    let _port = EnvGuard::set("AURA_SERVER_PORT", "9000");

    assert_eq!(resolve_local_server_base_url(), "https://aura.example.com");
}

#[test]
fn resolve_local_server_base_url_uses_vite_api_url_when_base_url_unset() {
    let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
    let _vite = EnvGuard::set("VITE_API_URL", " https://aura.example.com/ ");
    let _host = EnvGuard::set("AURA_SERVER_HOST", "0.0.0.0");
    let _port = EnvGuard::set("AURA_SERVER_PORT", "3100");

    assert_eq!(resolve_local_server_base_url(), "https://aura.example.com");
}

#[test]
fn resolve_local_server_base_url_normalizes_host_port_fallback() {
    let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
    let _vite = EnvGuard::unset("VITE_API_URL");
    let _host = EnvGuard::set("AURA_SERVER_HOST", "0.0.0.0");
    let _port = EnvGuard::set("AURA_SERVER_PORT", "3100");

    assert_eq!(resolve_local_server_base_url(), "http://127.0.0.1:3100");
}

#[test]
fn parse_harness_ws_slots_uses_default_when_unset() {
    assert_eq!(parse_harness_ws_slots(None), DEFAULT_HARNESS_WS_SLOTS);
}

#[test]
fn parse_harness_ws_slots_uses_default_for_empty_or_blank() {
    assert_eq!(parse_harness_ws_slots(Some("")), DEFAULT_HARNESS_WS_SLOTS);
    assert_eq!(
        parse_harness_ws_slots(Some("   ")),
        DEFAULT_HARNESS_WS_SLOTS
    );
}

#[test]
fn parse_harness_ws_slots_accepts_valid_positive_integer() {
    assert_eq!(parse_harness_ws_slots(Some("64")), 64);
    assert_eq!(parse_harness_ws_slots(Some(" 256 ")), 256);
}

#[test]
fn parse_harness_ws_slots_falls_back_for_zero() {
    assert_eq!(parse_harness_ws_slots(Some("0")), DEFAULT_HARNESS_WS_SLOTS);
}

#[test]
fn parse_harness_ws_slots_falls_back_for_non_numeric() {
    assert_eq!(
        parse_harness_ws_slots(Some("not-a-number")),
        DEFAULT_HARNESS_WS_SLOTS
    );
    assert_eq!(parse_harness_ws_slots(Some("-5")), DEFAULT_HARNESS_WS_SLOTS);
    assert_eq!(
        parse_harness_ws_slots(Some("1.5")),
        DEFAULT_HARNESS_WS_SLOTS
    );
}

#[test]
fn read_harness_ws_slots_from_env_picks_up_env_var() {
    let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let _guard = EnvGuard::set(HARNESS_WS_SLOTS_ENV, "42");
    assert_eq!(read_harness_ws_slots_from_env(), 42);
}

#[test]
fn read_harness_ws_slots_from_env_uses_default_when_missing() {
    let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let _guard = EnvGuard::unset(HARNESS_WS_SLOTS_ENV);
    assert_eq!(read_harness_ws_slots_from_env(), DEFAULT_HARNESS_WS_SLOTS);
}
