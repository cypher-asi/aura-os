//! Server adapter for privacy-safe usage signal classification.
//!
//! The scoring rules live in `aura-os-usage-signals`; this module only
//! gathers server facts, maintains a small process-local IP cluster counter,
//! and emits the resulting signal to Mixpanel/storage.

use std::collections::BTreeSet;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use aura_os_core::BillingAccount;
use aura_os_harness::{FilesChanged, SessionUsage};
use aura_os_storage::ProjectStats;
use aura_os_usage_signals::{
    classify_turn, IpClusterBucket, TurnSignalClassification, TurnSignalInput,
};
pub(crate) use aura_os_usage_signals::{AgentBindingSource, TurnRouteKind};
use dashmap::DashMap;
use serde_json::{json, Value};

use crate::handlers::agents::chat::{persist_event, ChatPersistCtx};

static IP_USER_INDEX: LazyLock<DashMap<String, IpClusterEntry>> = LazyLock::new(DashMap::new);

#[derive(Debug, Clone)]
struct IpClusterEntry {
    day: String,
    users: BTreeSet<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct UsageSignalContext {
    pub(crate) user_id: String,
    pub(crate) turn_started_at: Instant,
    pub(crate) route_kind: TurnRouteKind,
    pub(crate) binding_source: AgentBindingSource,
    pub(crate) account_age_days: Option<u32>,
    pub(crate) is_zero_pro: Option<bool>,
    pub(crate) is_access_granted: Option<bool>,
    pub(crate) local_project_count: Option<u32>,
    pub(crate) same_org_project_count: Option<u32>,
    pub(crate) has_project_context: bool,
    pub(crate) has_user_project_instance: bool,
    pub(crate) is_auto_home_only: bool,
    pub(crate) is_plan_mode: bool,
    pub(crate) is_cross_agent: bool,
    pub(crate) is_council: bool,
    pub(crate) is_new_session: bool,
    pub(crate) attachment_count: u32,
    pub(crate) installed_tool_count: u32,
    pub(crate) installed_integration_count: u32,
    /// Short hash of the public client IP. Raw IP addresses are never
    /// stored in this module or sent to Mixpanel.
    pub(crate) client_ip_hash: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct CompletedTurnMetrics {
    pub(crate) tool_use_count: u32,
    pub(crate) files_changed_count: u32,
}

pub(crate) fn hash_client_ip(ip: &str) -> String {
    blake3::hash(ip.as_bytes())
        .to_hex()
        .chars()
        .take(16)
        .collect()
}

pub(crate) fn count_files_changed(files: &FilesChanged) -> u32 {
    files
        .created
        .len()
        .saturating_add(files.modified.len())
        .saturating_add(files.deleted.len())
        .min(u32::MAX as usize) as u32
}

pub(crate) async fn emit_completed_turn_signal(
    ctx: &ChatPersistCtx,
    signal_ctx: Option<&UsageSignalContext>,
    mixpanel: Option<&crate::mixpanel::MixpanelTracker>,
    billing_client: Option<&aura_os_billing::BillingClient>,
    usage: &SessionUsage,
    metrics: CompletedTurnMetrics,
) {
    let Some(signal_ctx) = signal_ctx else {
        return;
    };

    let ip_cluster_bucket = signal_ctx
        .client_ip_hash
        .as_deref()
        .map(|hash| record_ip_user(hash, &signal_ctx.user_id))
        .unwrap_or(IpClusterBucket::Unknown);

    let billing_account = fetch_billing_account(billing_client, &ctx.jwt).await;
    let billing_account_age_days = billing_account.as_ref().and_then(billing_account_age_days);

    let input = TurnSignalInput {
        route_kind: signal_ctx.route_kind,
        binding_source: signal_ctx.binding_source,
        account_age_days: billing_account_age_days.or(signal_ctx.account_age_days),
        is_zero_pro: signal_ctx.is_zero_pro,
        is_access_granted: signal_ctx.is_access_granted,
        has_project_context: signal_ctx.has_project_context,
        has_user_project_instance: signal_ctx.has_user_project_instance,
        is_auto_home_only: signal_ctx.is_auto_home_only,
        is_plan_mode: signal_ctx.is_plan_mode,
        is_cross_agent: signal_ctx.is_cross_agent,
        is_council: signal_ctx.is_council,
        is_new_session: signal_ctx.is_new_session,
        attachment_count: signal_ctx.attachment_count,
        installed_tool_count: signal_ctx.installed_tool_count,
        installed_integration_count: signal_ctx.installed_integration_count,
        tool_use_count: metrics.tool_use_count,
        files_changed_count: metrics.files_changed_count,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        ip_cluster_bucket,
    };
    let classification = classify_turn(&input);
    let project_stats = fetch_project_stats(ctx).await;
    let turn_duration_ms = signal_ctx
        .turn_started_at
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    let payload = signal_payload(
        signal_ctx,
        &input,
        usage,
        &classification,
        project_stats.as_ref(),
        billing_account.as_ref(),
        turn_duration_ms,
    );

    if persist_event(ctx, "turn_usage_signal", payload.clone()).await {
        tracing::debug!(
            session_id = %ctx.session_id,
            project_agent_id = %ctx.project_agent_id,
            risk_bucket = classification.risk_bucket.as_str(),
            "persisted turn usage signal"
        );
    }

    if let Some(mixpanel) = mixpanel {
        mixpanel.track_event(
            crate::mixpanel::EVENT_AGENT_TURN_CLASSIFIED,
            signal_ctx.user_id.clone(),
            payload,
        );
    }
}

async fn fetch_billing_account(
    billing_client: Option<&aura_os_billing::BillingClient>,
    jwt: &str,
) -> Option<BillingAccount> {
    let billing_client = billing_client?;

    match tokio::time::timeout(Duration::from_millis(750), billing_client.get_account(jwt)).await {
        Ok(Ok(account)) => Some(account),
        Ok(Err(error)) => {
            tracing::debug!(error = %error, "usage signal billing account unavailable");
            None
        }
        Err(_) => {
            tracing::debug!("usage signal billing account timed out");
            None
        }
    }
}

async fn fetch_project_stats(ctx: &ChatPersistCtx) -> Option<ProjectStats> {
    match tokio::time::timeout(
        Duration::from_millis(750),
        ctx.storage.get_project_stats(&ctx.project_id, &ctx.jwt),
    )
    .await
    {
        Ok(Ok(stats)) => Some(stats),
        Ok(Err(error)) => {
            tracing::debug!(
                project_id = %ctx.project_id,
                error = %error,
                "usage signal project stats unavailable"
            );
            None
        }
        Err(_) => {
            tracing::debug!(
                project_id = %ctx.project_id,
                "usage signal project stats timed out"
            );
            None
        }
    }
}

fn record_ip_user(ip_hash: &str, user_id: &str) -> IpClusterBucket {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut entry = IP_USER_INDEX
        .entry(ip_hash.to_string())
        .or_insert_with(|| IpClusterEntry {
            day: today.clone(),
            users: BTreeSet::new(),
        });
    if entry.day != today {
        entry.day = today;
        entry.users.clear();
    }
    entry.users.insert(user_id.to_string());
    IpClusterBucket::from_distinct_users(Some(entry.users.len()))
}

fn signal_payload(
    signal_ctx: &UsageSignalContext,
    input: &TurnSignalInput,
    usage: &SessionUsage,
    classification: &TurnSignalClassification,
    project_stats: Option<&ProjectStats>,
    billing_account: Option<&BillingAccount>,
    turn_duration_ms: u64,
) -> Value {
    let mut payload = json!({
        "turn_duration_ms": turn_duration_ms,
        "route_kind": input.route_kind.as_str(),
        "binding_source": input.binding_source.as_str(),
        "account_age_days": input.account_age_days,
        "account_age_bucket": account_age_bucket(input.account_age_days),
        "is_zero_pro": input.is_zero_pro,
        "is_access_granted": input.is_access_granted,
        "local_project_count": signal_ctx.local_project_count,
        "same_org_project_count": signal_ctx.same_org_project_count,
        "risk_bucket": classification.risk_bucket.as_str(),
        "agentic_score": classification.agentic_score,
        "generic_chat_score": classification.generic_chat_score,
        "usage_shape": classification.usage_shape.as_str(),
        "quota_review_candidate": classification.quota_review_candidate,
        "reasons": classification.reasons,
        "tool_use_count": input.tool_use_count,
        "files_changed_count": input.files_changed_count,
        "input_tokens": input.input_tokens,
        "output_tokens": input.output_tokens,
        "estimated_context_tokens": usage.estimated_context_tokens,
        "context_utilization": usage.context_utilization,
        "cache_creation_input_tokens": usage.cache_creation_input_tokens,
        "cache_read_input_tokens": usage.cache_read_input_tokens,
        "model": usage.model.as_str(),
        "provider": usage.provider.as_str(),
        "has_project_context": input.has_project_context,
        "has_user_project_instance": input.has_user_project_instance,
        "is_auto_home_only": input.is_auto_home_only,
        "is_plan_mode": input.is_plan_mode,
        "is_cross_agent": input.is_cross_agent,
        "is_council": input.is_council,
        "is_new_session": input.is_new_session,
        "attachment_count": input.attachment_count,
        "installed_tool_count": input.installed_tool_count,
        "installed_integration_count": input.installed_integration_count,
        "ip_cluster_bucket": input.ip_cluster_bucket.as_str(),
    });

    if let Some(obj) = payload.as_object_mut() {
        obj.insert(
            "current_project_total_sessions".to_string(),
            json!(project_stats.map(|stats| stats.total_sessions)),
        );
        obj.insert(
            "current_project_total_tasks".to_string(),
            json!(project_stats.map(|stats| stats.total_tasks)),
        );
        obj.insert(
            "current_project_total_specs".to_string(),
            json!(project_stats.map(|stats| stats.total_specs)),
        );
        obj.insert(
            "current_project_total_events".to_string(),
            json!(project_stats.map(|stats| stats.total_events)),
        );
        obj.insert(
            "current_project_total_agents".to_string(),
            json!(project_stats.map(|stats| stats.total_agents)),
        );
        obj.insert(
            "current_project_total_tokens".to_string(),
            json!(project_stats.map(|stats| stats.total_tokens)),
        );
        obj.insert(
            "current_project_lines_changed".to_string(),
            json!(project_stats.map(|stats| stats.lines_changed)),
        );
        obj.insert(
            "current_project_total_time_seconds".to_string(),
            json!(project_stats.map(|stats| stats.total_time_seconds)),
        );
        insert_billing_fields(obj, billing_account);
    }

    payload
}

fn insert_billing_fields(
    obj: &mut serde_json::Map<String, Value>,
    billing_account: Option<&BillingAccount>,
) {
    let billing_account_age_days = billing_account.and_then(billing_account_age_days);
    obj.insert(
        "billing_account_age_days".to_string(),
        json!(billing_account_age_days),
    );
    obj.insert(
        "billing_account_age_bucket".to_string(),
        json!(account_age_bucket(billing_account_age_days)),
    );
    obj.insert(
        "billing_plan".to_string(),
        json!(billing_account.map(|account| account.plan.as_str())),
    );
    obj.insert(
        "billing_balance_cents".to_string(),
        json!(billing_account.map(|account| account.balance_cents)),
    );
    obj.insert(
        "billing_lifetime_purchased_cents".to_string(),
        json!(billing_account.map(|account| account.lifetime_purchased_cents)),
    );
    obj.insert(
        "billing_lifetime_granted_cents".to_string(),
        json!(billing_account.map(|account| account.lifetime_granted_cents)),
    );
    obj.insert(
        "billing_lifetime_used_cents".to_string(),
        json!(billing_account.map(|account| account.lifetime_used_cents)),
    );
    obj.insert(
        "billing_auto_refill_enabled".to_string(),
        json!(billing_account.map(|account| account.auto_refill_enabled)),
    );
    obj.insert(
        "billing_funding_bucket".to_string(),
        json!(billing_account.map(billing_funding_bucket)),
    );
    obj.insert(
        "billing_grant_usage_bucket".to_string(),
        json!(billing_account.map(billing_grant_usage_bucket)),
    );
    obj.insert(
        "billing_used_to_granted_ratio".to_string(),
        json!(billing_account.and_then(billing_used_to_granted_ratio)),
    );
    obj.insert(
        "billing_used_to_funded_ratio".to_string(),
        json!(billing_account.and_then(billing_used_to_funded_ratio)),
    );
}

fn billing_account_age_days(account: &BillingAccount) -> Option<u32> {
    let created_at = chrono::DateTime::parse_from_rfc3339(&account.created_at)
        .ok()?
        .with_timezone(&chrono::Utc);
    let days = chrono::Utc::now()
        .signed_duration_since(created_at)
        .num_days();
    u32::try_from(days.max(0)).ok()
}

fn billing_funding_bucket(account: &BillingAccount) -> &'static str {
    match (
        account.lifetime_purchased_cents > 0,
        account.lifetime_granted_cents > 0,
    ) {
        (false, false) => "none",
        (false, true) => "grant_only",
        (true, false) => "purchase_only",
        (true, true) => "mixed",
    }
}

fn billing_grant_usage_bucket(account: &BillingAccount) -> &'static str {
    let granted = account.lifetime_granted_cents;
    if granted <= 0 {
        return "no_grants";
    }
    let used = account.lifetime_used_cents.max(0);
    if used == 0 {
        "0"
    } else if used.saturating_mul(4) < granted {
        "lt_25pct"
    } else if used.saturating_mul(4) < granted.saturating_mul(3) {
        "25_75pct"
    } else if used < granted {
        "75_100pct"
    } else {
        "100pct_plus"
    }
}

