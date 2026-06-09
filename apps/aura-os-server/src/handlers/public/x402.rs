//! x402-protected public API surface.
//!
//! This module implements the protocol at the HTTP boundary because the
//! production router is Rust/Axum while the reference x402 middleware
//! packages currently target TypeScript, Go, and Python servers.

use aura_os_billing::LlmUsageQuote;
use aura_os_core::HarnessMode;
use aura_os_harness::{HarnessOutbound, SessionBridge, SessionBridgeTurn, SessionConfig};
use aura_protocol::{AgentPersona, ConversationMessage, SessionUsage};
use axum::extract::State;
use axum::http::header::{CONTENT_TYPE, HOST};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};
use tracing::{debug, warn};
use url::Url;
use uuid::Uuid;

use crate::error::ApiError;
use crate::state::AppState;

const X402_VERSION: u8 = 2;
const X402_EXACT_SCHEME: &str = "exact";
const X402_UPTO_SCHEME: &str = "upto";
const X402_CHAT_ROUTE_PATH: &str = "/api/public/x402/v1/chat/completions";
const PAYMENT_SIGNATURE_HEADER: HeaderName = HeaderName::from_static("payment-signature");
const PAYMENT_REQUIRED_HEADER: HeaderName = HeaderName::from_static("payment-required");
const PAYMENT_RESPONSE_HEADER: HeaderName = HeaderName::from_static("payment-response");
const X_PAYMENT_HEADER: HeaderName = HeaderName::from_static("x-payment");

const PAY_TO_ENV: &str = "AURA_X402_PAY_TO";
const CHAT_PRICE_ENV: &str = "AURA_X402_CHAT_PRICE";
const CHAT_SCHEME_ENV: &str = "AURA_X402_CHAT_SCHEME";
const CHAT_DEFAULT_MODEL_ENV: &str = "AURA_X402_DEFAULT_MODEL";
const CHAT_MODELS_ENV: &str = "AURA_X402_MODELS";
const CHAT_MAX_TOKENS_ENV: &str = "AURA_X402_MAX_TOKENS";
const CHAT_TIMEOUT_ENV: &str = "AURA_X402_CHAT_TIMEOUT_SECONDS";
const NETWORK_ENV: &str = "AURA_X402_NETWORK";
const ASSET_ENV: &str = "AURA_X402_ASSET";
const FACILITATOR_URL_ENV: &str = "AURA_X402_FACILITATOR_URL";
const RESOURCE_BASE_URL_ENV: &str = "AURA_X402_RESOURCE_BASE_URL";
const MAX_TIMEOUT_ENV: &str = "AURA_X402_MAX_TIMEOUT_SECONDS";

const DEFAULT_CHAT_PRICE: &str = "$0.02";
const DEFAULT_CHAT_MODEL: &str = "aura-claude-haiku-4-5";
const DEFAULT_NETWORK: &str = "eip155:84532";
const DEFAULT_ASSET: &str = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_FACILITATOR_URL: &str = "https://x402.org/facilitator";
const DEFAULT_MAX_TIMEOUT_SECONDS: u32 = 60;
const DEFAULT_CHAT_MAX_TOKENS: u32 = 1024;
const MAX_CHAT_MESSAGES: usize = 64;
const MAX_MESSAGE_CHARS: usize = 32_000;
const MAX_TOTAL_MESSAGE_CHARS: usize = 64_000;
const DEFAULT_CHAT_TIMEOUT_SECONDS: u64 = 120;
const USDC_DECIMALS: usize = 6;
const USDC_ATOMIC_UNITS_PER_CENT: u128 = 10_000;

#[derive(Debug, Clone)]
struct X402Config {
    scheme: String,
    pay_to: String,
    price: String,
    network: String,
    asset: String,
    amount: String,
    facilitator_url: String,
    resource_base_url: Option<String>,
    max_timeout_seconds: u32,
}

