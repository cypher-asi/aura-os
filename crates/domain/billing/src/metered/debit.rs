use tracing::info;

use super::{MeteredLlm, MeteredLlmError};

pub(crate) struct DebitParams<'a> {
    pub model: &'a str,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub reason: &'a str,
    #[allow(dead_code)]
    pub metadata: Option<serde_json::Value>,
}

impl MeteredLlm {
    /// Stub: z-billing does not expose a per-call debit endpoint.
    /// Phase 3 will rework metered billing to use the new cost-tracking model.
    pub(crate) async fn debit(&self, params: DebitParams<'_>) -> Result<(), MeteredLlmError> {
        let DebitParams {
            model,
            input_tokens,
            output_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
            reason,
            ..
        } = params;
        let (inp_rate, out_rate) = self.pricing.lookup_rate(model);
        let non_cached =
            input_tokens.saturating_sub(cache_creation_input_tokens + cache_read_input_tokens);
        let usd_cost = (non_cached as f64 * inp_rate
            + cache_creation_input_tokens as f64 * inp_rate * 1.25
            + cache_read_input_tokens as f64 * inp_rate * 0.1
            + output_tokens as f64 * out_rate)
            / 1_000_000.0;
        let amount = (usd_cost * self.credits_per_usd).round() as u64;
        if amount == 0 {
            return Ok(());
        }
        info!(
            amount,
            reason, model, "Debit recorded (z-billing: no per-call debit endpoint)"
        );
        Ok(())
    }
}
