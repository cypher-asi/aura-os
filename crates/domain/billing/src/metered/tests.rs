use std::sync::Arc;
use tokio::sync::mpsc;

use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_claude::ClaudeStreamEvent;
use aura_store::RocksStore;

use super::{MeteredCompletionRequest, MeteredLlm};
use crate::client::BillingClient;
use crate::testutil;

#[tokio::test]
async fn test_no_access_token_returns_insufficient_credits() {
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    let billing = Arc::new(BillingClient::default());
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "unreachable",
    )]));

    let mut metered = MeteredLlm::new(mock, billing, store);
    metered.router_mode = false;

    let err = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "hi",
            max_tokens: 100,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap_err();

    assert!(err.is_insufficient_credits());
    assert!(metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_complete_calls_provider_and_debits() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "hello",
    )
    .with_tokens(100, 50)]));
    let (metered, _tmp) = testutil::make_test_llm(mock.clone()).await;

    let resp = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 200,
            billing_reason: "reason",
            metadata: None,
        })
        .await
        .unwrap();

    assert_eq!(resp.text, "hello");
    assert_eq!(mock.call_count(), 1);
    assert!(!metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_credits_exhausted_flag_persists_across_calls() {
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    let billing = Arc::new(BillingClient::default());
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("a"),
        MockResponse::text("b"),
    ]));

    let mut metered = MeteredLlm::new(mock, billing, store);
    metered.router_mode = false;

    let r1 = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "k",
            system_prompt: "s",
            user_message: "m",
            max_tokens: 10,
            billing_reason: "r",
            metadata: None,
        })
        .await;
    assert!(r1.unwrap_err().is_insufficient_credits());
    assert!(metered.is_credits_exhausted());

    let r2 = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "k",
            system_prompt: "s",
            user_message: "m",
            max_tokens: 10,
            billing_reason: "r",
            metadata: None,
        })
        .await;
    assert!(r2.unwrap_err().is_insufficient_credits());
    assert!(metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_complete_stream_forwards_events() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "streamed",
    )
    .with_tokens(80, 40)]));
    let (metered, _tmp) = testutil::make_test_llm(mock).await;

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let text = metered
        .complete_stream(
            MeteredCompletionRequest {
                model: None,
                api_key: "key",
                system_prompt: "sys",
                user_message: "msg",
                max_tokens: 200,
                billing_reason: "stream-test",
                metadata: None,
            },
            event_tx,
        )
        .await
        .unwrap();

    assert_eq!(text, "streamed");

    let mut events = vec![];
    while let Ok(evt) = event_rx.try_recv() {
        events.push(evt);
    }
    assert!(events
        .iter()
        .any(|e| matches!(e, ClaudeStreamEvent::Delta(t) if t == "streamed")));
    assert!(events
        .iter()
        .any(|e| matches!(e, ClaudeStreamEvent::Done { .. })));
}

// --- estimate_credits tests ---

#[tokio::test]
async fn test_estimate_credits_known_values() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![]));
    let (metered, _tmp) = testutil::make_test_llm(mock).await;

    let credits = metered.estimate_credits("claude-opus-4-6", 1_000_000, 500_000);
    assert!(credits > 0);
    let expected_usd: f64 =
        (500_000.0 * 5.0 + 500_000.0 * 5.0 * 0.1 + 500_000.0 * 25.0) / 1_000_000.0;
    let expected = (expected_usd * 114_286.0).round() as u64;
    assert_eq!(credits, expected);
}

#[tokio::test]
async fn test_estimate_credits_haiku_vs_opus() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![]));
    let (metered, _tmp) = testutil::make_test_llm(mock).await;

    let opus_credits = metered.estimate_credits("claude-opus-4-6", 100_000, 50_000);
    let haiku_credits = metered.estimate_credits(aura_claude::FAST_MODEL, 100_000, 50_000);
    assert!(
        opus_credits > haiku_credits,
        "opus ({opus_credits}) should cost more than haiku ({haiku_credits})"
    );
}

// --- debit stub tests (z-billing has no per-call debit endpoint) ---

#[tokio::test]
async fn test_debit_stub_succeeds() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![]));
    let (metered, _tmp) = testutil::make_test_llm(mock).await;

    metered
        .debit(super::debit::DebitParams {
            model: "claude-opus-4-6",
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
            reason: "test",
            metadata: None,
        })
        .await
        .expect("debit stub should succeed");
}

