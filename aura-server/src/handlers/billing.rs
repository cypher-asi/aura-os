use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use aura_core::ZeroAuthSession;

use crate::dto::{CreateCreditCheckoutRequest, FulfillmentWebhookRequest, FulfillmentWebhookResponse};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

fn get_auth_session(state: &AppState) -> Result<ZeroAuthSession, (StatusCode, Json<ApiError>)> {
    let bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("not authenticated"))?;
    serde_json::from_slice(&bytes).map_err(|e| ApiError::internal(e.to_string()))
}

fn billing_err(e: aura_billing::BillingError) -> (StatusCode, Json<ApiError>) {
    match e {
        aura_billing::BillingError::ServerError { status, body } => {
            let (sc, code, msg) = match status {
                401 => (StatusCode::UNAUTHORIZED, "unauthorized", "billing token expired or invalid"),
                403 => (StatusCode::FORBIDDEN, "forbidden", "billing server rejected the request"),
                _ => (StatusCode::BAD_GATEWAY, "billing_error", "billing server error"),
            };
            (sc, Json(ApiError { error: msg.to_string(), code: code.to_string(), details: Some(body) }))
        }
        aura_billing::BillingError::Request(_) => {
            (StatusCode::BAD_GATEWAY, Json(ApiError {
                error: "unable to reach billing server".to_string(),
                code: "billing_unreachable".to_string(),
                details: Some(e.to_string()),
            }))
        }
        _ => ApiError::internal(e.to_string()),
    }
}

pub async fn get_credit_tiers(
    State(state): State<AppState>,
    Path(_org_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    match state.billing_client.get_tiers().await {
        Ok(tiers) => Ok(Json(serde_json::to_value(tiers).unwrap_or_default())),
        Err(e) => Err(billing_err(e)),
    }
}

pub async fn get_credit_balance(
    State(state): State<AppState>,
    Path(_org_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let session = get_auth_session(&state)?;
    match state
        .billing_client
        .get_balance(&session.access_token)
        .await
    {
        Ok(balance) => Ok(Json(serde_json::to_value(balance).unwrap_or_default())),
        Err(e) => Err(billing_err(e)),
    }
}

pub async fn create_credit_checkout(
    State(state): State<AppState>,
    Path(_org_id): Path<String>,
    Json(body): Json<CreateCreditCheckoutRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let session = get_auth_session(&state)?;
    match state
        .billing_client
        .create_checkout_session(
            &session.access_token,
            body.tier_id,
            body.credits,
        )
        .await
    {
        Ok(resp) => Ok(Json(serde_json::to_value(resp).unwrap_or_default())),
        Err(e) => Err(billing_err(e)),
    }
}

pub async fn handle_fulfillment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<FulfillmentWebhookRequest>,
) -> ApiResult<Json<FulfillmentWebhookResponse>> {
    let token = headers
        .get("x-internal-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !state.billing_client.verify_internal_token(token) {
        return Err(ApiError::unauthorized("invalid internal token"));
    }

    tracing::info!(
        entity_id = %body.entity_id,
        credits = body.credits,
        purchase_id = %body.purchase_id,
        "Fulfillment webhook received"
    );

    // Broadcast a credits-updated event via WebSocket so frontend can update
    let _ = state.event_broadcast.send(aura_engine::EngineEvent::LogLine {
        message: format!(
            "Credits fulfilled: {} credits for entity {}",
            body.credits, body.entity_id
        ),
    });

    Ok(Json(FulfillmentWebhookResponse {
        ok: true,
        error: None,
    }))
}