#[derive(Debug, Clone)]
struct X402ChatConfig {
    payment: X402Config,
    default_model: String,
    allowed_models: Vec<String>,
    max_tokens: u32,
    timeout: Duration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PaymentRequirements {
    scheme: String,
    network: String,
    asset: String,
    amount: String,
    pay_to: String,
    max_timeout_seconds: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    extra: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceInfo {
    url: String,
    description: String,
    mime_type: String,
    service_name: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentRequired {
    x402_version: u8,
    error: String,
    resource: ResourceInfo,
    accepts: Vec<PaymentRequirements>,
    extensions: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentPayload {
    x402_version: u8,
    accepted: PaymentRequirements,
    #[serde(skip, default)]
    raw: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FacilitatorRequest<'a> {
    x402_version: u8,
    payment_payload: &'a Value,
    payment_requirements: &'a PaymentRequirements,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyResponse {
    is_valid: bool,
    #[serde(default)]
    invalid_reason: String,
    #[serde(default)]
    invalid_message: String,
    #[serde(default)]
    payer: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettleResponse {
    success: bool,
    #[serde(default)]
    error_reason: String,
    #[serde(default)]
    error_message: String,
    #[serde(default)]
    payer: String,
    transaction: String,
    network: String,
    #[serde(default)]
    amount: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct OpenAiModelList {
    object: &'static str,
    data: Vec<OpenAiModel>,
}

#[derive(Debug, Serialize)]
struct OpenAiModel {
    id: String,
    object: &'static str,
    created: u64,
    owned_by: &'static str,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatCompletionRequest {
    model: Option<String>,
    messages: Vec<ChatCompletionMessage>,
    #[serde(default)]
    max_tokens: Option<u32>,
    #[serde(default)]
    stream: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ChatCompletionMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionResponse {
    id: String,
    object: &'static str,
    created: i64,
    model: String,
    choices: Vec<ChatCompletionChoice>,
    usage: ChatCompletionUsage,
}

#[derive(Debug, Serialize)]
struct ChatCompletionChoice {
    index: u32,
    message: ChatCompletionMessage,
    finish_reason: String,
}

#[derive(Debug, Serialize, Default)]
struct ChatCompletionUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

struct HarnessChatResult {
    content: String,
    usage: SessionUsage,
    finish_reason: String,
}

struct PaidChatCompletion {
    response: ChatCompletionResponse,
    usage: SessionUsage,
}

struct ValidatedChatRequest {
    model: String,
    max_tokens: u32,
}

enum ChatUsageSettlement {
    Requirements(PaymentRequirements),
    AmountExceedsAuthorization {
        actual_amount: u128,
        authorized_amount: u128,
    },
}

/// `GET /api/public/x402/v1/models` — OpenAI-shaped model discovery for
/// clients that want to call the x402-gated chat/completions route.
///
/// This endpoint is deliberately not payment-gated: agents need to
/// discover available models before deciding whether to pay for a
/// generation request.
pub(crate) async fn public_x402_models(State(_state): State<AppState>) -> Json<OpenAiModelList> {
    Json(OpenAiModelList {
        object: "list",
        data: discover_x402_models(),
    })
}

/// `POST /api/public/x402/v1/chat/completions` — x402-gated,
/// OpenAI-compatible chat-completions facade backed by Aura's
/// harness/router stack.
pub(crate) async fn public_x402_chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: Uri,
    Json(body): Json<ChatCompletionRequest>,
) -> Response {
    let config = match X402ChatConfig::from_env() {
        Ok(config) => config,
        Err(error) => {
            warn!(%error, "x402 chat endpoint requested before x402 was configured");
            return ApiError::service_unavailable(error).into_response();
        }
    };
    match validate_chat_request(&config, &body) {
        Ok(_) => {}
        Err(error) => return error.into_response(),
    }
    let challenge_extensions = bazaar_extension_for_chat(&config);

    let resource = build_chat_resource_info(&config.payment, &headers, &uri);
    let requirements = config.payment.payment_requirements();

    let Some(signature) = payment_signature_header(&headers) else {
        return payment_required_response(
            requirements,
            resource,
            challenge_extensions,
            "Payment required",
        );
    };

    let payment_payload = match decode_payment_payload(signature) {
        Ok(payload) => payload,
        Err(error) => {
            debug!(%error, "x402 payment signature could not be decoded");
            return payment_required_response(
                requirements,
                resource,
                challenge_extensions,
                "Invalid payment",
            );
        }
    };

    if payment_payload.x402_version != X402_VERSION
        || !payment_payload.accepted.matches(&requirements)
    {
        return payment_required_response(
            requirements,
            resource,
            challenge_extensions,
            "No matching payment requirements",
        );
    }

    match verify_payment(
        &state.http_client,
        &config.payment.facilitator_url,
        &payment_payload,
        &requirements,
    )
    .await
    {
        Ok(verify) if verify.is_valid => {
            debug!(payer = %verify.payer, "x402 chat payment verified")
        }
        Ok(verify) => {
            let reason = first_non_empty(&verify.invalid_reason, &verify.invalid_message)
                .unwrap_or("Payment verification failed");
            return payment_required_response(requirements, resource, challenge_extensions, reason);
        }
        Err(error) => {
            warn!(%error, "x402 facilitator verify failed");
            return ApiError::bad_gateway(format!("x402 verification failed: {error}"))
                .into_response();
        }
    }

    let paid_completion = match run_paid_chat_completion(&state, &config, body).await {
        Ok(response) => response,
        Err(error) => return error.into_response(),
    };

    let settlement_requirements = match settlement_requirements_for_chat_usage(
        &state,
        &requirements,
        &paid_completion.usage,
    )
    .await
    {
        Ok(ChatUsageSettlement::Requirements(requirements)) => requirements,
        Ok(ChatUsageSettlement::AmountExceedsAuthorization {
            actual_amount,
            authorized_amount,
        }) => {
            return payment_required_response(
                    requirements,
                    resource,
                    challenge_extensions,
                    format!(
                        "x402 usage cost {actual_amount} exceeds authorized maximum {authorized_amount}"
                    ),
                );
        }
        Err(error) => return error.into_response(),
    };

    let settlement = match settle_payment(
        &state.http_client,
        &config.payment.facilitator_url,
        &payment_payload,
        &settlement_requirements,
    )
    .await
    {
        Ok(settlement) if settlement.success => settlement,
        Ok(settlement) => return settlement_failure_response(settlement),
        Err(error) => {
            warn!(%error, "x402 facilitator settle failed");
            return ApiError::bad_gateway(format!("x402 settlement failed: {error}"))
                .into_response();
        }
    };

    let mut response = Json(paid_completion.response).into_response();
    attach_json_header(&mut response, &PAYMENT_RESPONSE_HEADER, &settlement);
    response
}

impl X402Config {
    fn from_env_with_price_and_scheme(
        price_env: &'static str,
        default_price: &str,
        default_scheme: &str,
        scheme_env: Option<&'static str>,
    ) -> Result<Self, String> {
        let pay_to = read_trimmed_env(PAY_TO_ENV)
            .ok_or_else(|| format!("{PAY_TO_ENV} is required for x402 payments"))?;
        let price = read_trimmed_env(price_env).unwrap_or_else(|| default_price.to_string());
        let scheme = scheme_env
            .and_then(read_trimmed_env)
            .unwrap_or_else(|| default_scheme.to_string());
        if !matches!(scheme.as_str(), X402_EXACT_SCHEME | X402_UPTO_SCHEME) {
            return Err(format!(
                "{} must be exact or upto",
                scheme_env.unwrap_or("x402 scheme")
            ));
        }
        let network = read_trimmed_env(NETWORK_ENV).unwrap_or_else(|| DEFAULT_NETWORK.to_string());
        let asset = read_trimmed_env(ASSET_ENV).unwrap_or_else(|| DEFAULT_ASSET.to_string());
        let amount = dollar_price_to_atomic_units(&price, USDC_DECIMALS)?;
        let facilitator_url =
            read_trimmed_env(FACILITATOR_URL_ENV).unwrap_or_else(|| DEFAULT_FACILITATOR_URL.into());
        validate_base_url(&facilitator_url, FACILITATOR_URL_ENV)?;
        let resource_base_url = read_trimmed_env(RESOURCE_BASE_URL_ENV);
        if let Some(base_url) = &resource_base_url {
            validate_base_url(base_url, RESOURCE_BASE_URL_ENV)?;
        }
        let max_timeout_seconds = read_trimmed_env(MAX_TIMEOUT_ENV)
            .map(|raw| {
                raw.parse::<u32>()
                    .map_err(|_| format!("{MAX_TIMEOUT_ENV} must be an integer"))
            })
            .transpose()?
            .unwrap_or(DEFAULT_MAX_TIMEOUT_SECONDS);

        Ok(Self {
            scheme,
            pay_to,
            price,
            network,
            asset,
            amount,
            facilitator_url,
            resource_base_url,
            max_timeout_seconds,
        })
    }

    fn payment_requirements(&self) -> PaymentRequirements {
        PaymentRequirements {
            scheme: self.scheme.clone(),
            network: self.network.clone(),
            asset: self.asset.clone(),
            amount: self.amount.clone(),
            pay_to: self.pay_to.clone(),
            max_timeout_seconds: self.max_timeout_seconds,
            extra: Some(json!({
                "name": "USDC",
                "version": "2",
            })),
        }
    }
}

impl X402ChatConfig {
    fn from_env() -> Result<Self, String> {
        let payment = X402Config::from_env_with_price_and_scheme(
            CHAT_PRICE_ENV,
            DEFAULT_CHAT_PRICE,
            X402_UPTO_SCHEME,
            Some(CHAT_SCHEME_ENV),
        )?;
        let (default_model, allowed_models) = configured_x402_models();
        if !allowed_models.iter().any(|model| model == &default_model) {
            return Err(format!(
                "{CHAT_DEFAULT_MODEL_ENV} must be included in {CHAT_MODELS_ENV}"
            ));
        }
        let max_tokens = read_trimmed_env(CHAT_MAX_TOKENS_ENV)
            .map(|raw| {
                raw.parse::<u32>()
                    .map_err(|_| format!("{CHAT_MAX_TOKENS_ENV} must be an integer"))
            })
            .transpose()?
            .unwrap_or(DEFAULT_CHAT_MAX_TOKENS);
        if max_tokens == 0 {
            return Err(format!("{CHAT_MAX_TOKENS_ENV} must be greater than 0"));
        }
        let timeout_secs = read_trimmed_env(CHAT_TIMEOUT_ENV)
            .map(|raw| {
                raw.parse::<u64>()
                    .map_err(|_| format!("{CHAT_TIMEOUT_ENV} must be an integer"))
            })
            .transpose()?
            .unwrap_or(DEFAULT_CHAT_TIMEOUT_SECONDS);
        Ok(Self {
            payment,
            default_model,
            allowed_models,
            max_tokens,
            timeout: Duration::from_secs(timeout_secs.max(1)),
        })
    }
}

fn discover_x402_models() -> Vec<OpenAiModel> {
    configured_x402_model_ids()
        .into_iter()
        .map(|id| OpenAiModel {
            id,
            object: "model",
            created: 0,
            owned_by: "aura",
        })
        .collect()
}

fn configured_x402_models() -> (String, Vec<String>) {
    let explicit_models = read_csv_env(CHAT_MODELS_ENV);
    let default_model = read_trimmed_env(CHAT_DEFAULT_MODEL_ENV)
        .or_else(|| explicit_models.first().cloned())
        .unwrap_or_else(|| DEFAULT_CHAT_MODEL.into());
    let mut model_ids = if explicit_models.is_empty() {
        vec![default_model.clone()]
    } else {
        explicit_models
    };
    model_ids.sort();
    model_ids.dedup();
    (default_model, model_ids)
}

fn configured_x402_model_ids() -> Vec<String> {
    configured_x402_models().1
}

async fn run_paid_chat_completion(
    state: &AppState,
    config: &X402ChatConfig,
    body: ChatCompletionRequest,
) -> Result<PaidChatCompletion, (StatusCode, Json<ApiError>)> {
    let validated = validate_chat_request(config, &body)?;

    let (history, turn) = split_chat_turn(body.messages)?;
    let session_config =
        build_public_harness_config(&validated.model, validated.max_tokens, history);
    let harness = state.harness_for(HarnessMode::Local);
    let started = SessionBridge::open_and_send_user_message(
        harness,
        session_config,
        SessionBridgeTurn {
            content: turn,
            tool_hints: None,
            attachments: None,
        },
    )
    .await
    .map_err(|error| ApiError::bad_gateway(format!("x402 chat harness open failed: {error}")))?;

    let result = timeout(
        config.timeout,
        collect_harness_chat_result(started.events_rx),
    )
    .await
    .map_err(|_| ApiError::bad_gateway("x402 chat timed out"))??;
    let usage = result.usage.clone();
    Ok(PaidChatCompletion {
        response: build_chat_completion_response(validated.model, result),
        usage,
    })
}

fn validate_chat_request(
    config: &X402ChatConfig,
    body: &ChatCompletionRequest,
) -> Result<ValidatedChatRequest, (StatusCode, Json<ApiError>)> {
    if body.stream.unwrap_or(false) {
        return Err(ApiError::bad_request(
            "streaming chat completions are not supported on the x402 endpoint yet",
        ));
    }
    if body.messages.is_empty() {
        return Err(ApiError::bad_request("messages must not be empty"));
    }
    if body.messages.len() > MAX_CHAT_MESSAGES {
        return Err(ApiError::bad_request(format!(
            "messages must contain at most {MAX_CHAT_MESSAGES} entries"
        )));
    }
    validate_chat_messages(&body.messages)?;
    validate_final_chat_turn(&body.messages)?;

    let model = body
        .model
        .clone()
        .unwrap_or_else(|| config.default_model.clone());
    if !config
        .allowed_models
        .iter()
        .any(|available| available == &model)
    {
        return Err(ApiError::bad_request(format!(
            "model '{model}' is not available on this x402 endpoint"
        )));
    }
    let max_tokens = body.max_tokens.unwrap_or(config.max_tokens);
    if max_tokens == 0 || max_tokens > config.max_tokens {
        return Err(ApiError::bad_request(format!(
            "max_tokens must be between 1 and {}",
            config.max_tokens
        )));
    }

    Ok(ValidatedChatRequest { model, max_tokens })
}

async fn settlement_requirements_for_chat_usage(
    state: &AppState,
    authorized_requirements: &PaymentRequirements,
    usage: &SessionUsage,
) -> Result<ChatUsageSettlement, (StatusCode, Json<ApiError>)> {
    if authorized_requirements.scheme != X402_UPTO_SCHEME {
        return Ok(ChatUsageSettlement::Requirements(
            authorized_requirements.clone(),
        ));
    }

    let provider = usage.provider.trim();
    let model = usage.model.trim();
    if provider.is_empty() || model.is_empty() {
        return Err(ApiError::bad_gateway(
            "x402 chat usage did not include provider/model for billing quote",
        ));
    }

    let quote = state
        .billing_client
        .quote_llm_usage(LlmUsageQuote {
            provider: provider.to_string(),
            model: model.to_string(),
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            zero_pro_user: false,
        })
        .await
        .map_err(|error| ApiError::bad_gateway(format!("x402 usage quote failed: {error}")))?;

    let actual_amount = cents_to_usdc_atomic_units(quote.cost_cents)
        .map_err(|error| ApiError::bad_gateway(format!("x402 usage quote invalid: {error}")))?;
    let authorized_amount = parse_atomic_units(&authorized_requirements.amount)
        .ok_or_else(|| ApiError::bad_gateway("x402 authorized amount is not a valid integer"))?;

    if actual_amount > authorized_amount {
        return Ok(ChatUsageSettlement::AmountExceedsAuthorization {
            actual_amount,
            authorized_amount,
        });
    }

    let mut settlement = authorized_requirements.clone();
    settlement.amount = actual_amount.to_string();
    Ok(ChatUsageSettlement::Requirements(settlement))
}

fn validate_chat_message(
    message: &ChatCompletionMessage,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    match message.role.as_str() {
        "system" | "developer" | "user" | "assistant" => {}
        _ => {
            return Err(ApiError::bad_request(
                "message role must be system, developer, user, or assistant",
            ))
        }
    }
    if message.content.trim().is_empty() {
        return Err(ApiError::bad_request("message content must not be empty"));
    }
    if message.content.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request(format!(
            "message content must be at most {MAX_MESSAGE_CHARS} characters"
        )));
    }
    Ok(())
}

fn validate_chat_messages(
    messages: &[ChatCompletionMessage],
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let mut total_chars = 0usize;
    for message in messages {
        validate_chat_message(message)?;
        total_chars = total_chars.saturating_add(message.content.chars().count());
    }
    if total_chars > MAX_TOTAL_MESSAGE_CHARS {
        return Err(ApiError::bad_request(format!(
            "message content must total at most {MAX_TOTAL_MESSAGE_CHARS} characters"
        )));
    }
    Ok(())
}

fn split_chat_turn(
    mut messages: Vec<ChatCompletionMessage>,
) -> Result<(Vec<ConversationMessage>, String), (StatusCode, Json<ApiError>)> {
    validate_final_chat_turn(&messages)?;
    let turn = messages.pop().expect("last message exists").content;
    let history = messages
        .into_iter()
        .map(|message| ConversationMessage {
            role: message.role,
            content: message.content,
        })
        .collect();
    Ok((history, turn))
}

fn validate_final_chat_turn(
    messages: &[ChatCompletionMessage],
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let Some(last_user_index) = messages.iter().rposition(|message| message.role == "user") else {
        return Err(ApiError::bad_request(
            "messages must contain at least one user message",
        ));
    };
    if last_user_index != messages.len() - 1 {
        return Err(ApiError::bad_request(
            "the final message must be the user turn to run",
        ));
    }
    Ok(())
}

fn build_public_harness_config(
    model: &str,
    max_tokens: u32,
    conversation_messages: Vec<ConversationMessage>,
) -> SessionConfig {
    let session_id = Uuid::new_v4().to_string();
    SessionConfig {
        model: Some(model.to_string()),
        max_tokens: Some(max_tokens),
        max_turns: Some(1),
        agent_id: Some(format!("x402-public-llm::{session_id}")),
        template_agent_id: Some("x402-public-llm".to_string()),
        user_id: Some("public-guest".to_string()),
        token: None,
        conversation_messages: Some(conversation_messages),
        project_id: Some("x402-public".to_string()),
        aura_session_id: Some(session_id),
        aura_org_id: Some("public".to_string()),
        agent_identity: Some(AgentPersona {
            name: "Aura Public LLM Router".to_string(),
            role: "OpenAI-compatible paid public LLM endpoint".to_string(),
            personality: "Helpful, concise, and safe for external API callers.".to_string(),
        }),
        agent_system_prompt: Some(
            "You are serving an external paid API request through Aura's public x402 LLM router. \
             Answer the caller directly. Do not claim access to private Aura user data, projects, \
             files, tools, or integrations."
                .to_string(),
        ),
        ..Default::default()
    }
}

async fn collect_harness_chat_result(
    mut events_rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
) -> Result<HarnessChatResult, (StatusCode, Json<ApiError>)> {
    let mut content = String::new();
    loop {
        let event = events_rx
            .recv()
            .await
            .map_err(|error| ApiError::bad_gateway(format!("x402 chat stream closed: {error}")))?;
        match event {
            HarnessOutbound::TextDelta(delta) => content.push_str(&delta.text),
            HarnessOutbound::AssistantMessageEnd(end) => {
                return Ok(HarnessChatResult {
                    content,
                    usage: end.usage,
                    finish_reason: normalize_finish_reason(&end.stop_reason),
                });
            }
            HarnessOutbound::Error(error) => {
                return Err(ApiError::bad_gateway(format!(
                    "x402 chat harness error: {}",
                    error.message
                )));
            }
            _ => {}
        }
    }
}

fn normalize_finish_reason(reason: &str) -> String {
    match reason {
        "max_tokens" | "length" => "length",
        "tool_use" => "tool_calls",
        _ => "stop",
    }
    .to_string()
}

fn build_chat_completion_response(
    model: String,
    result: HarnessChatResult,
) -> ChatCompletionResponse {
    let prompt_tokens = result.usage.input_tokens;
    let completion_tokens = result.usage.output_tokens;
    ChatCompletionResponse {
        id: format!("chatcmpl_{}", Uuid::new_v4().simple()),
        object: "chat.completion",
        created: Utc::now().timestamp(),
        model,
        choices: vec![ChatCompletionChoice {
            index: 0,
            message: ChatCompletionMessage {
                role: "assistant".to_string(),
                content: result.content,
            },
            finish_reason: result.finish_reason,
        }],
        usage: ChatCompletionUsage {
            prompt_tokens,
            completion_tokens,
            total_tokens: prompt_tokens.saturating_add(completion_tokens),
        },
    }
}

impl PaymentRequirements {
    fn matches(&self, other: &Self) -> bool {
        self.scheme == other.scheme
            && self.network == other.network
            && self.asset == other.asset
            && self.amount == other.amount
            && self.pay_to == other.pay_to
    }
}

async fn verify_payment(
    client: &reqwest::Client,
    facilitator_url: &str,
    payload: &PaymentPayload,
    requirements: &PaymentRequirements,
) -> Result<VerifyResponse, String> {
    post_facilitator::<VerifyResponse>(
        client,
        facilitator_url,
        "verify",
        &payload.raw,
        requirements,
    )
    .await
}

async fn settle_payment(
    client: &reqwest::Client,
    facilitator_url: &str,
    payload: &PaymentPayload,
    requirements: &PaymentRequirements,
) -> Result<SettleResponse, String> {
    post_facilitator::<SettleResponse>(
        client,
        facilitator_url,
        "settle",
        &payload.raw,
        requirements,
    )
    .await
}

async fn post_facilitator<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    facilitator_url: &str,
    operation: &str,
    payload: &Value,
    requirements: &PaymentRequirements,
) -> Result<T, String> {
    let url = format!("{}/{}", facilitator_url.trim_end_matches('/'), operation);
    let body = FacilitatorRequest {
        x402_version: X402_VERSION,
        payment_payload: payload,
        payment_requirements: requirements,
    };
    let response = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("response read failed: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "facilitator {operation} returned {status}: {}",
            compact_excerpt(&body)
        ));
    }
    serde_json::from_str(&body)
        .map_err(|error| format!("facilitator {operation} returned invalid JSON: {error}"))
}

fn payment_required_response(
    requirements: PaymentRequirements,
    resource: ResourceInfo,
    extensions: Value,
    error: impl Into<String>,
) -> Response {
    let payment_required = PaymentRequired {
        x402_version: X402_VERSION,
        error: error.into(),
        resource,
        accepts: vec![requirements],
        extensions,
    };
    let mut response = (StatusCode::PAYMENT_REQUIRED, Json(&payment_required)).into_response();
    attach_json_header(&mut response, &PAYMENT_REQUIRED_HEADER, &payment_required);
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response
}

fn settlement_failure_response(settlement: SettleResponse) -> Response {
    let reason = first_non_empty(&settlement.error_reason, &settlement.error_message)
        .unwrap_or("x402 settlement failed");
    let mut response = (
        StatusCode::PAYMENT_REQUIRED,
        Json(json!({
            "error": reason,
            "code": "x402_settlement_failed",
        })),
    )
        .into_response();
    attach_json_header(&mut response, &PAYMENT_RESPONSE_HEADER, &settlement);
    response
}

fn build_chat_resource_info(config: &X402Config, headers: &HeaderMap, uri: &Uri) -> ResourceInfo {
    ResourceInfo {
        url: resource_url(config, headers, uri, X402_CHAT_ROUTE_PATH),
        description: "Paid OpenAI-compatible Aura-routed LLM chat completion.".to_string(),
        mime_type: "application/json".to_string(),
        service_name: "Aura OS".to_string(),
        tags: vec![
            "aura".to_string(),
            "llm".to_string(),
            "chat-completions".to_string(),
            "openai-compatible".to_string(),
            "x402".to_string(),
        ],
    }
}

fn resource_url(
    config: &X402Config,
    headers: &HeaderMap,
    uri: &Uri,
    fallback_path: &str,
) -> String {
    if let Some(base_url) = &config.resource_base_url {
        return format!(
            "{}{}",
            base_url.trim_end_matches('/'),
            uri.path_and_query()
                .map(|path| path.as_str())
                .unwrap_or(fallback_path)
        );
    }

    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("http");
    let host = headers
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("localhost");
    let path = uri
        .path_and_query()
        .map(|path| path.as_str())
        .unwrap_or(fallback_path);
    format!("{scheme}://{host}{path}")
}

fn bazaar_extension_for_chat(config: &X402ChatConfig) -> Value {
    let example_max_tokens = config.max_tokens.min(512);
    json!({
        "bazaar": {
            "info": {
                "input": {
                    "type": "http",
                    "method": "POST",
                    "body": {
                        "model": config.default_model,
                        "messages": [
                            {"role": "user", "content": "Summarize x402 in one paragraph."}
                        ],
                        "max_tokens": example_max_tokens
                    },
                    "bodySchema": {
                        "type": "object",
                        "properties": {
                            "model": {
                                "type": "string",
                                "description": "Aura public model id. Discover models with GET /api/public/x402/v1/models."
                            },
                            "messages": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "role": {"type": "string", "enum": ["system", "developer", "user", "assistant"]},
                                        "content": {"type": "string"}
                                    },
                                    "required": ["role", "content"]
                                }
                            },
                            "max_tokens": {"type": "integer", "minimum": 1, "maximum": config.max_tokens},
                            "stream": {"type": "boolean", "description": "Streaming is not supported yet; send false or omit."}
                        },
                        "required": ["messages"]
                    }
                },
                "output": {
                    "type": "json",
                    "example": {
                        "id": "chatcmpl_...",
                        "object": "chat.completion",
                        "model": config.default_model,
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": "x402 is an HTTP-native payment protocol..."},
                                "finish_reason": "stop"
                            }
                        ]
                    }
                }
            }
        }
    })
}

