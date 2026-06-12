//! Lightweight Mixpanel event tracker for server-side analytics.
//!
//! Fires `session_active` once per user per calendar day so True DAU
//! is accurate regardless of client version. Uses an in-memory
//! `DashMap` for deduplication — no external state required.

use dashmap::DashMap;
use reqwest::Client;
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tracing::warn;
use uuid::Uuid;

/// Tracks which users have already fired `session_active` today.
/// Key: `"user_id:YYYY-MM-DD"`, Value: `()`.
#[derive(Clone)]
pub struct MixpanelTracker {
    token: String,
    client: Client,
    seen_today: Arc<DashMap<String, ()>>,
    share_opens_seen_today: Arc<DashMap<String, ()>>,
    /// Most recent non-empty client metadata seen per `user_id`. Lets a
    /// header-less request that wins the daily `session_active` dedup
    /// still report a real `app_version` / `platform` instead of
    /// `"(not set)"`.
    last_client_meta: Arc<DashMap<String, ClientMeta>>,
}

/// Cap on `last_client_meta` to bound memory. On overflow the map is
/// cleared wholesale (cheap and rare); entries repopulate from each
/// active user's next request.
const MAX_CLIENT_META_ENTRIES: usize = 100_000;

/// Last-known client metadata for a user, used as a fallback when the
/// triggering request omits the `X-App-Version` / `X-App-Platform`
/// headers.
#[derive(Clone, Default)]
struct ClientMeta {
    app_version: Option<String>,
    platform: Option<String>,
}

impl MixpanelTracker {
    /// Create a new tracker. Returns `None` if the token is empty
    /// (dev/preview environments).
    pub(crate) fn new(token: &str) -> Option<Self> {
        let token = token.trim().to_string();
        if token.is_empty() {
            return None;
        }
        Some(Self {
            token,
            client: Client::new(),
            seen_today: Arc::new(DashMap::new()),
            share_opens_seen_today: Arc::new(DashMap::new()),
            last_client_meta: Arc::new(DashMap::new()),
        })
    }

    /// Fire `session_active` for this user if it hasn't been fired
    /// today. Safe to call on every request — deduplicates internally.
    ///
    /// `app_version` / `platform` come from the `X-App-Version` /
    /// `X-App-Platform` headers the client sends on every API call. They
    /// are attached so the server-emitted `session_active` carries the
    /// same `app_version` super-property the client SDK sets — otherwise
    /// Mixpanel reports these events as `app_version = "(not set)"`.
    ///
    /// `client_ip` is the end-user's IP (from `X-Forwarded-For` /
    /// `X-Real-IP`). When present it is attached as the `ip` property so
    /// Mixpanel geolocates the event to the *user's* country
    /// (`$country_code` / `$region` / `$city`) instead of the server's
    /// IP. The IP is used transiently by Mixpanel for geo lookup and is
    /// not persisted as an event property (matching the client SDK's
    /// `ip: true` behavior).
    ///
    /// `user_agent` is the request `User-Agent`. We derive Mixpanel's
    /// reserved `$os` from it so server-emitted events bucket into the
    /// same OS slices the browser SDK reports — otherwise they show up as
    /// `$os = "(not set)"`.
    pub(crate) fn track_session_active(
        &self,
        user_id: &str,
        app_version: Option<&str>,
        platform: Option<&str>,
        client_ip: Option<&str>,
        user_agent: Option<&str>,
    ) {
        let version = sanitize_client_header(app_version);
        let platform = sanitize_client_header(platform);

        // Remember the latest non-empty metadata for this user *before*
        // the daily dedup so a later header-less request can still recover
        // a real version. Refreshes on every call, not just the first.
        self.remember_client_meta(user_id, version.as_deref(), platform.as_deref());

        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let key = format!("{user_id}:{today}");

        if self.seen_today.contains_key(&key) {
            return;
        }
        self.seen_today.insert(key, ());

        // Evict stale entries from previous days to prevent unbounded
        // growth. Runs inline but is O(n) with a small n (active users
        // today). Only runs when we actually insert a new entry.
        self.seen_today.retain(|k, _| k.ends_with(&today));

        // Fall back to the user's last-known metadata when this request
        // carried no `X-App-Version` / `X-App-Platform` (e.g. a native
        // WebSocket / `<img>` ticket redeem). Keeps the daily event off
        // the `"(not set)"` slice regardless of which request wins.
        let meta = self.client_meta(user_id);
        let version = version.or(meta.app_version);
        let platform = platform.or(meta.platform);

        let properties = build_session_active_properties(version, platform, client_ip, user_agent);

        self.enqueue_event("session_active", user_id.to_string(), properties);
    }