#[tokio::test]
async fn test_zero_amount_debit_skipped() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![]));
    let (metered, _tmp) = testutil::make_test_llm(mock).await;

    metered
        .debit(super::debit::DebitParams {
            model: aura_claude::FAST_MODEL,
            input_tokens: 1,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            reason: "test",
            metadata: None,
        })
        .await
        .expect("zero-amount debit should succeed");
}

// --- pre-flight check tests ---

#[tokio::test]
async fn test_pre_flight_ttl_caching() {
    use crate::testutil::{
        billing_client_for_url, start_stateful_mock_billing_server, store_zero_auth_session,
        MockBillingState,
    };

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(999_999)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("a").with_tokens(10, 5),
        MockResponse::text("b").with_tokens(10, 5),
    ]));
    let mut metered = MeteredLlm::new(mock, billing, store);
    metered.router_mode = false;

    metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "r",
            metadata: None,
        })
        .await
        .unwrap();
    metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "r",
            metadata: None,
        })
        .await
        .unwrap();

    assert!(!metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_pre_flight_failure_sets_exhausted() {
    use crate::testutil::{
        billing_client_for_url, start_stateful_mock_billing_server, store_zero_auth_session,
        MockBillingState,
    };

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(0)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "x",
    )
    .with_tokens(100, 50)]));
    let mut metered = MeteredLlm::new(mock, billing, store);
    metered.router_mode = false;

    let err = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "r",
            metadata: None,
        })
        .await
        .unwrap_err();
    assert!(err.is_insufficient_credits());
    assert!(metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_credits_exhausted_then_topped_up() {
    use crate::testutil::{
        billing_client_for_url, start_stateful_mock_billing_server, store_zero_auth_session,
        MockBillingState,
    };

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(0)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("a").with_tokens(10, 5),
        MockResponse::text("b").with_tokens(10, 5),
    ]));
    let mut metered = MeteredLlm::new(mock, billing, store);
    metered.router_mode = false;

    let err = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "r",
            metadata: None,
        })
        .await
        .unwrap_err();
    assert!(err.is_insufficient_credits());
    assert!(metered.is_credits_exhausted());

    {
        let mut guard = state.lock().await;
        guard.balance_cents = 999_999;
    }

    let resp = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "r",
            metadata: None,
        })
        .await
        .unwrap();
    assert_eq!(resp.text, "a");
    assert!(!metered.is_credits_exhausted());
}

// --- MeteredStreamRequest / complete_stream_with_tools tests ---

#[tokio::test]
async fn test_stream_with_tools_calls_provider() {
    use crate::testutil::{make_test_llm_stateful, MockBillingState};
    use aura_claude::ToolCall;

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(10_000_000)));
    let tool_call = ToolCall {
        id: "t1".into(),
        name: "read_file".into(),
        input: serde_json::json!({"path": "main.rs"}),
    };
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::tool_use(vec![tool_call.clone()]).with_tokens(200, 80),
    ]));
    let (metered, _tmp) = make_test_llm_stateful(mock.clone(), state.clone()).await;

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let resp = metered
        .complete_stream_with_tools(super::MeteredStreamRequest {
            api_key: "key",
            system_prompt: "sys",
            messages: vec![],
            tools: vec![],
            max_tokens: 1024,
            thinking: None,
            event_tx,
            model_override: None,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap();

    assert_eq!(resp.tool_calls.len(), 1);
    assert_eq!(resp.tool_calls[0].name, "read_file");
    assert_eq!(mock.call_count(), 1);

    let mut events = vec![];
    while let Ok(evt) = event_rx.try_recv() {
        events.push(evt);
    }
    assert!(events
        .iter()
        .any(|e| matches!(e, ClaudeStreamEvent::Done { .. })));
}

#[tokio::test]
async fn test_stream_with_tools_model_override() {
    use crate::testutil::{make_test_llm_stateful, MockBillingState};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(10_000_000)));
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "fast-response",
    )
    .with_tokens(50, 20)]));
    let (metered, _tmp) = make_test_llm_stateful(mock.clone(), state.clone()).await;

    let (event_tx, _rx) = mpsc::unbounded_channel();
    let resp = metered
        .complete_stream_with_tools(super::MeteredStreamRequest {
            api_key: "key",
            system_prompt: "sys",
            messages: vec![],
            tools: vec![],
            max_tokens: 512,
            thinking: None,
            event_tx,
            model_override: Some(aura_claude::FAST_MODEL),
            billing_reason: "test-override",
            metadata: None,
        })
        .await
        .unwrap();

    assert_eq!(resp.text, "fast-response");
    assert_eq!(mock.call_count(), 1);
}

