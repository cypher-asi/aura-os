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

pub async fn get_credit_tiers(
    State(state): State<AppState>,
    Path(_org_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    match state.billing_client.get_tiers().await {
        Ok(tiers) => Ok(Json(serde_json::to_value(tiers).unwrap_or_default())),
        Err(e) => Err(ApiError::internal(e.to_string())),
    }
}

pub async fn get_credit_balance(
    State(state): State<AppState>,
    Path(org_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let session = get_auth_session(&state)?;
    match state
        .billing_client
        .get_balance(&session.access_token, &org_id)
        .await
    {
        Ok(balance) => Ok(Json(serde_json::to_value(balance).unwrap_or_default())),
        Err(aura_billing::BillingError::ServerError { status: 401, .. }) => {
            Err(ApiError::unauthorized("billing token expired or invalid"))
        }
        Err(e) => Err(ApiError::internal(e.to_string())),
    }
}

pub async fn create_credit_checkout(
    State(state): State<AppState>,
    Path(org_id): Path<String>,
    Json(body): Json<CreateCreditCheckoutRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let session = get_auth_session(&state)?;
    match state
        .billing_client
        .create_checkout_session(
            &session.access_token,
            &org_id,
            body.tier_id,
            body.custom_credits,
        )
        .await
    {
        Ok(resp) => Ok(Json(serde_json::to_value(resp).unwrap_or_default())),
        Err(aura_billing::BillingError::ServerError { status: 401, .. }) => {
            Err(ApiError::unauthorized("billing token expired or invalid"))
        }
        Err(e) => Err(ApiError::internal(e.to_string())),
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