fn decode_payment_payload(signature: &HeaderValue) -> Result<PaymentPayload, String> {
    let signature = signature
        .to_str()
        .map_err(|_| "payment signature header is not UTF-8".to_string())?;
    let bytes = BASE64_STANDARD
        .decode(signature)
        .map_err(|error| format!("payment signature is not base64: {error}"))?;
    let mut payload: PaymentPayload = serde_json::from_slice(&bytes)
        .map_err(|error| format!("payment signature is not valid x402 JSON: {error}"))?;
    payload.raw = serde_json::from_slice(&bytes)
        .map_err(|error| format!("payment payload could not be re-read: {error}"))?;
    Ok(payload)
}

fn payment_signature_header(headers: &HeaderMap) -> Option<&HeaderValue> {
    headers
        .get(&PAYMENT_SIGNATURE_HEADER)
        .or_else(|| headers.get(&X_PAYMENT_HEADER))
}

fn attach_json_header<T: Serialize>(response: &mut Response, name: &HeaderName, value: &T) {
    match serde_json::to_vec(value) {
        Ok(json) => {
            let encoded = BASE64_STANDARD.encode(json);
            match HeaderValue::from_str(&encoded) {
                Ok(header) => {
                    response.headers_mut().insert(name, header);
                }
                Err(error) => warn!(%error, "failed to encode x402 response header"),
            }
        }
        Err(error) => warn!(%error, "failed to serialize x402 response header"),
    }
}

