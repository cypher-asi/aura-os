use std::sync::atomic::{AtomicUsize, Ordering};

use async_trait::async_trait;
use tokio::sync::{mpsc, Mutex};

use crate::{
    ClaudeClientError, ClaudeStreamEvent, LlmProvider, LlmResponse, LlmStreamEvent, RichMessage,
    ThinkingConfig, ToolCall, ToolDefinition, ToolStreamResponse,
};

/// A single canned response that [`MockLlmProvider`] will return.
#[derive(Debug, Clone)]
pub struct MockResponse {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
}

impl MockResponse {
    /// Simple text-only response with `end_turn`.
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            tool_calls: vec![],
            stop_reason: "end_turn".into(),
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        }
    }

    /// Response that requests one or more tool calls.
    pub fn tool_use(tool_calls: Vec<ToolCall>) -> Self {
        Self {
            text: String::new(),
            tool_calls,
            stop_reason: "tool_use".into(),
            input_tokens: 100,
            output_tokens: 80,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        }
    }

    pub fn with_tokens(mut self, input: u64, output: u64) -> Self {
        self.input_tokens = input;
        self.output_tokens = output;
        self
    }
}

/// A configurable mock LLM provider for testing.
///
/// Callers push [`MockResponse`] values into its queue. Each call to any
/// `complete*` method pops the next response. If the queue is exhausted it
/// returns a default "no more mock responses" error.
///
/// It also records every request it receives so tests can assert on them.
pub struct MockLlmProvider {
    responses: Mutex<Vec<MockResponse>>,
    call_count: AtomicUsize,
    recorded_calls: Mutex<Vec<RecordedCall>>,
}

/// A record of a single call made to the mock provider.
#[derive(Debug, Clone)]
pub struct RecordedCall {
    pub method: String,
    pub system_prompt: String,
    pub messages: Vec<RichMessage>,
    pub tools: Vec<ToolDefinition>,
    pub max_tokens: u32,
}

impl MockLlmProvider {
    pub fn new() -> Self {
        Self {
            responses: Mutex::new(Vec::new()),
            call_count: AtomicUsize::new(0),
            recorded_calls: Mutex::new(Vec::new()),
        }
    }

    /// Create a mock pre-loaded with a sequence of responses. They are
    /// returned in FIFO order (first pushed = first returned).
    pub fn with_responses(responses: Vec<MockResponse>) -> Self {
        Self {
            responses: Mutex::new(responses),
            call_count: AtomicUsize::new(0),
            recorded_calls: Mutex::new(Vec::new()),
        }
    }

    /// Push an additional response onto the back of the queue.
    pub async fn push_response(&self, response: MockResponse) {
        self.responses.lock().await.push(response);
    }

    /// How many calls have been made so far.
    pub fn call_count(&self) -> usize {
        self.call_count.load(Ordering::SeqCst)
    }

    /// Get a snapshot of all recorded calls.
    pub async fn recorded_calls(&self) -> Vec<RecordedCall> {
        self.recorded_calls.lock().await.clone()
    }

    async fn next_response(&self) -> Result<MockResponse, ClaudeClientError> {
        let mut queue = self.responses.lock().await;
        if queue.is_empty() {
            return Err(ClaudeClientError::Parse(
                "MockLlmProvider: no more canned responses".into(),
            ));
        }
        Ok(queue.remove(0))
    }

    async fn record(&self, method: &str, system: &str, messages: Vec<RichMessage>, tools: Vec<ToolDefinition>, max_tokens: u32) {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        self.recorded_calls.lock().await.push(RecordedCall {
            method: method.into(),
            system_prompt: system.into(),
            messages,
            tools,
            max_tokens,
        });
    }

    fn send_events(resp: &MockResponse, event_tx: &mpsc::UnboundedSender<LlmStreamEvent>) {
        if !resp.text.is_empty() {
            let _ = event_tx.send(ClaudeStreamEvent::Delta(resp.text.clone()));
        }
        for tc in &resp.tool_calls {
            let _ = event_tx.send(ClaudeStreamEvent::ToolUse {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input: tc.input.clone(),
            });
        }
        let _ = event_tx.send(ClaudeStreamEvent::Done {
            stop_reason: resp.stop_reason.clone(),
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_input_tokens: resp.cache_creation_input_tokens,
            cache_read_input_tokens: resp.cache_read_input_tokens,
        });
    }
}

