//! Model-aware cost estimation for process runs.

pub(crate) fn default_fee_schedule() -> [(&'static str, f64, f64); 3] {
    [
        ("claude-opus-4-6", 5.0, 25.0),
        ("claude-sonnet-4-5", 3.0, 15.0),
        ("claude-haiku-4-5", 0.80, 4.00),
    ]
}

pub(crate) fn lookup_model_rates(model: &str) -> (f64, f64) {
    let normalized = model.trim().to_ascii_lowercase();
    for (candidate, input, output) in default_fee_schedule() {
        if normalized == candidate
            || normalized.starts_with(candidate)
            || candidate.starts_with(&normalized)
        {
            return (input, output);
        }
    }
    (3.0, 15.0)
}

pub(crate) fn estimate_cost_usd(model: Option<&str>, input_tokens: u64, output_tokens: u64) -> f64 {
    let (input_rate, output_rate) = lookup_model_rates(model.unwrap_or("claude-sonnet-4-5"));
    input_tokens as f64 * input_rate / 1_000_000.0
        + output_tokens as f64 * output_rate / 1_000_000.0
}

pub(crate) fn merge_usage_totals(
    usage: &serde_json::Value,
    prev_input: u64,
    prev_output: u64,
) -> (u64, u64, Option<String>) {
    let next_input = usage
        .get("cumulative_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| {
            prev_input
                + usage
                    .get("input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
        });
    let next_output = usage
        .get("cumulative_output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| {
            prev_output
                + usage
                    .get("output_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
        });
    let model = usage
        .get("model")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    (next_input, next_output, model)
}