fn dollar_price_to_atomic_units(price: &str, decimals: usize) -> Result<String, String> {
    let price = price.trim();
    let price = price
        .strip_prefix('$')
        .ok_or_else(|| format!("{CHAT_PRICE_ENV} must use dollar syntax like $0.001"))?;
    if price.is_empty() {
        return Err(format!("{CHAT_PRICE_ENV} must not be empty"));
    }
    let mut parts = price.split('.');
    let whole = parts.next().unwrap_or_default();
    let fractional = parts.next().unwrap_or_default();
    if parts.next().is_some() || whole.is_empty() {
        return Err(format!(
            "{CHAT_PRICE_ENV} must be a valid decimal dollar amount"
        ));
    }
    if !whole.chars().all(|c| c.is_ascii_digit()) || !fractional.chars().all(|c| c.is_ascii_digit())
    {
        return Err(format!(
            "{CHAT_PRICE_ENV} must be a valid decimal dollar amount"
        ));
    }

    let mut digits = fractional.chars().take(decimals).collect::<String>();
    while digits.len() < decimals {
        digits.push('0');
    }

    let combined = format!("{whole}{digits}");
    let trimmed = combined.trim_start_matches('0');
    Ok(if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    })
}

fn cents_to_usdc_atomic_units(cents: i64) -> Result<u128, String> {
    let cents = u128::try_from(cents).map_err(|_| "cost_cents must not be negative".to_string())?;
    cents
        .checked_mul(USDC_ATOMIC_UNITS_PER_CENT)
        .ok_or_else(|| "cost_cents is too large".to_string())
}