fn billing_used_to_granted_ratio(account: &BillingAccount) -> Option<f64> {
    (account.lifetime_granted_cents > 0).then_some(
        account.lifetime_used_cents.max(0) as f64 / account.lifetime_granted_cents as f64,
    )
}

fn billing_used_to_funded_ratio(account: &BillingAccount) -> Option<f64> {
    let funded = account
        .lifetime_granted_cents
        .saturating_add(account.lifetime_purchased_cents);
    (funded > 0).then_some(account.lifetime_used_cents.max(0) as f64 / funded as f64)
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct LocalProjectCounts {
    pub(crate) local_project_count: Option<u32>,
    pub(crate) same_org_project_count: Option<u32>,
}

pub(crate) fn local_project_counts(
    state: &crate::state::AppState,
    org_id: Option<&aura_os_core::OrgId>,
) -> LocalProjectCounts {
    let Ok(projects) = state.project_service.list_projects() else {
        return LocalProjectCounts::default();
    };

    let local_project_count = Some(projects.len().min(u32::MAX as usize) as u32);
    let same_org_project_count = org_id.map(|org_id| {
        projects
            .iter()
            .filter(|project| project.org_id == *org_id)
            .count()
            .min(u32::MAX as usize) as u32
    });

    LocalProjectCounts {
        local_project_count,
        same_org_project_count,
    }
}

fn account_age_bucket(days: Option<u32>) -> &'static str {
    match days {
        None => "unknown",
        Some(0) => "0d",
        Some(1) => "1d",
        Some(2..=7) => "2_7d",
        Some(8..=30) => "8_30d",
        Some(31..=90) => "31_90d",
        Some(_) => "91d_plus",
    }
}

