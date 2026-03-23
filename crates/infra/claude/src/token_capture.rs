use tokio::sync::mpsc;

use crate::channel_ext::send_or_log;
use crate::types::ClaudeStreamEvent;

#[derive(Default, Clone, Copy)]
struct TokenUsage {
    input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
}

/// Handle returned by [`StreamTokenCapture`] constructors. Await to get
/// the captured `(input_tokens, output_tokens)` once the sender is dropped.
pub struct TokenCaptureHandle {
    forwarder: tokio::task::JoinHandle<()>,
    tokens: std::sync::Arc<tokio::sync::Mutex<TokenUsage>>,
}

impl TokenCaptureHandle {
    /// Wait for the forwarder task to complete, then return accumulated
    /// `(input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)`.
    pub async fn finalize(self) -> (u64, u64, u64, u64) {
        let _ = self.forwarder.await;
        let usage = *self.tokens.lock().await;
        (
            usage.input,
            usage.output,
            usage.cache_creation,
            usage.cache_read,
        )
    }
}

/// Helpers for intercepting stream events to capture token usage.
pub struct StreamTokenCapture;

impl StreamTokenCapture {
    /// Create a channel that forwards every event to `outer` while capturing
    /// token counts from `Done` events.
    pub fn forwarding(
        outer: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> (mpsc::UnboundedSender<ClaudeStreamEvent>, TokenCaptureHandle) {
        let (tx, mut rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let tokens = std::sync::Arc::new(tokio::sync::Mutex::new(TokenUsage::default()));
        let tc = tokens.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let ClaudeStreamEvent::Done {
                    input_tokens,
                    output_tokens,
                    cache_creation_input_tokens,
                    cache_read_input_tokens,
                    ..
                } = &evt
                {
                    let mut usage = tc.lock().await;
                    usage.input = *input_tokens;
                    usage.output = *output_tokens;
                    usage.cache_creation = *cache_creation_input_tokens;
                    usage.cache_read = *cache_read_input_tokens;
                }
                send_or_log(&outer, evt);
            }
        });
        (tx, TokenCaptureHandle { forwarder, tokens })
    }

    /// Create a channel that consumes events without forwarding, accumulating
    /// token counts across multiple `Done` events (useful for build-fix loops).
    pub fn sink() -> (mpsc::UnboundedSender<ClaudeStreamEvent>, TokenCaptureHandle) {
        let (tx, mut rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let tokens = std::sync::Arc::new(tokio::sync::Mutex::new(TokenUsage::default()));
        let tc = tokens.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let ClaudeStreamEvent::Done {
                    input_tokens,
                    output_tokens,
                    cache_creation_input_tokens,
                    cache_read_input_tokens,
                    ..
                } = &evt
                {
                    let mut usage = tc.lock().await;
                    usage.input += *input_tokens;
                    usage.output += *output_tokens;
                    usage.cache_creation += *cache_creation_input_tokens;
                    usage.cache_read += *cache_read_input_tokens;
                }
            }
        });
        (tx, TokenCaptureHandle { forwarder, tokens })
    }
}