fn parse_atomic_units(amount: &str) -> Option<u128> {
    amount.parse::<u128>().ok()
}

fn read_trimmed_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_csv_env(key: &str) -> Vec<String> {
    read_trimmed_env(key)
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn validate_base_url(raw: &str, env_key: &str) -> Result<(), String> {
    let url = Url::parse(raw).map_err(|error| format!("{env_key} is invalid: {error}"))?;
    match url.scheme() {
        "http" | "https" => Ok(()),
        _ => Err(format!("{env_key} must use http or https")),
    }
}

fn compact_excerpt(body: &str) -> String {
    const LIMIT: usize = 200;
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() <= LIMIT {
        compact
    } else {
        format!("{}...", &compact[..LIMIT - 3])
    }
}

fn first_non_empty<'a>(a: &'a str, b: &'a str) -> Option<&'a str> {
    [a, b]
        .into_iter()
        .map(str::trim)
        .find(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_harness::test_support::FakeHarness;
    use aura_os_harness::HarnessLink;
    use aura_protocol::{AssistantMessageEnd, FilesChanged, TextDelta};
    use axum::body::{to_bytes, Body};
    use axum::extract::State as AxumState;
    use axum::http::Request;
    use axum::routing::post;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;
    use tower::ServiceExt;

    const PAY_TO: &str = "0x1111111111111111111111111111111111111111";
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env_vars<T>(vars: &[(&'static str, String)], f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let restore = EnvRestore::set(vars);
        let result = f();
        restore.restore();
        result
    }

    struct EnvRestore {
        previous: Option<Vec<(&'static str, Option<String>)>>,
    }

    impl EnvRestore {
        fn set(vars: &[(&'static str, String)]) -> Self {
            let previous = vars
                .iter()
                .map(|(key, _)| (*key, std::env::var(key).ok()))
                .collect::<Vec<_>>();
            for (key, value) in vars {
                std::env::set_var(key, value);
            }
            Self {
                previous: Some(previous),
            }
        }

        fn restore(mut self) {
            restore_env_entries(self.previous.take());
        }
    }

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            restore_env_entries(self.previous.take());
        }
    }

    fn restore_env_entries(entries: Option<Vec<(&'static str, Option<String>)>>) {
        if let Some(entries) = entries {
            for (key, value) in entries {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[derive(Clone)]
    struct MockFacilitatorState {
        verify_count: Arc<AtomicUsize>,
        settle_count: Arc<AtomicUsize>,
        expected_scheme: String,
        expected_authorized_amount: String,
        expected_settlement_amount: String,
    }

    impl Default for MockFacilitatorState {
        fn default() -> Self {
            Self {
                verify_count: Arc::new(AtomicUsize::new(0)),
                settle_count: Arc::new(AtomicUsize::new(0)),
                expected_scheme: X402_UPTO_SCHEME.to_string(),
                expected_authorized_amount: "20000".to_string(),
                expected_settlement_amount: "20000".to_string(),
            }
        }
    }

    impl MockFacilitatorState {
        fn expecting(scheme: &str, amount: &str) -> Self {
            Self {
                expected_scheme: scheme.to_string(),
                expected_authorized_amount: amount.to_string(),
                expected_settlement_amount: amount.to_string(),
                ..Default::default()
            }
        }

        fn expecting_upto_settlement(authorized_amount: &str, settlement_amount: &str) -> Self {
            Self {
                expected_scheme: X402_UPTO_SCHEME.to_string(),
                expected_authorized_amount: authorized_amount.to_string(),
                expected_settlement_amount: settlement_amount.to_string(),
                ..Default::default()
            }
        }
    }

    #[test]
    fn default_chat_config_builds_base_sepolia_usdc_requirement() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (CHAT_PRICE_ENV, DEFAULT_CHAT_PRICE.to_string()),
                (CHAT_SCHEME_ENV, X402_UPTO_SCHEME.to_string()),
            ],
            || {
                let config = X402ChatConfig::from_env().expect("x402 chat config");
                let requirement = config.payment.payment_requirements();
                assert_eq!(requirement.scheme, X402_UPTO_SCHEME);
                assert_eq!(requirement.network, DEFAULT_NETWORK);
                assert_eq!(requirement.asset, DEFAULT_ASSET);
                assert_eq!(requirement.amount, "20000");
                assert_eq!(requirement.pay_to, PAY_TO);
            },
        );
    }

    #[test]
    fn chat_config_uses_explicit_x402_model_allowlist() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (
                    CHAT_MODELS_ENV,
                    "aura-test-small,aura-test-large,aura-test-small".to_string(),
                ),
                (CHAT_DEFAULT_MODEL_ENV, String::new()),
            ],
            || {
                let config = X402ChatConfig::from_env().expect("x402 chat config");
                assert_eq!(config.default_model, "aura-test-small");
                assert_eq!(
                    config.allowed_models,
                    vec!["aura-test-large", "aura-test-small"]
                );
            },
        );
    }

    #[test]
    fn chat_config_rejects_default_model_outside_x402_allowlist() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (CHAT_DEFAULT_MODEL_ENV, "aura-unlisted".to_string()),
                (CHAT_MODELS_ENV, "aura-test-small".to_string()),
            ],
            || {
                let error = X402ChatConfig::from_env().expect_err("config error");
                assert!(error.contains(CHAT_DEFAULT_MODEL_ENV));
                assert!(error.contains(CHAT_MODELS_ENV));
            },
        );
    }

    #[test]
    fn chat_config_rejects_zero_max_tokens() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (CHAT_MAX_TOKENS_ENV, "0".to_string()),
            ],
            || {
                let error = X402ChatConfig::from_env().expect_err("config error");
                assert!(error.contains(CHAT_MAX_TOKENS_ENV));
                assert!(error.contains("greater than 0"));
            },
        );
    }

    #[test]
    fn payment_required_header_decodes_to_chat_payment_required_body() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (CHAT_PRICE_ENV, DEFAULT_CHAT_PRICE.to_string()),
                (CHAT_SCHEME_ENV, X402_UPTO_SCHEME.to_string()),
            ],
            || {
                let config = X402ChatConfig::from_env().expect("x402 chat config");
                let resource = ResourceInfo {
                    url: "http://localhost/api/public/x402/v1/chat/completions".to_string(),
                    description: "description".to_string(),
                    mime_type: "application/json".to_string(),
                    service_name: "Aura OS".to_string(),
                    tags: vec![],
                };
                let response = payment_required_response(
                    config.payment.payment_requirements(),
                    resource,
                    bazaar_extension_for_chat(&config),
                    "Payment required",
                );
                assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
                let header = response
                    .headers()
                    .get(&PAYMENT_REQUIRED_HEADER)
                    .expect("payment required header")
                    .to_str()
                    .expect("header string");
                let decoded = BASE64_STANDARD.decode(header).expect("base64 header");
                let required: PaymentRequired =
                    serde_json::from_slice(&decoded).expect("payment required json");
                assert_eq!(required.x402_version, X402_VERSION);
                assert_eq!(required.accepts[0].scheme, X402_UPTO_SCHEME);
                assert_eq!(required.accepts[0].amount, "20000");
                assert_eq!(
                    required.extensions["bazaar"]["info"]["input"]["method"],
                    "POST"
                );
                assert_eq!(
                    required.extensions["bazaar"]["info"]["input"]["body"]["max_tokens"],
                    512
                );
            },
        );
    }

    #[test]
    fn bazaar_example_uses_configured_max_tokens_when_lower_than_default_example() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (CHAT_MAX_TOKENS_ENV, "128".to_string()),
            ],
            || {
                let config = X402ChatConfig::from_env().expect("x402 chat config");
                let extension = bazaar_extension_for_chat(&config);
                assert_eq!(
                    extension["bazaar"]["info"]["input"]["body"]["max_tokens"],
                    128
                );
                assert_eq!(
                    extension["bazaar"]["info"]["input"]["bodySchema"]["properties"]["max_tokens"]
                        ["maximum"],
                    128
                );
            },
        );
    }

    #[test]
    fn payment_payload_match_requires_core_payment_fields() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (CHAT_PRICE_ENV, DEFAULT_CHAT_PRICE.to_string()),
                (CHAT_SCHEME_ENV, X402_UPTO_SCHEME.to_string()),
            ],
            || {
                let config = X402ChatConfig::from_env().expect("x402 chat config");
                let requirement = config.payment.payment_requirements();
                let mut accepted = requirement.clone();
                assert!(accepted.matches(&requirement));
                accepted.amount = "999".to_string();
                assert!(!accepted.matches(&requirement));
            },
        );
    }

    #[test]
    fn payment_signature_header_accepts_standard_and_x_payment_alias() {
        let standard = HeaderValue::from_static("standard");
        let alias = HeaderValue::from_static("alias");

        let mut headers = HeaderMap::new();
        headers.insert(&X_PAYMENT_HEADER, alias.clone());
        assert_eq!(payment_signature_header(&headers), Some(&alias));

        headers.insert(&PAYMENT_SIGNATURE_HEADER, standard.clone());
        assert_eq!(payment_signature_header(&headers), Some(&standard));
    }

    #[test]
    fn exact_chat_scheme_override_is_supported_for_fixed_price_testing() {
        with_env_vars(
            &[
                (PAY_TO_ENV, PAY_TO.to_string()),
                (CHAT_PRICE_ENV, "$0.001".to_string()),
                (CHAT_SCHEME_ENV, X402_EXACT_SCHEME.to_string()),
            ],
            || {
                let config = X402ChatConfig::from_env().expect("x402 chat config");
                let requirement = config.payment.payment_requirements();
                assert_eq!(requirement.scheme, X402_EXACT_SCHEME);
                assert_eq!(requirement.amount, "1000");
            },
        );
    }

    #[test]
    fn price_parser_uses_usdc_atomic_units() {
        assert_eq!(dollar_price_to_atomic_units("$0.001", 6).unwrap(), "1000");
        assert_eq!(dollar_price_to_atomic_units("$1.23", 6).unwrap(), "1230000");
        assert_eq!(dollar_price_to_atomic_units("$0.0000019", 6).unwrap(), "1");
    }

    #[test]
    fn chat_message_validation_rejects_total_prompt_over_cap() {
        let messages = vec![
            ChatCompletionMessage {
                role: "system".to_string(),
                content: "a".repeat(MAX_MESSAGE_CHARS),
            },
            ChatCompletionMessage {
                role: "assistant".to_string(),
                content: "b".repeat(MAX_MESSAGE_CHARS),
            },
            ChatCompletionMessage {
                role: "user".to_string(),
                content: "c".to_string(),
            },
        ];

        let error = validate_chat_messages(&messages).expect_err("total cap error");
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn usage_settlement_reports_when_quote_exceeds_authorized_maximum() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let (billing_url, billing_shutdown) = spawn_mock_billing_quote(1).await;
        let env_restore = EnvRestore::set(&[
            ("Z_BILLING_URL", billing_url),
            ("Z_BILLING_API_KEY", "billing-key".to_string()),
        ]);
        let store_dir = tempfile::tempdir().expect("tempdir");
        let store_path = store_dir.path().join("settings.json");
        let state = crate::build_app_state(&store_path).expect("build app state");
        let requirements = PaymentRequirements {
            scheme: X402_UPTO_SCHEME.to_string(),
            network: DEFAULT_NETWORK.to_string(),
            asset: DEFAULT_ASSET.to_string(),
            amount: "100".to_string(),
            pay_to: PAY_TO.to_string(),
            max_timeout_seconds: DEFAULT_MAX_TIMEOUT_SECONDS,
            extra: None,
        };
        let usage = SessionUsage {
            input_tokens: 7,
            output_tokens: 2,
            model: "aura-test-model".to_string(),
            provider: "fake".to_string(),
            ..Default::default()
        };

        let settlement = settlement_requirements_for_chat_usage(&state, &requirements, &usage)
            .await
            .expect("settlement result");
        match settlement {
            ChatUsageSettlement::AmountExceedsAuthorization {
                actual_amount,
                authorized_amount,
            } => {
                assert_eq!(actual_amount, 10000);
                assert_eq!(authorized_amount, 100);
            }
            ChatUsageSettlement::Requirements(_) => panic!("expected over-cap settlement result"),
        }

        env_restore.restore();
        billing_shutdown.send(()).ok();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn chat_completions_challenges_without_payment() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let env_restore = EnvRestore::set(&[
            (PAY_TO_ENV, PAY_TO.to_string()),
            (CHAT_PRICE_ENV, DEFAULT_CHAT_PRICE.to_string()),
            (CHAT_DEFAULT_MODEL_ENV, "aura-test-model".to_string()),
            (CHAT_MODELS_ENV, "aura-test-model".to_string()),
            (NETWORK_ENV, DEFAULT_NETWORK.to_string()),
            (ASSET_ENV, DEFAULT_ASSET.to_string()),
        ]);

        let store_dir = tempfile::tempdir().expect("tempdir");
        let store_path = store_dir.path().join("settings.json");
        let state = crate::build_app_state(&store_path).expect("build app state");
        let app = crate::create_router_with_interface(state, None);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(X402_CHAT_ROUTE_PATH)
                    .header(HOST, "example.test")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "model": "aura-test-model",
                            "messages": [{"role": "user", "content": "hello"}]
                        })
                        .to_string(),
                    ))
                    .expect("unpaid chat request"),
            )
            .await
            .expect("unpaid chat response");

        assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
        let required = decode_payment_required_header(response.headers());
        assert_eq!(
            required.resource.url,
            "http://example.test/api/public/x402/v1/chat/completions"
        );
        assert_eq!(required.accepts[0].scheme, X402_UPTO_SCHEME);
        assert_eq!(required.accepts[0].amount, "20000");
        assert!(required.extensions["bazaar"]["info"]["input"]
            .get("usageEstimate")
            .is_none());

        env_restore.restore();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn chat_completions_rejects_unallowed_model_before_payment_challenge() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let env_restore = EnvRestore::set(&[
            (PAY_TO_ENV, PAY_TO.to_string()),
            (CHAT_PRICE_ENV, DEFAULT_CHAT_PRICE.to_string()),
            (CHAT_DEFAULT_MODEL_ENV, "aura-test-model".to_string()),
            (CHAT_MODELS_ENV, "aura-test-model".to_string()),
            (NETWORK_ENV, DEFAULT_NETWORK.to_string()),
            (ASSET_ENV, DEFAULT_ASSET.to_string()),
        ]);

        let store_dir = tempfile::tempdir().expect("tempdir");
        let store_path = store_dir.path().join("settings.json");
        let state = crate::build_app_state(&store_path).expect("build app state");
        let app = crate::create_router_with_interface(state, None);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(X402_CHAT_ROUTE_PATH)
                    .header(HOST, "example.test")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "model": "aura-unlisted-model",
                            "messages": [{"role": "user", "content": "hello"}]
                        })
                        .to_string(),
                    ))
                    .expect("invalid chat request"),
            )
            .await
            .expect("invalid chat response");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(response.headers().get(&PAYMENT_REQUIRED_HEADER).is_none());

        env_restore.restore();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn x402_models_returns_openai_list_from_env_fallback() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let env_restore = EnvRestore::set(&[(
            CHAT_MODELS_ENV,
            "aura-test-small,aura-test-large".to_string(),
        )]);
        let store_dir = tempfile::tempdir().expect("tempdir");
        let store_path = store_dir.path().join("settings.json");
        let state = crate::build_app_state(&store_path).expect("build app state");
        let app = crate::create_router_with_interface(state, None);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/public/x402/v1/models")
                    .body(Body::empty())
                    .expect("models request"),
            )
            .await
            .expect("models response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let body: Value = serde_json::from_slice(&body).expect("models json");
        assert_eq!(body["object"], "list");
        let ids = body["data"]
            .as_array()
            .expect("data array")
            .iter()
            .filter_map(|item| item["id"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["aura-test-large", "aura-test-small"]);

        env_restore.restore();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn paid_chat_completions_uses_x402_and_harness() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let mock_facilitator = MockFacilitatorState::expecting_upto_settlement("20000", "10000");
        let (facilitator_url, shutdown) = spawn_mock_facilitator(mock_facilitator.clone()).await;
        let (billing_url, billing_shutdown) = spawn_mock_billing_quote(1).await;
        let env_restore = EnvRestore::set(&[
            (PAY_TO_ENV, PAY_TO.to_string()),
            (FACILITATOR_URL_ENV, facilitator_url),
            ("Z_BILLING_URL", billing_url),
            ("Z_BILLING_API_KEY", "billing-key".to_string()),
            (CHAT_PRICE_ENV, DEFAULT_CHAT_PRICE.to_string()),
            (CHAT_DEFAULT_MODEL_ENV, "aura-test-model".to_string()),
            (
                CHAT_MODELS_ENV,
                "aura-test-model,aura-other-model".to_string(),
            ),
            (NETWORK_ENV, DEFAULT_NETWORK.to_string()),
            (ASSET_ENV, DEFAULT_ASSET.to_string()),
        ]);

        let fake = Arc::new(FakeHarness::new());
        fake.set_script(vec![
            HarnessOutbound::TextDelta(TextDelta {
                text: "hello ".to_string(),
            }),
            HarnessOutbound::TextDelta(TextDelta {
                text: "world".to_string(),
            }),
            HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
                message_id: "msg-1".to_string(),
                stop_reason: "stop".to_string(),
                usage: SessionUsage {
                    input_tokens: 7,
                    output_tokens: 2,
                    model: "aura-test-model".to_string(),
                    provider: "fake".to_string(),
                    ..Default::default()
                },
                files_changed: FilesChanged::default(),
                originating_user_id: None,
            }),
        ])
        .await;

        let store_dir = tempfile::tempdir().expect("tempdir");
        let store_path = store_dir.path().join("settings.json");
        let mut state = crate::build_app_state(&store_path).expect("build app state");
        let harness_link: Arc<dyn HarnessLink> = fake.clone();
        state.local_harness = harness_link;
        let app = crate::create_router_with_interface(state, None);
        let request_body = json!({
            "model": "aura-test-model",
            "messages": [
                {"role": "system", "content": "Be brief."},
                {"role": "user", "content": "Say hello."}
            ],
            "max_tokens": 128
        });

        let unpaid_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(X402_CHAT_ROUTE_PATH)
                    .header(HOST, "example.test")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(request_body.to_string()))
                    .expect("unpaid chat request"),
            )
            .await
            .expect("unpaid chat response");
        assert_eq!(unpaid_response.status(), StatusCode::PAYMENT_REQUIRED);
        let required = decode_payment_required_header(unpaid_response.headers());
        assert_eq!(required.accepts[0].scheme, X402_UPTO_SCHEME);
        assert_eq!(required.accepts[0].amount, "20000");
        assert_eq!(
            required.extensions["bazaar"]["info"]["input"]["method"],
            "POST"
        );

        let payment_signature = BASE64_STANDARD.encode(
            serde_json::to_vec(&json!({
                "x402Version": X402_VERSION,
                "accepted": required.accepts[0],
                "payload": {
                    "authorization": "mocked"
                }
            }))
            .expect("payment payload json"),
        );
        let paid_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(X402_CHAT_ROUTE_PATH)
                    .header(HOST, "example.test")
                    .header(CONTENT_TYPE, "application/json")
                    .header(&PAYMENT_SIGNATURE_HEADER, payment_signature)
                    .body(Body::from(request_body.to_string()))
                    .expect("paid chat request"),
            )
            .await
            .expect("paid chat response");

        assert_eq!(paid_response.status(), StatusCode::OK);
        let settlement = decode_payment_response_header(paid_response.headers());
        assert!(settlement.success);
        assert_eq!(settlement.amount, "10000");
        let body = to_bytes(paid_response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let body: Value = serde_json::from_slice(&body).expect("chat json");
        assert_eq!(body["object"], "chat.completion");
        assert_eq!(body["model"], "aura-test-model");
        assert_eq!(body["choices"][0]["message"]["role"], "assistant");
        assert_eq!(body["choices"][0]["message"]["content"], "hello world");
        assert_eq!(body["usage"]["prompt_tokens"], 7);
        assert_eq!(body["usage"]["completion_tokens"], 2);

        let inits = fake.session_inits().await;
        assert_eq!(inits.len(), 1);
        assert_eq!(inits[0].model.id.as_deref(), Some("aura-test-model"));
        assert_eq!(inits[0].model.max_tokens, Some(128));
        assert_eq!(inits[0].user_id, "public-guest");
        assert!(inits[0].auth_jwt.is_none());
        assert_eq!(
            inits[0]
                .project
                .as_ref()
                .and_then(|project| project.aura_org_id.as_deref()),
            Some("public")
        );

        env_restore.restore();
        shutdown.send(()).ok();
        billing_shutdown.send(()).ok();
    }

    async fn spawn_mock_facilitator(state: MockFacilitatorState) -> (String, oneshot::Sender<()>) {
        let app = axum::Router::new()
            .route("/verify", post(mock_verify))
            .route("/settle", post(mock_settle))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock facilitator");
        let address = listener.local_addr().expect("local addr");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    shutdown_rx.await.ok();
                })
                .await
                .expect("mock facilitator server");
        });
        (format!("http://{address}"), shutdown_tx)
    }

    async fn mock_verify(
        AxumState(state): AxumState<MockFacilitatorState>,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        state.verify_count.fetch_add(1, Ordering::SeqCst);
        assert_facilitator_request(&state, &body, &state.expected_authorized_amount);
        Json(json!({
            "isValid": true,
            "payer": "0x2222222222222222222222222222222222222222"
        }))
    }

    async fn mock_settle(
        AxumState(state): AxumState<MockFacilitatorState>,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        state.settle_count.fetch_add(1, Ordering::SeqCst);
        assert_facilitator_request(&state, &body, &state.expected_settlement_amount);
        Json(json!({
            "success": true,
            "payer": "0x2222222222222222222222222222222222222222",
            "transaction": "0xsettled",
            "network": DEFAULT_NETWORK,
            "amount": state.expected_settlement_amount
        }))
    }

    fn assert_facilitator_request(
        state: &MockFacilitatorState,
        body: &Value,
        expected_requirements_amount: &str,
    ) {
        assert_eq!(body["x402Version"].as_u64(), Some(X402_VERSION as u64));
        assert_eq!(
            body["paymentPayload"]["x402Version"].as_u64(),
            Some(X402_VERSION as u64)
        );
        assert_eq!(
            body["paymentPayload"]["accepted"]["scheme"],
            state.expected_scheme
        );
        assert_eq!(
            body["paymentPayload"]["accepted"]["network"],
            DEFAULT_NETWORK
        );
        assert_eq!(body["paymentPayload"]["accepted"]["asset"], DEFAULT_ASSET);
        assert_eq!(
            body["paymentPayload"]["accepted"]["amount"],
            state.expected_authorized_amount
        );
        assert_eq!(body["paymentPayload"]["accepted"]["payTo"], PAY_TO);
        assert_eq!(body["paymentRequirements"]["scheme"], state.expected_scheme);
        assert_eq!(body["paymentRequirements"]["network"], DEFAULT_NETWORK);
        assert_eq!(body["paymentRequirements"]["asset"], DEFAULT_ASSET);
        assert_eq!(
            body["paymentRequirements"]["amount"],
            expected_requirements_amount
        );
        assert_eq!(body["paymentRequirements"]["payTo"], PAY_TO);
    }

    #[derive(Clone)]
    struct MockBillingState {
        cost_cents: i64,
    }

    async fn spawn_mock_billing_quote(cost_cents: i64) -> (String, oneshot::Sender<()>) {
        let app = axum::Router::new()
            .route("/v1/usage/quote", post(mock_billing_quote))
            .with_state(MockBillingState { cost_cents });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock billing");
        let address = listener.local_addr().expect("local addr");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    shutdown_rx.await.ok();
                })
                .await
                .expect("mock billing server");
        });
        (format!("http://{address}"), shutdown_tx)
    }

    async fn mock_billing_quote(
        AxumState(state): AxumState<MockBillingState>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        assert_eq!(
            headers
                .get("x-api-key")
                .and_then(|value| value.to_str().ok()),
            Some("billing-key")
        );
        assert_eq!(
            headers
                .get("x-service-name")
                .and_then(|value| value.to_str().ok()),
            Some("aura-os-server")
        );
        assert_eq!(body["metric"]["type"], "llm_tokens");
        assert_eq!(body["metric"]["provider"], "fake");
        assert_eq!(body["metric"]["model"], "aura-test-model");
        assert_eq!(body["metric"]["input_tokens"], 7);
        assert_eq!(body["metric"]["output_tokens"], 2);
        Json(json!({
            "cost_cents": state.cost_cents,
            "currency": "USD_CENTS"
        }))
    }

    fn decode_payment_required_header(headers: &HeaderMap) -> PaymentRequired {
        decode_json_header(headers, &PAYMENT_REQUIRED_HEADER)
    }

    fn decode_payment_response_header(headers: &HeaderMap) -> SettleResponse {
        decode_json_header(headers, &PAYMENT_RESPONSE_HEADER)
    }

    fn decode_json_header<T: for<'de> Deserialize<'de>>(
        headers: &HeaderMap,
        name: &HeaderName,
    ) -> T {
        let header = headers
            .get(name)
            .expect("x402 header")
            .to_str()
            .expect("x402 header string");
        let decoded = BASE64_STANDARD.decode(header).expect("base64 x402 header");
        serde_json::from_slice(&decoded).expect("x402 header json")
    }
}
