use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{BillingAccount, OrgId, TransactionsResponse};

use crate::dto::CreateCreditCheckoutRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

fn billing_err(e: aura_os_billing::BillingError) -> (StatusCode, Json<ApiError>) {
    match e {
        aura_os_billing::BillingError::InsufficientCredits { balance_cents } => {
            ApiError::payment_required(format!(
                "Insufficient credits (balance: {balance_cents} cents). Please purchase credits to continue."
            ))
        }
        aura_os_billing::BillingError::ServerError { status, body } => {
            let (sc, code, msg) = match status {
                401 => (StatusCode::UNAUTHORIZED, "unauthorized", "billing token expired or invalid"),
                403 => (StatusCode::FORBIDDEN, "forbidden", "billing server rejected the request"),
                _ => (StatusCode::BAD_GATEWAY, "billing_error", "billing server error"),
            };
            (sc, Json(ApiError { error: msg.to_string(), code: code.to_string(), details: Some(body) }))
        }
        aura_os_billing::BillingError::Request(_) => {
            (StatusCode::BAD_GATEWAY, Json(ApiError {
                error: "unable to reach billing server".to_string(),
                code: "billing_unreachable".to_string(),
                details: Some(e.to_string()),
            }))
        }
        _ => ApiError::internal(format!("billing operation failed: {e}")),
    }
}

/// Pre-flight check: ensures the authenticated user has a positive credit balance.
///
/// Results are cached for 60 seconds when credits are available to avoid
/// hitting the billing API on every chat message.
pub(crate) async fn require_credits(
    state: &AppState,
    jwt: &str,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    use crate::state::CreditCache;
    use std::time::{Duration, Instant};

    const CACHE_TTL: Duration = Duration::from_secs(60);

    {
        let cache = state.credit_cache.lock().await;
        if let Some(ref c) = *cache {
            if c.has_credits && c.last_check.elapsed() < CACHE_TTL {
                return Ok(());
            }
        }
    }

    let result = state.billing_client.ensure_has_credits(jwt).await;

    let has_credits = result.is_ok();
    {
        let mut cache = state.credit_cache.lock().await;
        *cache = Some(CreditCache {
            last_check: Instant::now(),
            has_credits,
        });
    }

    result.map_err(billing_err)?;
    Ok(())
}

pub(crate) async fn require_credits_for_auth_source(
    state: &AppState,
    jwt: &str,
    auth_source: &str,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    if auth_source == "aura_managed" {
        require_credits(state, jwt).await
    } else {
        Ok(())
    }
}

pub(crate) async fn get_credit_balance(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
) -> ApiResult<Json<serde_json::Value>> {
    let balance = state
        .billing_client
        .get_balance(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(serde_json::to_value(balance).unwrap_or_default()))
}

pub(crate) async fn create_credit_checkout(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
    Json(body): Json<CreateCreditCheckoutRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let resp = state
        .billing_client
        .create_purchase(&jwt, body.amount_usd)
        .await
        .map_err(billing_err)?;
    Ok(Json(serde_json::to_value(resp).unwrap_or_default()))
}

pub(crate) async fn get_transactions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
) -> ApiResult<Json<TransactionsResponse>> {
    let result = state
        .billing_client
        .get_transactions(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(result))
}

pub(crate) async fn get_account(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
) -> ApiResult<Json<BillingAccount>> {
    let result = state
        .billing_client
        .get_account(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(result))
}
