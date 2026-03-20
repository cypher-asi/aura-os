use tokio::sync::mpsc;

use crate::channel_ext::send_or_log;
use crate::types::ClaudeStreamEvent;

/// Handle returned by [`StreamTokenCapture`] constructors. Await to get
/// the captured `(input_tokens, output_tokens)` once the sender is dropped.
pub struct TokenCaptureHandle {
    forwarder: tokio::task::JoinHandle<()>,
    tokens: std::sync::Arc<tokio::sync::Mutex<(u64, u64, u64, u64)>>,
}

impl TokenCaptureHandle {
    /// Wait for the forwarder task to complete, then return accumulated
    /// `(input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)`.
    pub async fn finalize(self) -> (u64, u64, u64, u64) {
        let _ = self.forwarder.await;
        *self.tokens.lock().await
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
        let tokens = std::sync::Arc::new(tokio::sync::Mutex::new((0u64, 0u64, 0u64, 0u64)));
        let tc = tokens.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let ClaudeStreamEvent::Done {
                    input_tokens, output_tokens,
                    cache_creation_input_tokens, cache_read_input_tokens, ..
                } = &evt {
                    let mut g = tc.lock().await;
                    g.0 = *input_tokens;
                    g.1 = *output_tokens;
                    g.2 = *cache_creation_input_tokens;
                    g.3 = *cache_read_input_tokens;
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
        let tokens = std::sync::Arc::new(tokio::sync::Mutex::new((0u64, 0u64, 0u64, 0u64)));
        let tc = tokens.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let ClaudeStreamEvent::Done {
                    input_tokens, output_tokens,
                    cache_creation_input_tokens, cache_read_input_tokens, ..
                } = &evt {
                    let mut g = tc.lock().await;
                    g.0 += *input_tokens;
                    g.1 += *output_tokens;
                    g.2 += *cache_creation_input_tokens;
                    g.3 += *cache_read_input_tokens;
                }
            }
        });
        (tx, TokenCaptureHandle { forwarder, tokens })
    }
}