pub(crate) fn binding_source_from_project_agents(
    project_agent_id: &str,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> AgentBindingSource {
    let source = matching
        .iter()
        .find(|agent| agent.id == project_agent_id)
        .and_then(|agent| agent.source.as_deref());
    AgentBindingSource::from_wire(source)
}

pub(crate) fn user_visible_binding(source: AgentBindingSource) -> bool {
    source.is_user_visible()
}

pub(crate) fn attachment_count<T>(attachments: &Option<Vec<T>>) -> u32 {
    attachments
        .as_ref()
        .map(|items| items.len().min(u32::MAX as usize) as u32)
        .unwrap_or(0)
}

pub(crate) fn option_vec_len<T>(items: &Option<Vec<T>>) -> u32 {
    items
        .as_ref()
        .map(|items| items.len().min(u32::MAX as usize) as u32)
        .unwrap_or(0)
}

pub(crate) fn client_ip_hash_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    crate::auth_guard::client_ip_from_headers(headers).map(|ip| hash_client_ip(&ip))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use axum::{
        extract::{Path, State},
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use tokio::net::TcpListener;

    #[test]
    fn hashes_ip_without_returning_raw_value() {
        let hash = hash_client_ip("203.0.113.1");
        assert_eq!(hash.len(), 16);
        assert_ne!(hash, "203.0.113.1");
    }

    #[test]
    fn counts_file_mutations_without_paths() {
        let files = FilesChanged {
            created: vec!["a".into()],
            modified: vec!["b".into(), "c".into()],
            deleted: vec![],
            diffs: Vec::new(),
        };
        assert_eq!(count_files_changed(&files), 3);
    }

    #[test]
    fn parses_binding_source_from_selected_project_agent() {
        let selected = aura_os_storage::StorageProjectAgent {
            id: "pa-1".into(),
            source: Some("auto_home".into()),
            project_id: None,
            org_id: None,
            agent_id: None,
            name: None,
            role: None,
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            status: None,
            model: None,
            total_input_tokens: None,
            total_output_tokens: None,
            instance_role: None,
            permissions: None,
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        };

        assert_eq!(
            binding_source_from_project_agents("pa-1", &[selected]),
            AgentBindingSource::AutoHome
        );
    }

    #[tokio::test]
    async fn emit_completed_turn_signal_persists_expected_classification_event() {
        type Requests = Arc<Mutex<Vec<aura_os_storage::CreateSessionEventRequest>>>;

        async fn create_event(
            Path(session_id): Path<String>,
            State(requests): State<Requests>,
            Json(req): Json<aura_os_storage::CreateSessionEventRequest>,
        ) -> axum::response::Response {
            requests.lock().expect("requests lock").push(req.clone());
            Json(aura_os_storage::StorageSessionEvent {
                id: format!("evt-{session_id}"),
                session_id: req.session_id,
                user_id: req.user_id,
                agent_id: req.agent_id,
                sender: req.sender,
                project_id: req.project_id,
                org_id: req.org_id,
                event_type: Some(req.event_type),
                content: req.content,
                created_at: Some("2026-06-22T00:00:00Z".to_string()),
            })
            .into_response()
        }

        async fn project_stats() -> Json<ProjectStats> {
            Json(ProjectStats {
                total_tasks: 2,
                pending_tasks: 0,
                ready_tasks: 1,
                in_progress_tasks: 0,
                blocked_tasks: 0,
                done_tasks: 1,
                failed_tasks: 0,
                completion_percentage: 50.0,
                total_tokens: 4_700,
                total_input_tokens: Some(3_500),
                total_output_tokens: Some(1_200),
                total_events: 3,
                total_agents: 1,
                total_sessions: 1,
                total_time_seconds: 12.5,
                lines_changed: 0,
                total_specs: 1,
                contributors: 1,
                estimated_cost_usd: 0.0,
            })
        }

        async fn billing_account() -> Json<Value> {
            Json(json!({
                "user_id": "user-test",
                "balance_cents": 125,
                "balance_formatted": "$1.25",
                "lifetime_purchased_cents": 0,
                "lifetime_granted_cents": 5_000,
                "lifetime_used_cents": 4_000,
                "plan": "free",
                "auto_refill_enabled": false,
                "created_at": "2026-01-01T00:00:00Z"
            }))
        }

        let requests: Requests = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .route("/api/sessions/:session_id/events", post(create_event))
            .route("/api/stats", get(project_stats))
            .route("/v1/accounts/me", get(billing_account))
            .with_state(requests.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });

        let base_url = format!("http://{addr}");
        let billing = aura_os_billing::BillingClient::with_base_url(base_url.clone());
        let ctx = ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(&base_url)),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "project-agent-test".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };
        let signal_ctx = UsageSignalContext {
            user_id: "user-test".to_string(),
            turn_started_at: Instant::now(),
            route_kind: TurnRouteKind::BareAgent,
            binding_source: AgentBindingSource::AutoHome,
            account_age_days: None,
            is_zero_pro: Some(false),
            is_access_granted: Some(false),
            local_project_count: Some(1),
            same_org_project_count: Some(1),
            has_project_context: true,
            has_user_project_instance: false,
            is_auto_home_only: true,
            is_plan_mode: false,
            is_cross_agent: false,
            is_council: false,
            is_new_session: true,
            attachment_count: 0,
            installed_tool_count: 0,
            installed_integration_count: 0,
            client_ip_hash: Some("usage-signal-test-ip".to_string()),
        };
        let usage = SessionUsage {
            input_tokens: 3_500,
            output_tokens: 1_200,
            model: "claude-test".to_string(),
            provider: "anthropic".to_string(),
            ..Default::default()
        };

        emit_completed_turn_signal(
            &ctx,
            Some(&signal_ctx),
            None,
            Some(&billing),
            &usage,
            CompletedTurnMetrics {
                tool_use_count: 0,
                files_changed_count: 0,
            },
        )
        .await;

        let seen = requests.lock().expect("requests lock");
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].event_type, "turn_usage_signal");
        assert_eq!(seen[0].agent_id.as_deref(), Some("project-agent-test"));
        assert_eq!(seen[0].sender.as_deref(), Some("agent"));

        let payload = seen[0].content.as_ref().expect("signal payload");
        assert_eq!(payload["route_kind"], "bare_agent");
        assert_eq!(payload["binding_source"], "auto_home");
        assert!(payload["account_age_days"].as_u64().is_some());
        assert_eq!(payload["account_age_bucket"], "91d_plus");
        assert_eq!(payload["is_zero_pro"], false);
        assert_eq!(payload["is_access_granted"], false);
        assert!(payload["turn_duration_ms"].as_u64().is_some());
        assert_eq!(payload["local_project_count"], 1);
        assert_eq!(payload["same_org_project_count"], 1);
        assert_eq!(payload["current_project_total_sessions"], 1);
        assert_eq!(payload["current_project_total_tasks"], 2);
        assert_eq!(payload["current_project_total_specs"], 1);
        assert_eq!(payload["current_project_total_events"], 3);
        assert_eq!(payload["current_project_total_agents"], 1);
        assert_eq!(payload["current_project_total_tokens"], 4_700);
        assert_eq!(payload["current_project_lines_changed"], 0);
        assert_eq!(payload["current_project_total_time_seconds"], 12.5);
        assert_eq!(payload["risk_bucket"], "high");
        assert_eq!(payload["usage_shape"], "generic_agent_chat");
        assert_eq!(payload["quota_review_candidate"], true);
        assert_eq!(payload["tool_use_count"], 0);
        assert_eq!(payload["files_changed_count"], 0);
        assert_eq!(payload["model"], "claude-test");
        assert_eq!(payload["provider"], "anthropic");
        assert_eq!(payload["ip_cluster_bucket"], "1");
        assert!(payload["billing_account_age_days"].as_u64().is_some());
        assert_eq!(payload["billing_account_age_bucket"], "91d_plus");
        assert_eq!(payload["billing_plan"], "free");
        assert_eq!(payload["billing_balance_cents"], 125);
        assert_eq!(payload["billing_lifetime_purchased_cents"], 0);
        assert_eq!(payload["billing_lifetime_granted_cents"], 5_000);
        assert_eq!(payload["billing_lifetime_used_cents"], 4_000);
        assert_eq!(payload["billing_auto_refill_enabled"], false);
        assert_eq!(payload["billing_funding_bucket"], "grant_only");
        assert_eq!(payload["billing_grant_usage_bucket"], "75_100pct");
        assert!(
            (payload["billing_used_to_granted_ratio"]
                .as_f64()
                .expect("billing grant usage ratio")
                - 0.8)
                .abs()
                < 0.000_001
        );
        assert!(
            (payload["billing_used_to_funded_ratio"]
                .as_f64()
                .expect("billing funded usage ratio")
                - 0.8)
                .abs()
                < 0.000_001
        );
        assert!(payload["client_ip_hash"].is_null());
        assert!(payload["raw_ip"].is_null());
        assert!(payload["reasons"]
            .as_array()
            .expect("reasons array")
            .iter()
            .any(|reason| reason == "bare_agent_auto_home_only"));
    }
}