    /// Record the latest non-empty client metadata for a user. Empty
    /// updates are ignored so a header-less request never wipes a known
    /// value. Clears the map wholesale if it grows past
    /// [`MAX_CLIENT_META_ENTRIES`] to keep memory bounded.
    fn remember_client_meta(&self, user_id: &str, version: Option<&str>, platform: Option<&str>) {
        if version.is_none() && platform.is_none() {
            return;
        }
        if self.last_client_meta.len() >= MAX_CLIENT_META_ENTRIES
            && !self.last_client_meta.contains_key(user_id)
        {
            self.last_client_meta.clear();
        }
        let mut entry = self
            .last_client_meta
            .entry(user_id.to_string())
            .or_default();
        if let Some(version) = version {
            entry.app_version = Some(version.to_string());
        }
        if let Some(platform) = platform {
            entry.platform = Some(platform.to_string());
        }
    }

    /// Snapshot the last-known client metadata for a user (empty when the
    /// user has never sent a versioned request).
    fn client_meta(&self, user_id: &str) -> ClientMeta {
        self.last_client_meta
            .get(user_id)
            .map(|entry| entry.clone())
            .unwrap_or_default()
    }

    /// Fire a generic Mixpanel event with JSON-object properties.
    ///
    /// The server adds Mixpanel's required metadata (`distinct_id`,
    /// project token, timestamp, insert id, and library marker). Calls
    /// are non-fatal: events are sent on a background task and failures
    /// are logged as warnings.
    pub(crate) fn track_event(
        &self,
        event: &str,
        distinct_id: impl Into<String>,
        properties: Value,
    ) {
        self.enqueue_event(event, distinct_id.into(), value_to_properties(properties));
    }

    /// Fire `share_link_opened` at most once per share token per UTC day.
    ///
    /// The raw capability token is used only to build an in-memory
    /// fingerprint for deduplication. It is never logged or sent to
    /// Mixpanel.
    pub(crate) fn track_share_link_opened(
        &self,
        token: &str,
        session_id: &str,
        has_content: bool,
        event_count: Option<u32>,
        user_agent: Option<&str>,
    ) {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let Some(fingerprint) = self.mark_share_opened_for_day(token, &today) else {
            return;
        };

        let mut properties = Map::new();
        properties.insert("session_id".to_string(), json!(session_id));
        properties.insert("has_content".to_string(), json!(has_content));
        if let Some(event_count) = event_count {
            properties.insert("event_count".to_string(), json!(event_count));
        }
        if let Some(os) = os_from_user_agent(user_agent) {
            properties.insert("$os".to_string(), json!(os));
        }

        self.enqueue_event(
            "share_link_opened",
            format!("share:{fingerprint}"),
            properties,
        );
    }

    fn mark_share_opened_for_day(&self, token: &str, today: &str) -> Option<String> {
        let fingerprint = share_token_fingerprint(token);
        let key = share_open_key_for_day(&fingerprint, today);
        if self.share_opens_seen_today.insert(key, ()).is_some() {
            return None;
        }

        self.share_opens_seen_today
            .retain(|key, _| key.starts_with(today));
        Some(fingerprint)
    }

