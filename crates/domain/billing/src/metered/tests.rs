use std::sync::Arc;
use tokio::sync::mpsc;

use aura_claude::ClaudeStreamEvent;
use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_store::RocksStore;

use crate::client::BillingClient;
use crate::testutil;
use super::{MeteredCompletionRequest, MeteredLlm};

#[tokio::test]
async fn test_no_access_token_returns_insufficient_credits() {
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    let billing = Arc::new(BillingClient::default());
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("unreachable"),
    ]));

    let metered = MeteredLlm::new(mock, billing, store);

    let err = metered
        .complete(MeteredCompletionRequest {
            model: None, api_key: "key", system_prompt: "sys",
            user_message: "hi", max_tokens: 100, billing_reason: "test", metadata: None,
        })
        .await
        .unwrap_err();

    assert!(err.is_insufficient_credits());
    assert!(metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_complete_calls_provider_and_debits() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("hello").with_tokens(100, 50),
    ]));
    let (metered, _tmp) = testutil::make_test_llm(mock.clone()).await;

    let resp = metered
        .complete(MeteredCompletionRequest {
            model: None, api_key: "key", system_prompt: "sys",
            user_message: "msg", max_tokens: 200, billing_reason: "reason", metadata: None,
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

    let metered = MeteredLlm::new(mock, billing, store);

    let r1 = metered.complete(MeteredCompletionRequest {
        model: None, api_key: "k", system_prompt: "s",
        user_message: "m", max_tokens: 10, billing_reason: "r", metadata: None,
    }).await;
    assert!(r1.unwrap_err().is_insufficient_credits());
    assert!(metered.is_credits_exhausted());

    let r2 = metered.complete(MeteredCompletionRequest {
        model: None, api_key: "k", system_prompt: "s",
        user_message: "m", max_tokens: 10, billing_reason: "r", metadata: None,
    }).await;
    assert!(r2.unwrap_err().is_insufficient_credits());
    assert!(metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_complete_stream_forwards_events() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("streamed").with_tokens(80, 40),
    ]));
    let (metered, _tmp) = testutil::make_test_llm(mock).await;

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let text = metered
        .complete_stream(
            MeteredCompletionRequest {
                model: None, api_key: "key", system_prompt: "sys",
                user_message: "msg", max_tokens: 200, billing_reason: "stream-test", metadata: None,
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
    let expected_usd: f64 = (500_000.0 * 5.0 + 500_000.0 * 5.0 * 0.1 + 500_000.0 * 25.0) / 1_000_000.0;
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

// --- debit calculation (cache-aware) tests ---

#[tokio::test]
async fn test_cache_aware_debit_math() {
    use crate::testutil::{MockBillingState, start_stateful_mock_billing_server, billing_client_for_url, store_zero_auth_session};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(10_000_000)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("ok").with_tokens(1000, 500),
    ]));
    let metered = MeteredLlm::new(mock, billing, store);

    metered.debit("claude-opus-4-6", 1000, 500, 200, 300, "test", None).await.unwrap();

    let guard = state.lock().await;
    assert_eq!(guard.debits.len(), 1);
    let debited = guard.debits[0].amount;
    let expected_usd: f64 = (500.0 * 5.0 + 200.0 * 5.0 * 1.25 + 300.0 * 5.0 * 0.1 + 500.0 * 25.0) / 1_000_000.0;
    let expected_credits = (expected_usd * 114_286.0).round() as u64;
    assert_eq!(debited, expected_credits);
}

#[tokio::test]
async fn test_zero_amount_debit_skipped() {
    use crate::testutil::{MockBillingState, start_stateful_mock_billing_server, billing_client_for_url, store_zero_auth_session};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(10_000_000)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![]));
    let metered = MeteredLlm::new(mock, billing, store);

    metered.debit(aura_claude::FAST_MODEL, 1, 0, 0, 0, "test", None).await.unwrap();
    let guard = state.lock().await;
    assert_eq!(guard.debits.len(), 0, "zero-amount debit should be skipped");
}

#[tokio::test]
async fn test_debit_forwards_metadata() {
    use crate::testutil::{MockBillingState, start_stateful_mock_billing_server, billing_client_for_url, store_zero_auth_session};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(10_000_000)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![]));
    let metered = MeteredLlm::new(mock, billing, store);

    let meta = serde_json::json!({"task_id": "t-123"});
    metered.debit("claude-opus-4-6", 100_000, 50_000, 0, 0, "reason", Some(meta.clone())).await.unwrap();

    let guard = state.lock().await;
    assert_eq!(guard.debits.len(), 1);
    assert_eq!(guard.debits[0].metadata, Some(meta));
}