impl Default for MockLlmProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl LlmProvider for MockLlmProvider {
    async fn complete(
        &self,
        _api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        let msgs = vec![RichMessage::user(user_message)];
        self.record("complete", system_prompt, msgs, vec![], max_tokens).await;
        let resp = self.next_response().await?;
        Ok(LlmResponse {
            text: resp.text,
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
        })
    }

    async fn complete_stream(
        &self,
        _api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        let msgs = vec![RichMessage::user(user_message)];
        self.record("complete_stream", system_prompt, msgs, vec![], max_tokens).await;
        let resp = self.next_response().await?;
        Self::send_events(&resp, &event_tx);
        Ok(resp.text)
    }

    async fn complete_stream_multi(
        &self,
        _api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        let rich: Vec<RichMessage> = messages
            .iter()
            .map(|(role, content)| RichMessage {
                role: role.clone(),
                content: crate::MessageContent::Text(content.clone()),
            })
            .collect();
        self.record("complete_stream_multi", system_prompt, rich, vec![], max_tokens).await;
        let resp = self.next_response().await?;
        Self::send_events(&resp, &event_tx);
        Ok(resp.text)
    }

    async fn complete_stream_with_tools(
        &self,
        _api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        _thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        self.record("complete_stream_with_tools", system_prompt, messages, tools, max_tokens).await;
        let resp = self.next_response().await?;
        Self::send_events(&resp, &event_tx);
        Ok(ToolStreamResponse {
            text: resp.text,
            tool_calls: resp.tool_calls,
            stop_reason: resp.stop_reason,
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_input_tokens: resp.cache_creation_input_tokens,
            cache_read_input_tokens: resp.cache_read_input_tokens,
            model_used: crate::DEFAULT_MODEL.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_returns_responses_in_order() {
        let mock = MockLlmProvider::with_responses(vec![
            MockResponse::text("first"),
            MockResponse::text("second"),
        ]);

        let r1 = mock.complete("key", "sys", "msg1", 100).await.unwrap();
        assert_eq!(r1.text, "first");

        let r2 = mock.complete("key", "sys", "msg2", 100).await.unwrap();
        assert_eq!(r2.text, "second");

        assert_eq!(mock.call_count(), 2);
    }

    #[tokio::test]
    async fn mock_errors_when_exhausted() {
        let mock = MockLlmProvider::new();
        let err = mock.complete("key", "sys", "msg", 100).await.unwrap_err();
        assert!(err.to_string().contains("no more canned responses"));
    }

    #[tokio::test]
    async fn mock_records_calls() {
        let mock = MockLlmProvider::with_responses(vec![MockResponse::text("hi")]);
        let _ = mock.complete("key", "system prompt", "hello", 256).await;

        let calls = mock.recorded_calls().await;
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].method, "complete");
        assert_eq!(calls[0].system_prompt, "system prompt");
        assert_eq!(calls[0].max_tokens, 256);
    }

    #[tokio::test]
    async fn mock_stream_with_tools_sends_events() {
        let tool_call = ToolCall {
            id: "tc_1".into(),
            name: "read_file".into(),
            input: serde_json::json!({"path": "test.txt"}),
        };
        let mock = MockLlmProvider::with_responses(vec![
            MockResponse::tool_use(vec![tool_call.clone()]),
            MockResponse::text("done"),
        ]);

        let (tx, mut rx) = mpsc::unbounded_channel();
        let resp = mock
            .complete_stream_with_tools("key", "sys", vec![], vec![], 1024, None, tx)
            .await
            .unwrap();

        assert_eq!(resp.stop_reason, "tool_use");
        assert_eq!(resp.tool_calls.len(), 1);
        assert_eq!(resp.tool_calls[0].name, "read_file");

        let mut events = vec![];
        while let Ok(evt) = rx.try_recv() {
            events.push(evt);
        }
        assert!(events.iter().any(|e| matches!(e, ClaudeStreamEvent::ToolUse { name, .. } if name == "read_file")));
        assert!(events.iter().any(|e| matches!(e, ClaudeStreamEvent::Done { stop_reason, .. } if stop_reason == "tool_use")));
    }
}
