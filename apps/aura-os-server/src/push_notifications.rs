use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aura_os_store::{BatchOp, SettingsStore};
use chrono::{DateTime, Utc};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex};
use tracing::{debug, info, warn};

const PUSH_DEVICES_CF: &str = "push_devices";
const ANDROID_CHANNEL_ID: &str = "aura_agent_updates";
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_MARGIN: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PushPlatform {
    Android,
    Ios,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PushDeviceRegistration {
    pub token: String,
    pub platform: PushPlatform,
    #[serde(default)]
    pub app_version: Option<String>,
    #[serde(default)]
    pub enabled_kinds: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StoredPushDevice {
    pub user_id: String,
    pub token: String,
    pub platform: PushPlatform,
    pub app_version: Option<String>,
    pub enabled_kinds: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PushNotification {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub route: Option<String>,
}

#[derive(Clone)]
pub struct PushNotificationService {
    store: Arc<SettingsStore>,
    fcm: Option<Arc<FcmClient>>,
}

impl PushNotificationService {
    pub fn disabled(store: Arc<SettingsStore>) -> Self {
        Self { store, fcm: None }
    }

    pub fn from_env(store: Arc<SettingsStore>, http: reqwest::Client) -> Self {
        let fcm = FcmClient::from_env(http).map(Arc::new);
        if fcm.is_some() {
            info!("Firebase Cloud Messaging delivery enabled");
        } else {
            warn!(
                "Firebase service account is not configured; push device registration is enabled but background delivery is disabled"
            );
        }
        Self { store, fcm }
    }

    pub fn delivery_configured(&self) -> bool {
        self.fcm.is_some()
    }

    pub fn register(
        &self,
        user_id: &str,
        registration: PushDeviceRegistration,
    ) -> Result<StoredPushDevice, String> {
        validate_registration(&registration)?;
        let record = StoredPushDevice {
            user_id: user_id.to_string(),
            token: registration.token,
            platform: registration.platform,
            app_version: registration.app_version,
            enabled_kinds: registration.enabled_kinds,
            updated_at: Utc::now(),
        };
        let key = device_key(&record.token);
        let value = serde_json::to_vec(&record).map_err(|error| error.to_string())?;
        self.store
            .put_cf_bytes(PUSH_DEVICES_CF, key.as_bytes(), &value)
            .map_err(|error| error.to_string())?;
        Ok(record)
    }

    pub fn unregister(&self, user_id: &str, token: &str) -> Result<bool, String> {
        let key = device_key(token);
        let Some(raw) = self
            .store
            .get_cf_bytes(PUSH_DEVICES_CF, key.as_bytes())
            .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        let device: StoredPushDevice =
            serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
        if device.user_id != user_id || device.token != token {
            return Ok(false);
        }
        self.store
            .write_batch(vec![BatchOp::Delete {
                cf: PUSH_DEVICES_CF.to_string(),
                key,
            }])
            .map_err(|error| error.to_string())?;
        Ok(true)
    }

    pub fn devices_for_user(&self, user_id: &str, kind: &str) -> Vec<StoredPushDevice> {
        self.store
            .scan_cf_all::<StoredPushDevice>(PUSH_DEVICES_CF)
            .unwrap_or_default()
            .into_iter()
            .filter(|device| {
                device.user_id == user_id
                    && device.enabled_kinds.iter().any(|enabled| enabled == kind)
            })
            .collect()
    }

    pub async fn deliver_to_user(&self, user_id: &str, notification: &PushNotification) {
        let Some(fcm) = &self.fcm else {
            return;
        };
        for device in self.devices_for_user(user_id, &notification.kind) {
            if let Err(error) = fcm.send(&device.token, notification).await {
                warn!(
                    user_id,
                    kind = notification.kind,
                    error,
                    "failed to deliver mobile push notification"
                );
            }
        }
    }
}

pub fn spawn_push_dispatcher(
    service: Arc<PushNotificationService>,
    mut events: broadcast::Receiver<Value>,
) {
    tokio::spawn(async move {
        let mut seen = HashSet::new();
        loop {
            let event = match events.recv().await {
                Ok(event) => event,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(skipped, "push dispatcher lagged behind the event stream");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            };
            let Some((user_id, notification)) = classify_event(&event) else {
                continue;
            };
            let dedupe_key = format!("{user_id}:{}", notification.id);
            if !seen.insert(dedupe_key) {
                continue;
            }
            if seen.len() > 4_096 {
                seen.clear();
            }
            service.deliver_to_user(&user_id, &notification).await;
        }
    });
}

pub fn classify_event(event: &Value) -> Option<(String, PushNotification)> {
    let event_type = event.get("type")?.as_str()?;
    let user_id = event
        .get("user_id")
        .and_then(Value::as_str)
        .or_else(|| event.pointer("/loop_id/user_id").and_then(Value::as_str))?
        .to_string();
    let notification = match event_type {
        "task_completed" => task_notification(event, "task_completed", "Task complete", false)?,
        "task_failed" => task_notification(event, "task_failed", "Task failed", true)?,
        "task_retrying" => task_notification(event, "task_retrying", "Task retrying", true)?,
        "loop_ended" => loop_notification(event)?,
        "project_push_stuck" => project_push_stuck_notification(event)?,
        "tool_approval_prompt" => approval_notification(event)?,
        _ => return None,
    };
    Some((user_id, notification))
}

fn task_notification(
    event: &Value,
    kind: &str,
    title: &str,
    include_reason: bool,
) -> Option<PushNotification> {
    let task_id = field(event, "task_id")?;
    let task_title = field(event, "task_title");
    let fallback = match kind {
        "task_completed" => "A task finished successfully.",
        "task_failed" => "A task failed and needs attention.",
        _ => "Aura is retrying a task.",
    };
    let mut body = task_title.unwrap_or(fallback).to_string();
    if include_reason {
        if let Some(reason) = field(event, "reason") {
            body.push_str(": ");
            body.push_str(reason);
        }
    }
    let suffix = if kind == "task_retrying" {
        scalar_field(event, "attempt").unwrap_or_else(|| "0".to_string())
    } else {
        String::new()
    };
    Some(PushNotification {
        id: format!("{kind}:{task_id}:{suffix}"),
        kind: kind.to_string(),
        title: title.to_string(),
        body,
        route: route_for_event(event),
    })
}

fn loop_notification(event: &Value) -> Option<PushNotification> {
    let status = event.pointer("/activity/status")?.as_str()?;
    if !matches!(status, "completed" | "failed" | "cancelled") {
        return None;
    }
    let kind = event.pointer("/loop_id/kind")?.as_str()?;
    let instance = event.pointer("/loop_id/instance")?.as_str()?;
    let label = match kind {
        "task_run" => "Task run",
        "spec_gen" => "Spec generation",
        "process_run" => "Process run",
        _ => "Loop",
    };
    let title = match status {
        "completed" => format!("{label} complete"),
        "cancelled" => format!("{label} cancelled"),
        _ => format!("{label} failed"),
    };
    let body = event
        .pointer("/activity/current_step")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{label} ended with status {status}."));
    Some(PushNotification {
        id: format!("loop_ended:{kind}:{instance}:{status}"),
        kind: "loop_ended".to_string(),
        title,
        body,
        route: route_for_event(event),
    })
}

fn project_push_stuck_notification(event: &Value) -> Option<PushNotification> {
    let project_id = field(event, "project_id")?;
    let body = field(event, "remediation")
        .or_else(|| field(event, "reason"))
        .unwrap_or("A project has repeated push failures.");
    Some(PushNotification {
        id: format!(
            "project_push_stuck:{project_id}:{}",
            field(event, "created_at").unwrap_or("now")
        ),
        kind: "project_push_stuck".to_string(),
        title: "Push needs attention".to_string(),
        body: body.to_string(),
        route: Some(format!("/projects/{project_id}/tasks")),
    })
}

fn approval_notification(event: &Value) -> Option<PushNotification> {
    let request_id = field(event, "request_id")?;
    let tool_name = field(event, "tool_name")?.replace('_', " ");
    Some(PushNotification {
        id: format!("tool_approval:{request_id}"),
        kind: "approval_required".to_string(),
        title: "Agent needs approval".to_string(),
        body: format!("Review {tool_name} before the agent can continue."),
        route: route_for_event(event),
    })
}

fn route_for_event(event: &Value) -> Option<String> {
    let project = field(event, "project_id")
        .or_else(|| event.pointer("/loop_id/project_id").and_then(Value::as_str));
    let instance = field(event, "project_agent_id")
        .or_else(|| field(event, "agent_instance_id"))
        .or_else(|| {
            event
                .pointer("/loop_id/agent_instance_id")
                .and_then(Value::as_str)
        });
    let agent = field(event, "agent_id")
        .or_else(|| event.pointer("/loop_id/agent_id").and_then(Value::as_str));
    let session = field(event, "session_id");
    if let (Some(project), Some(instance)) = (project, instance) {
        let mut route = format!("/projects/{project}/agents/{instance}");
        if let Some(session) = session {
            route.push_str("?session=");
            route.push_str(session);
        }
        return Some(route);
    }
    agent.map(|agent| {
        let mut params = Vec::new();
        if let Some(project) = project {
            params.push(format!("project={project}"));
        }
        if let Some(instance) = instance {
            params.push(format!("instance={instance}"));
        }
        if let Some(session) = session {
            params.push(format!("session={session}"));
        }
        if params.is_empty() {
            format!("/agents/{agent}")
        } else {
            format!("/agents/{agent}?{}", params.join("&"))
        }
    })
}

fn field<'a>(event: &'a Value, key: &str) -> Option<&'a str> {
    event
        .get(key)
        .and_then(Value::as_str)
        .or_else(|| event.get("content")?.get(key).and_then(Value::as_str))
}

fn scalar_field(event: &Value, key: &str) -> Option<String> {
    let value = event.get(key).or_else(|| event.get("content")?.get(key))?;
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn validate_registration(registration: &PushDeviceRegistration) -> Result<(), String> {
    let token = registration.token.trim();
    if token.len() < 16 || token.len() > 4_096 {
        return Err("push token must be between 16 and 4096 characters".to_string());
    }
    if registration.enabled_kinds.len() > 32 {
        return Err("too many notification kinds".to_string());
    }
    Ok(())
}

fn device_key(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

#[derive(Clone, Debug, Deserialize)]
struct FirebaseServiceAccount {
    project_id: String,
    client_email: String,
    private_key: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

fn default_token_uri() -> String {
    DEFAULT_TOKEN_URI.to_string()
}

fn fcm_messages_endpoint(project_id: &str) -> Result<url::Url, String> {
    if project_id.trim().is_empty() {
        return Err("Firebase project_id must not be empty".to_string());
    }
    let mut endpoint = url::Url::parse("https://fcm.googleapis.com/v1/projects/")
        .map_err(|error| format!("invalid built-in FCM endpoint: {error}"))?;
    endpoint
        .path_segments_mut()
        .map_err(|_| "built-in FCM endpoint cannot contain path segments".to_string())?
        .pop_if_empty()
        .push(project_id)
        .push("messages:send");
    Ok(endpoint)
}

fn validate_google_oauth_token_endpoint(configured: &str) -> Result<(), String> {
    if configured != DEFAULT_TOKEN_URI {
        return Err(format!(
            "Firebase token_uri must be the trusted Google OAuth endpoint {DEFAULT_TOKEN_URI}"
        ));
    }
    Ok(())
}

#[derive(Clone)]
struct FcmClient {
    http: reqwest::Client,
    account: FirebaseServiceAccount,
    token: Arc<Mutex<Option<CachedAccessToken>>>,
}

#[derive(Clone)]
struct CachedAccessToken {
    value: String,
    expires_at: SystemTime,
}

#[derive(Serialize)]
struct ServiceAccountClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: String,
    expires_in: u64,
}

impl FcmClient {
    fn from_env(http: reqwest::Client) -> Option<Self> {
        let raw = std::env::var("AURA_FIREBASE_SERVICE_ACCOUNT_JSON")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                let path = std::env::var("AURA_FIREBASE_SERVICE_ACCOUNT_PATH").ok()?;
                std::fs::read_to_string(path).ok()
            })?;
        let account: FirebaseServiceAccount = match serde_json::from_str(&raw) {
            Ok(account) => account,
            Err(error) => {
                warn!(%error, "invalid Firebase service account configuration");
                return None;
            }
        };
        if let Err(error) = fcm_messages_endpoint(&account.project_id) {
            warn!(%error, "invalid Firebase service account configuration");
            return None;
        }
        if let Err(error) = validate_google_oauth_token_endpoint(&account.token_uri) {
            warn!(%error, "invalid Firebase service account configuration");
            return None;
        }
        Some(Self {
            http,
            account,
            token: Arc::new(Mutex::new(None)),
        })
    }

    async fn send(
        &self,
        device_token: &str,
        notification: &PushNotification,
    ) -> Result<(), String> {
        let access_token = self.access_token().await?;
        let endpoint = fcm_messages_endpoint(&self.account.project_id)?;
        let response = self
            .http
            .post(endpoint)
            .bearer_auth(access_token)
            .json(&fcm_request(device_token, notification))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_success() {
            debug!(kind = notification.kind, "mobile push delivered to FCM");
            return Ok(());
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("FCM returned {status}: {body}"))
    }

    async fn access_token(&self) -> Result<String, String> {
        let mut cached = self.token.lock().await;
        if let Some(token) = cached.as_ref() {
            if token
                .expires_at
                .duration_since(SystemTime::now())
                .unwrap_or_default()
                > TOKEN_REFRESH_MARGIN
            {
                return Ok(token.value.clone());
            }
        }
        validate_google_oauth_token_endpoint(&self.account.token_uri)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        let assertion = encode(
            &Header::new(Algorithm::RS256),
            &ServiceAccountClaims {
                iss: &self.account.client_email,
                scope: FCM_SCOPE,
                aud: DEFAULT_TOKEN_URI,
                iat: now,
                exp: now + 3_600,
            },
            &EncodingKey::from_rsa_pem(self.account.private_key.as_bytes())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
            .append_pair("assertion", &assertion)
            .finish();
        let response = self
            .http
            .post(DEFAULT_TOKEN_URI)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(form)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Firebase OAuth returned {status}: {body}"));
        }
        let response: AccessTokenResponse =
            response.json().await.map_err(|error| error.to_string())?;
        let expires_at = SystemTime::now() + Duration::from_secs(response.expires_in);
        *cached = Some(CachedAccessToken {
            value: response.access_token.clone(),
            expires_at,
        });
        Ok(response.access_token)
    }
}

fn fcm_request(device_token: &str, notification: &PushNotification) -> Value {
    let mut data = json!({
        "id": notification.id,
        "kind": notification.kind,
    });
    if let Some(route) = &notification.route {
        data["route"] = Value::String(route.clone());
    }
    json!({
        "message": {
            "token": device_token,
            "notification": {
                "title": notification.title,
                "body": notification.body,
            },
            "data": data,
            "android": {
                "priority": "high",
                "notification": {
                    "channel_id": ANDROID_CHANNEL_ID
                }
            },
            "apns": {
                "payload": { "aps": { "sound": "default" } }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registration(token: &str) -> PushDeviceRegistration {
        PushDeviceRegistration {
            token: token.to_string(),
            platform: PushPlatform::Android,
            app_version: Some("1.0.0".to_string()),
            enabled_kinds: vec!["task_completed".to_string()],
        }
    }

    #[test]
    fn classifies_approval_with_exact_session_route() {
        let event = json!({
            "type": "tool_approval_prompt",
            "user_id": "user-1",
            "project_id": "project-1",
            "project_agent_id": "instance-1",
            "agent_id": "agent-1",
            "session_id": "session-1",
            "request_id": "approval-1",
            "tool_name": "write_file"
        });
        let (user_id, notification) = classify_event(&event).expect("notification");
        assert_eq!(user_id, "user-1");
        assert_eq!(notification.kind, "approval_required");
        assert_eq!(
            notification.route.as_deref(),
            Some("/projects/project-1/agents/instance-1?session=session-1")
        );
    }

    #[test]
    fn loop_owner_is_read_from_typed_loop_identity() {
        let event = json!({
            "type": "loop_ended",
            "loop_id": {
                "user_id": "user-2",
                "project_id": "project-2",
                "agent_instance_id": "instance-2",
                "agent_id": "agent-2",
                "kind": "automation",
                "instance": "loop-2"
            },
            "activity": { "status": "completed" }
        });
        let (user_id, notification) = classify_event(&event).expect("notification");
        assert_eq!(user_id, "user-2");
        assert_eq!(notification.kind, "loop_ended");
        assert_eq!(
            notification.route.as_deref(),
            Some("/projects/project-2/agents/instance-2")
        );
    }

    #[test]
    fn refuses_events_without_an_account_owner() {
        assert!(classify_event(&json!({
            "type": "task_completed",
            "task_id": "task-1"
        }))
        .is_none());
    }

    #[test]
    fn retry_attempts_produce_distinct_notification_ids() {
        let base = json!({
            "type": "task_retrying",
            "user_id": "user-1",
            "task_id": "task-1",
            "reason": "temporary failure"
        });
        let mut first = base.clone();
        first["attempt"] = json!(1);
        let mut second = base;
        second["attempt"] = json!(2);

        let (_, first) = classify_event(&first).expect("first retry notification");
        let (_, second) = classify_event(&second).expect("second retry notification");
        assert_eq!(first.id, "task_retrying:task-1:1");
        assert_eq!(second.id, "task_retrying:task-1:2");
    }

    #[test]
    fn fcm_payload_uses_default_android_tap_intent_and_keeps_route_data() {
        let request = fcm_request(
            "android-token-1234567890",
            &PushNotification {
                id: "task_completed:task-1:".to_string(),
                kind: "task_completed".to_string(),
                title: "Task complete".to_string(),
                body: "Done".to_string(),
                route: Some("/projects/project-1/agents/instance-1?session=session-1".to_string()),
            },
        );

        assert_eq!(
            request
                .pointer("/message/data/route")
                .and_then(Value::as_str),
            Some("/projects/project-1/agents/instance-1?session=session-1")
        );
        assert_eq!(
            request
                .pointer("/message/android/notification/channel_id")
                .and_then(Value::as_str),
            Some(ANDROID_CHANNEL_ID)
        );
        assert!(request
            .pointer("/message/android/notification/click_action")
            .is_none());
    }

    #[test]
    fn fcm_endpoint_encodes_project_id_inside_a_fixed_https_origin() {
        let endpoint = fcm_messages_endpoint("project/with spaces").expect("FCM endpoint");

        assert_eq!(endpoint.scheme(), "https");
        assert_eq!(endpoint.host_str(), Some("fcm.googleapis.com"));
        assert_eq!(
            endpoint.as_str(),
            "https://fcm.googleapis.com/v1/projects/project%2Fwith%20spaces/messages:send"
        );
    }

    #[test]
    fn oauth_assertions_only_use_the_fixed_google_https_endpoint() {
        assert!(validate_google_oauth_token_endpoint(DEFAULT_TOKEN_URI).is_ok());
        assert!(
            validate_google_oauth_token_endpoint("http://oauth2.googleapis.com/token").is_err()
        );
        assert!(validate_google_oauth_token_endpoint("https://attacker.example/token").is_err());
    }

    #[test]
    fn device_token_ownership_moves_to_the_latest_authenticated_user() {
        let directory = tempfile::tempdir().expect("temporary settings directory");
        let store = Arc::new(SettingsStore::open(directory.path()).expect("settings store"));
        let service = PushNotificationService::disabled(store);
        let token = "android-token-1234567890";

        service
            .register("user-1", registration(token))
            .expect("first registration");
        service
            .register("user-2", registration(token))
            .expect("ownership transfer");

        assert!(service
            .devices_for_user("user-1", "task_completed")
            .is_empty());
        assert_eq!(
            service.devices_for_user("user-2", "task_completed").len(),
            1
        );
        assert!(!service
            .unregister("user-1", token)
            .expect("non-owner unregister"));
        assert!(service
            .unregister("user-2", token)
            .expect("owner unregister"));
    }

    #[test]
    fn empty_preferences_disable_delivery() {
        let directory = tempfile::tempdir().expect("temporary settings directory");
        let store = Arc::new(SettingsStore::open(directory.path()).expect("settings store"));
        let service = PushNotificationService::disabled(store);
        let token = "android-token-1234567890";
        let mut disabled = registration(token);
        disabled.enabled_kinds.clear();

        service
            .register("user-1", disabled)
            .expect("disabled registration");

        assert!(service
            .devices_for_user("user-1", "task_completed")
            .is_empty());
    }
}