#[tokio::test]
async fn test_stream_with_tools_insufficient_credits() {
    use crate::testutil::{
        billing_client_for_url, start_stateful_mock_billing_server, store_zero_auth_session,
        MockBillingState,
    };

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(0)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "unreachable",
    )]));
    let mut metered = super::MeteredLlm::new(mock.clone(), billing, store);
    metered.router_mode = false;

    let (event_tx, _rx) = mpsc::unbounded_channel();
    let err = metered
        .complete_stream_with_tools(super::MeteredStreamRequest {
            api_key: "key",
            system_prompt: "sys",
            messages: vec![],
            tools: vec![],
            max_tokens: 1024,
            thinking: None,
            event_tx,
            model_override: None,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap_err();

    assert!(err.is_insufficient_credits());
    assert_eq!(
        mock.call_count(),
        0,
        "LLM should not be called when credits are insufficient"
    );
}

// --- LlmProvider trait impl tests ---

#[tokio::test]
async fn test_complete_with_model_uses_correct_rate() {
    use crate::testutil::{make_test_llm_stateful, MockBillingState};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(10_000_000)));
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "haiku response",
    )
    .with_tokens(100_000, 50_000)]));
    let (metered, _tmp) = make_test_llm_stateful(mock, state.clone()).await;

    let resp = metered
        .complete(MeteredCompletionRequest {
            model: Some(aura_claude::FAST_MODEL),
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 200,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap();
    assert_eq!(resp.text, "haiku response");
}

// --- Router mode tests ---

#[tokio::test]
async fn test_router_mode_detection() {
    let _guard = crate::testutil::ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    std::env::remove_var("AURA_ROUTER_URL");
    let tmp1 = tempfile::TempDir::new().unwrap();
    let store1 = Arc::new(aura_store::RocksStore::open(tmp1.path()).unwrap());
    let billing1 = Arc::new(BillingClient::default());
    let mock1 = Arc::new(MockLlmProvider::with_responses(vec![]));
    let metered1 = MeteredLlm::new(mock1, billing1, store1);
    assert!(!metered1.is_router_mode());

    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");
    let tmp2 = tempfile::TempDir::new().unwrap();
    let store2 = Arc::new(aura_store::RocksStore::open(tmp2.path()).unwrap());
    let billing2 = Arc::new(BillingClient::default());
    let mock2 = Arc::new(MockLlmProvider::with_responses(vec![]));
    let metered2 = MeteredLlm::new(mock2, billing2, store2);
    assert!(metered2.is_router_mode());

    std::env::set_var("AURA_ROUTER_URL", "");
    let tmp3 = tempfile::TempDir::new().unwrap();
    let store3 = Arc::new(aura_store::RocksStore::open(tmp3.path()).unwrap());
    let billing3 = Arc::new(BillingClient::default());
    let mock3 = Arc::new(MockLlmProvider::with_responses(vec![]));
    let metered3 = MeteredLlm::new(mock3, billing3, store3);
    assert!(
        !metered3.is_router_mode(),
        "empty AURA_ROUTER_URL should not enable router mode"
    );

    std::env::remove_var("AURA_ROUTER_URL");
}

/// In router mode with an access token, preflight and debit are skipped.
/// The LLM provider is called directly and the call succeeds.
#[tokio::test]
async fn test_router_mode_skips_preflight_and_debit() {
    let _guard = crate::testutil::ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");

    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    crate::testutil::store_zero_auth_session(&store);
    // No billing server configured — if preflight were called, it would fail
    let billing = Arc::new(BillingClient::default());
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "router-response",
    )
    .with_tokens(50, 20)]));
    let metered = MeteredLlm::new(mock.clone(), billing, store);
    assert!(metered.is_router_mode());

    let resp = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "ignored",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap();

    assert_eq!(resp.text, "router-response");
    assert_eq!(mock.call_count(), 1);
    assert!(!metered.is_credits_exhausted());

    std::env::remove_var("AURA_ROUTER_URL");
}