    fn enqueue_event(
        &self,
        event: impl Into<String>,
        distinct_id: String,
        properties: Map<String, Value>,
    ) {
        let client = self.client.clone();
        let token = self.token.clone();
        let event = event.into();
        let time = chrono::Utc::now().timestamp();
        let insert_id = Uuid::new_v4().to_string();
        let payload =
            build_event_payload(&token, &event, &distinct_id, properties, time, insert_id);

        tokio::spawn(async move {
            post_mixpanel_payload(client, payload, event).await;
        });
    }
}

/// Build the property map for a server-emitted `session_active` event.
///
/// `session_active` is only fired from `require_verified_session`, i.e.
/// after the session has been verified, so the user is authenticated by
/// construction. We stamp `is_authenticated = true` here — the same
/// super-property the client SDK registers — so True DAU broken down by
/// `is_authenticated` does not split server-emitted events into a
/// misleading `false`/`"(not set)"` bucket. The remaining properties are
/// attached only when present so we never record a misleading value.
fn build_session_active_properties(
    app_version: Option<String>,
    platform: Option<String>,
    client_ip: Option<&str>,
    user_agent: Option<&str>,
) -> Map<String, Value> {
    let mut properties = Map::new();
    properties.insert("is_authenticated".to_string(), json!(true));
    if let Some(version) = app_version {
        properties.insert("app_version".to_string(), json!(version));
    }
    if let Some(platform) = platform {
        properties.insert("platform".to_string(), json!(platform));
    }
    if let Some(ip) = sanitize_client_header(client_ip) {
        properties.insert("ip".to_string(), json!(ip));
    }
    if let Some(os) = os_from_user_agent(user_agent) {
        properties.insert("$os".to_string(), json!(os));
    }
    properties
}

/// Normalize a client-supplied header value before it lands in Mixpanel.
///
/// Header values are attacker-influenced, so we trim whitespace, drop
/// empties, and cap the length to keep a malformed/oversized header from
/// polluting the analytics property. Returns `None` when there is nothing
/// worth recording.
fn sanitize_client_header(value: Option<&str>) -> Option<String> {
    const MAX_LEN: usize = 64;
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_LEN).collect())
}

/// Derive Mixpanel's reserved `$os` property from a request `User-Agent`.
///
/// Mirrors the `os()` detection in the `mixpanel-browser` SDK (the same
/// regex ladder, with case-insensitive matching where the SDK uses `/i`)
/// so server-emitted events bucket into the exact same OS slices as
/// client SDK events. Returns `None` when the UA is missing/empty or the
/// OS is unrecognized, so we never record a misleading value.
pub(crate) fn os_from_user_agent(user_agent: Option<&str>) -> Option<String> {
    let ua = user_agent?.trim();
    if ua.is_empty() {
        return None;
    }
    let lower = ua.to_lowercase();

    let os = if lower.contains("windows") {
        if ua.contains("Phone") || ua.contains("WPDesktop") {
            "Windows Phone"
        } else {
            "Windows"
        }
    } else if ua.contains("iPhone") || ua.contains("iPad") || ua.contains("iPod") {
        "iOS"
    } else if ua.contains("Android") {
        "Android"
    } else if lower.contains("blackberry") || ua.contains("PlayBook") || ua.contains("BB10") {
        "BlackBerry"
    } else if lower.contains("mac") {
        "Mac OS X"
    } else if ua.contains("Linux") {
        "Linux"
    } else if ua.contains("CrOS") {
        "Chrome OS"
    } else {
        return None;
    };

    Some(os.to_string())
}