// --- pre-flight check tests ---

#[tokio::test]
async fn test_pre_flight_ttl_caching() {
    use crate::testutil::{MockBillingState, start_stateful_mock_billing_server, billing_client_for_url, store_zero_auth_session};

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
    let metered = MeteredLlm::new(mock, billing, store);

    metered.complete(MeteredCompletionRequest {
        model: None, api_key: "key", system_prompt: "sys",
        user_message: "msg", max_tokens: 100, billing_reason: "r", metadata: None,
    }).await.unwrap();
    metered.complete(MeteredCompletionRequest {
        model: None, api_key: "key", system_prompt: "sys",
        user_message: "msg", max_tokens: 100, billing_reason: "r", metadata: None,
    }).await.unwrap();

    assert!(!metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_pre_flight_failure_sets_exhausted() {
    use crate::testutil::{MockBillingState, start_stateful_mock_billing_server, billing_client_for_url, store_zero_auth_session};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(0)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("x").with_tokens(100, 50),
    ]));
    let metered = MeteredLlm::new(mock, billing, store);

    let err = metered.complete(MeteredCompletionRequest {
        model: None, api_key: "key", system_prompt: "sys",
        user_message: "msg", max_tokens: 100, billing_reason: "r", metadata: None,
    }).await.unwrap_err();
    assert!(err.is_insufficient_credits());
    assert!(metered.is_credits_exhausted());
}

#[tokio::test]
async fn test_credits_exhausted_then_topped_up() {
    use crate::testutil::{MockBillingState, start_stateful_mock_billing_server, billing_client_for_url, store_zero_auth_session};

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
    let metered = MeteredLlm::new(mock, billing, store);

    let err = metered.complete(MeteredCompletionRequest {
        model: None, api_key: "key", system_prompt: "sys",
        user_message: "msg", max_tokens: 100, billing_reason: "r", metadata: None,
    }).await.unwrap_err();
    assert!(err.is_insufficient_credits());
    assert!(metered.is_credits_exhausted());

    {
        let mut guard = state.lock().await;
        guard.balance = 999_999;
    }

    let resp = metered.complete(MeteredCompletionRequest {
        model: None, api_key: "key", system_prompt: "sys",
        user_message: "msg", max_tokens: 100, billing_reason: "r", metadata: None,
    }).await.unwrap();
    assert_eq!(resp.text, "a");
    assert!(!metered.is_credits_exhausted());
}

// --- LlmProvider trait impl tests ---

#[tokio::test]
async fn test_complete_with_model_uses_correct_rate() {
    use crate::testutil::{MockBillingState, make_test_llm_stateful};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(10_000_000)));
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("haiku response").with_tokens(100_000, 50_000),
    ]));
    let (metered, _tmp) = make_test_llm_stateful(mock, state.clone()).await;

    let resp = metered
        .complete(MeteredCompletionRequest {
            model: Some(aura_claude::FAST_MODEL), api_key: "key", system_prompt: "sys",
            user_message: "msg", max_tokens: 200, billing_reason: "test", metadata: None,
        })
        .await
        .unwrap();
    assert_eq!(resp.text, "haiku response");

    let guard = state.lock().await;
    assert_eq!(guard.debits.len(), 1);
    let expected_usd: f64 = (100_000.0 * 0.80 + 50_000.0 * 4.00) / 1_000_000.0;
    let expected_credits = (expected_usd * 114_286.0).round() as u64;
    assert_eq!(guard.debits[0].amount, expected_credits);
}

// --- debit error handling tests ---

#[tokio::test]
async fn test_insufficient_credits_during_debit_drains_remaining() {
    use crate::testutil::{MockBillingState, start_stateful_mock_billing_server, billing_client_for_url, store_zero_auth_session};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(50)));
    let url = start_stateful_mock_billing_server(state.clone()).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);

    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("expensive").with_tokens(1_000_000, 500_000),
    ]));
    let metered = MeteredLlm::new(mock, billing, store);

    let err = metered.complete(MeteredCompletionRequest {
        model: None, api_key: "key", system_prompt: "sys",
        user_message: "msg", max_tokens: 200, billing_reason: "test", metadata: None,
    }).await.unwrap_err();
    assert!(err.is_insufficient_credits());
    assert!(metered.is_credits_exhausted());

    let guard = state.lock().await;
    assert!(guard.debits.len() >= 2, "should attempt drain after insufficient");
}
