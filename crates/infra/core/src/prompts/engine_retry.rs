//! Engine retry prompt when the model returns invalid JSON.

/// Follow-up prompt asking for valid JSON only (no prose or markdown fences).
pub const RETRY_CORRECTION_PROMPT: &str =
    "Your previous response was not valid JSON. Respond with ONLY a valid JSON object matching the schema above. No prose, no markdown fences.";