fn value_to_properties(properties: Value) -> Map<String, Value> {
    match properties {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn build_event_payload(
    token: &str,
    event: &str,
    distinct_id: &str,
    mut properties: Map<String, Value>,
    time: i64,
    insert_id: String,
) -> Value {
    properties.insert("distinct_id".to_string(), json!(distinct_id));
    properties.insert("token".to_string(), json!(token));
    properties.insert("time".to_string(), json!(time));
    properties.insert("$insert_id".to_string(), json!(insert_id));
    properties.insert("mp_lib".to_string(), json!("rust-server"));

    json!([{
        "event": event,
        "properties": properties,
    }])
}

fn share_token_fingerprint(token: &str) -> String {
    blake3::hash(token.as_bytes())
        .to_hex()
        .chars()
        .take(16)
        .collect()
}

fn share_open_key_for_day(fingerprint: &str, today: &str) -> String {
    format!("{today}:{fingerprint}")
}

async fn post_mixpanel_payload(client: Client, payload: Value, event: String) {
    let result = client
        .post("https://api.mixpanel.com/track")
        .header("content-type", "application/json")
        .header("accept", "text/plain")
        .body(payload.to_string())
        .send()
        .await;

    match result {
        Ok(resp) => match resp.text().await {
            Ok(body) if body.trim() == "1" => {}
            Ok(body) => warn!("mixpanel {event} rejected: {body}"),
            Err(err) => warn!("mixpanel {event} response read failed: {err}"),
        },
        Err(err) => {
            warn!("mixpanel {event} request failed: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_tracker() -> MixpanelTracker {
        MixpanelTracker {
            token: "token".to_string(),
            client: Client::new(),
            seen_today: Arc::new(DashMap::new()),
            share_opens_seen_today: Arc::new(DashMap::new()),
            last_client_meta: Arc::new(DashMap::new()),
        }
    }

    #[test]
    fn payload_merges_properties_without_overwriting_metadata_shape() {
        let payload = build_event_payload(
            "project-token",
            "share_link_generated",
            "user-1",
            value_to_properties(json!({
                "session_id": "session-1",
                "reused": true,
            })),
            123,
            "insert-1".to_string(),
        );

        assert_eq!(payload[0]["event"], "share_link_generated");
        assert_eq!(payload[0]["properties"]["distinct_id"], "user-1");
        assert_eq!(payload[0]["properties"]["token"], "project-token");
        assert_eq!(payload[0]["properties"]["time"], 123);
        assert_eq!(payload[0]["properties"]["$insert_id"], "insert-1");
        assert_eq!(payload[0]["properties"]["mp_lib"], "rust-server");
        assert_eq!(payload[0]["properties"]["session_id"], "session-1");
        assert_eq!(payload[0]["properties"]["reused"], true);
    }

    #[test]
    fn session_active_properties_mark_authenticated_and_include_meta() {
        let props = build_session_active_properties(
            Some("0.1.0-nightly.640.1".to_string()),
            Some("desktop".to_string()),
            Some("203.0.113.7"),
            Some("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
        );

        // Server-emitted session_active is always from a verified session,
        // so it must carry is_authenticated=true to match the client SDK.
        assert_eq!(props.get("is_authenticated"), Some(&json!(true)));
        assert_eq!(
            props.get("app_version"),
            Some(&json!("0.1.0-nightly.640.1"))
        );
        assert_eq!(props.get("platform"), Some(&json!("desktop")));
        assert_eq!(props.get("ip"), Some(&json!("203.0.113.7")));
        assert_eq!(props.get("$os"), Some(&json!("Windows")));
    }

    #[test]
    fn session_active_properties_authenticated_even_without_client_meta() {
        // A header-less request (e.g. native WebSocket / <img> ticket redeem)
        // still represents an authenticated user — the is_authenticated stamp
        // must be present even when version / platform / os are unknown.
        let props = build_session_active_properties(None, None, None, None);

        assert_eq!(props.get("is_authenticated"), Some(&json!(true)));
        assert!(props.get("app_version").is_none());
        assert!(props.get("platform").is_none());
        assert!(props.get("ip").is_none());
        assert!(props.get("$os").is_none());
    }

    #[test]
    fn client_ip_property_is_gated_on_sanitized_value() {
        // `track_session_active` only inserts the `ip` property when the
        // sanitized client IP is non-empty, so a present IP is recorded
        // and an absent one is omitted (no misleading geo).
        let mut present = Map::new();
        if let Some(ip) = sanitize_client_header(Some("203.0.113.7")) {
            present.insert("ip".to_string(), json!(ip));
        }
        assert_eq!(present.get("ip"), Some(&json!("203.0.113.7")));

        let mut absent = Map::new();
        if let Some(ip) = sanitize_client_header(None) {
            absent.insert("ip".to_string(), json!(ip));
        }
        assert!(absent.get("ip").is_none());
    }

    #[test]
    fn os_from_user_agent_matches_browser_sdk_buckets() {
        // Electron desktop on macOS -> "Mac OS X" (same value the client
        // SDK reports), so server + client events merge in the $os report.
        assert_eq!(
            os_from_user_agent(Some(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                 (KHTML, like Gecko) aura-os/1.0.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36"
            )),
            Some("Mac OS X".to_string())
        );
        assert_eq!(
            os_from_user_agent(Some(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )),
            Some("Windows".to_string())
        );
        assert_eq!(
            os_from_user_agent(Some(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
            )),
            Some("iOS".to_string())
        );
        assert_eq!(
            os_from_user_agent(Some(
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"
            )),
            Some("Android".to_string())
        );
        assert_eq!(
            os_from_user_agent(Some(
                "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
            )),
            Some("Linux".to_string())
        );

        // Missing / empty / unrecognized UAs record no $os rather than a
        // misleading bucket.
        assert_eq!(os_from_user_agent(None), None);
        assert_eq!(os_from_user_agent(Some("   ")), None);
        assert_eq!(os_from_user_agent(Some("curl/8.4.0")), None);
    }

    #[test]
    fn sanitize_client_header_trims_drops_and_caps() {
        assert_eq!(sanitize_client_header(None), None);
        assert_eq!(sanitize_client_header(Some("   ")), None);
        assert_eq!(
            sanitize_client_header(Some("  0.1.0-nightly.577.1  ")),
            Some("0.1.0-nightly.577.1".to_string())
        );

        let long = "v".repeat(200);
        let sanitized = sanitize_client_header(Some(&long)).expect("non-empty");
        assert_eq!(sanitized.len(), 64);
    }

    #[test]
    fn non_object_properties_become_empty_object() {
        let properties = value_to_properties(json!(["not", "an", "object"]));

        assert!(properties.is_empty());
    }

    #[test]
    fn share_open_key_uses_fingerprint_not_raw_token() {
        let token = "t_1234567890abcdef1234567890abcdef";
        let fingerprint = share_token_fingerprint(token);
        let key = share_open_key_for_day(&fingerprint, "2026-06-01");

        assert!(!fingerprint.contains(token));
        assert!(!key.contains(token));
        assert_eq!(fingerprint.len(), 16);
        assert!(key.starts_with("2026-06-01:"));
    }

    #[test]
    fn share_open_dedupe_marks_only_once_per_day() {
        let tracker = test_tracker();
        let token = "t_1234567890abcdef1234567890abcdef";

        assert!(tracker
            .mark_share_opened_for_day(token, "2026-06-01")
            .is_some());
        assert!(tracker
            .mark_share_opened_for_day(token, "2026-06-01")
            .is_none());
        assert!(tracker
            .mark_share_opened_for_day(token, "2026-06-02")
            .is_some());
    }

    #[test]
    fn last_known_client_meta_fills_missing_values() {
        let tracker = test_tracker();

        // A versioned request records the metadata...
        tracker.remember_client_meta("user-1", Some("0.1.0-nightly.636.1"), Some("desktop"));
        // ...and a later header-less request must not wipe it.
        tracker.remember_client_meta("user-1", None, None);

        let meta = tracker.client_meta("user-1");
        assert_eq!(meta.app_version.as_deref(), Some("0.1.0-nightly.636.1"));
        assert_eq!(meta.platform.as_deref(), Some("desktop"));

        // Each field updates independently when only one is present.
        tracker.remember_client_meta("user-1", Some("0.1.0-nightly.637.1"), None);
        let meta = tracker.client_meta("user-1");
        assert_eq!(meta.app_version.as_deref(), Some("0.1.0-nightly.637.1"));
        assert_eq!(meta.platform.as_deref(), Some("desktop"));

        // Unknown users have no metadata to fall back on.
        let empty = tracker.client_meta("user-2");
        assert!(empty.app_version.is_none());
        assert!(empty.platform.is_none());
    }
}