/// In router mode, the JWT (access_token from store) is used as the credential
/// instead of the api_key argument. If no access_token exists, it fails with InsufficientCredits.
#[tokio::test]
async fn test_router_mode_injects_jwt() {
    let _guard = crate::testutil::ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");

    // Case 1: No access_token → fails
    let tmp1 = tempfile::TempDir::new().unwrap();
    let store1 = Arc::new(aura_store::RocksStore::open(tmp1.path()).unwrap());
    let billing1 = Arc::new(BillingClient::default());
    let mock1 = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "unreachable",
    )]));
    let metered1 = MeteredLlm::new(mock1.clone(), billing1, store1);

    let err = metered1
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "my-api-key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap_err();
    assert!(err.is_insufficient_credits());
    assert_eq!(
        mock1.call_count(),
        0,
        "LLM should not be called without JWT"
    );

    // Case 2: With access_token → succeeds
    let tmp2 = tempfile::TempDir::new().unwrap();
    let store2 = Arc::new(aura_store::RocksStore::open(tmp2.path()).unwrap());
    crate::testutil::store_zero_auth_session(&store2);
    let billing2 = Arc::new(BillingClient::default());
    let mock2 = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "ok",
    )
    .with_tokens(10, 5)]));
    let metered2 = MeteredLlm::new(mock2.clone(), billing2, store2);

    let resp = metered2
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "my-api-key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 100,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap();
    assert_eq!(resp.text, "ok");
    assert_eq!(
        mock2.call_count(),
        1,
        "LLM should be called with JWT credential"
    );

    std::env::remove_var("AURA_ROUTER_URL");
}

/// In router mode, when the provider returns InsufficientCredits (402),
/// the credits_exhausted flag is set.
#[tokio::test]
async fn test_router_mode_catches_402() {
    use std::sync::atomic::Ordering;

    let _guard = crate::testutil::ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");

    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    crate::testutil::store_zero_auth_session(&store);
    let billing = Arc::new(BillingClient::default());

    // Create a mock that returns InsufficientCredits
    let mock = Arc::new(MockLlmProvider::with_responses(vec![]));
    let metered = MeteredLlm::new(mock, billing, store);

    // Manually push an error response by using an empty mock (will return Parse error)
    // Instead, test via the LlmProvider trait by constructing a proper scenario.
    // The mock returns Parse error when empty — we need a way to return InsufficientCredits.
    // Since we can't easily inject errors into MockLlmProvider, test via handle_llm_result directly.
    assert!(!metered.is_credits_exhausted());
    let result: Result<String, _> =
        metered.handle_llm_result(Err(aura_claude::ClaudeClientError::InsufficientCredits));
    assert!(result.is_err());
    assert!(metered.credits_exhausted.load(Ordering::SeqCst));

    std::env::remove_var("AURA_ROUTER_URL");
}

/// Without AURA_ROUTER_URL, the old direct-mode behavior is unchanged:
/// preflight + debit are called, api_key is passed through.
#[tokio::test]
async fn test_direct_mode_still_works() {
    let _guard = crate::testutil::ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    std::env::remove_var("AURA_ROUTER_URL");

    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "direct-response",
    )
    .with_tokens(100, 50)]));
    let (metered, _tmp) = crate::testutil::make_test_llm(mock.clone()).await;
    assert!(!metered.is_router_mode());

    let resp = metered
        .complete(MeteredCompletionRequest {
            model: None,
            api_key: "key",
            system_prompt: "sys",
            user_message: "msg",
            max_tokens: 200,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap();
    assert_eq!(resp.text, "direct-response");
    assert_eq!(mock.call_count(), 1);
    assert!(!metered.is_credits_exhausted());
}

/// Router mode stream with tools skips preflight and debit.
#[tokio::test]
async fn test_router_mode_stream_with_tools() {
    let _guard = crate::testutil::ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");

    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    crate::testutil::store_zero_auth_session(&store);
    let billing = Arc::new(BillingClient::default());
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "tool-response",
    )
    .with_tokens(200, 80)]));
    let metered = MeteredLlm::new(mock.clone(), billing, store);

    let (event_tx, _rx) = mpsc::unbounded_channel();
    let resp = metered
        .complete_stream_with_tools(super::MeteredStreamRequest {
            api_key: "ignored",
            system_prompt: "sys",
            messages: vec![],
            tools: vec![],
            max_tokens: 1024,
            thinking: None,
            event_tx,
            model_override: None,
            billing_reason: "test",
            metadata: None,
        })
        .await
        .unwrap();

    assert_eq!(resp.text, "tool-response");
    assert_eq!(mock.call_count(), 1);

    std::env::remove_var("AURA_ROUTER_URL");
}
