//! Context-window composition wire types.
//!
//! These describe how a session's context window is split across the
//! static buckets the harness renders each turn. [`ContextBreakdown`]
//! carries the per-bucket *token counts*; [`ContextContents`] carries
//! the rendered *text* the harness counted for each bucket, fetched
//! lazily by the client when a user opens a bucket in the popover.

use serde::{Deserialize, Serialize};

#[cfg(feature = "typescript")]
use ts_rs::TS;

/// Per-bucket token estimates for the current session context, computed
/// using the same `chars / CHARS_PER_TOKEN` heuristic as
/// [`crate::server::SessionUsage::estimated_context_tokens`]. The
/// buckets approximate what the model actually receives on the next
/// turn:
///
/// - `system_prompt_tokens` — the rendered system prompt.
/// - `tools_tokens` — serialized tool definitions (name + description +
///   JSON schema for each tool the request would carry).
/// - `skills_tokens` — installed skill metadata (name + description).
/// - `mcp_tokens` — reserved for MCP server context once aura-harness
///   gains MCP support; today this is always `0`.
/// - `subagents_tokens` — registered subagent kind specs.
/// - `conversation_tokens` — the live message transcript including
///   tool results and assistant turns. This is the same number as
///   `estimated_context_tokens` minus the static buckets above.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ContextBreakdown {
    pub system_prompt_tokens: u64,
    pub tools_tokens: u64,
    pub skills_tokens: u64,
    pub mcp_tokens: u64,
    pub subagents_tokens: u64,
    pub conversation_tokens: u64,
    /// Tokens served from the upstream provider's prompt cache during
    /// the most recent turn (Anthropic's `cache_read_input_tokens`,
    /// or OpenAI/xAI `prompt_tokens_details.cached_tokens`). Describes what
    /// fraction of the *conversation* bucket was a cache hit; not a
    /// separate context bucket, so excluded from [`Self::total`] and
    /// [`Self::is_empty`].
    #[serde(default)]
    pub cache_read_tokens: u64,
    /// Tokens written to the upstream provider's prompt cache during
    /// the most recent turn (Anthropic's `cache_creation_input_tokens`,
    /// or the cache-miss portion of OpenAI/xAI responses). See
    /// [`Self::cache_read_tokens`] for why this is NOT included in
    /// [`Self::total`] / [`Self::is_empty`].
    #[serde(default)]
    pub cache_creation_tokens: u64,
}

impl ContextBreakdown {
    /// True when every bucket is zero. Used by the frontend to detect
    /// pre-upgrade harness builds and fall back to the legacy popover.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.system_prompt_tokens == 0
            && self.tools_tokens == 0
            && self.skills_tokens == 0
            && self.mcp_tokens == 0
            && self.subagents_tokens == 0
            && self.conversation_tokens == 0
    }

    /// Sum of every bucket. Useful as a sanity check against
    /// [`crate::server::SessionUsage::estimated_context_tokens`].
    #[must_use]
    pub fn total(&self) -> u64 {
        self.system_prompt_tokens
            .saturating_add(self.tools_tokens)
            .saturating_add(self.skills_tokens)
            .saturating_add(self.mcp_tokens)
            .saturating_add(self.subagents_tokens)
            .saturating_add(self.conversation_tokens)
    }
}

/// One rendered entry inside a context bucket (e.g. a single tool
/// definition or skill). Named `ContextSegment` rather than `Item` per
/// the TS naming rule, kept identical across Rust + TS for the binding.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ContextSegment {
    pub label: String,
    pub text: String,
    pub tokens: u64,
}

/// Rendered text the harness counted for each static context bucket.
/// All fields optional/defaulted so older harness builds decode to an
/// empty value rather than failing (mirrors [`ContextBreakdown`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ContextContents {
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub tools: Vec<ContextSegment>,
    #[serde(default)]
    pub skills: Vec<ContextSegment>,
    #[serde(default)]
    pub subagents: Vec<ContextSegment>,
    #[serde(default)]
    pub mcp: Vec<ContextSegment>,
}

impl ContextContents {
    /// True when no bucket carries any rendered text. Used by the
    /// frontend to detect pre-upgrade harness builds and render a
    /// "content not available from this harness build yet" empty state
    /// (mirrors [`ContextBreakdown::is_empty`]).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.system_prompt.as_deref().unwrap_or("").is_empty()
            && self.tools.is_empty()
            && self.skills.is_empty()
            && self.subagents.is_empty()
            && self.mcp.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_contents_serde_round_trip() {
        let contents = ContextContents {
            system_prompt: Some("You are a helpful assistant.".to_string()),
            tools: vec![ContextSegment {
                label: "Read".to_string(),
                text: "Reads a file from disk.".to_string(),
                tokens: 7,
            }],
            skills: vec![ContextSegment {
                label: "babysit".to_string(),
                text: "Keep a PR merge-ready.".to_string(),
                tokens: 5,
            }],
            subagents: vec![],
            mcp: vec![],
        };

        let json = serde_json::to_string(&contents).expect("serialize ContextContents");
        let decoded: ContextContents =
            serde_json::from_str(&json).expect("deserialize ContextContents");

        assert_eq!(contents, decoded);
    }

    #[test]
    fn context_contents_default_is_empty() {
        assert!(ContextContents::default().is_empty());
        assert!(ContextContents {
            system_prompt: Some(String::new()),
            ..ContextContents::default()
        }
        .is_empty());
    }

    #[test]
    fn context_contents_decodes_tolerantly_from_partial_json() {
        // Older harness builds may omit every field; serde defaults
        // must fill them so decoding never fails.
        let decoded: ContextContents = serde_json::from_str("{}").expect("decode empty object");
        assert!(decoded.is_empty());

        let decoded: ContextContents =
            serde_json::from_str(r#"{"tools":[{"label":"x","text":"y","tokens":1}]}"#)
                .expect("decode partial object");
        assert_eq!(decoded.tools.len(), 1);
        assert!(decoded.system_prompt.is_none());
    }
}
