use aura_os_core::TaskId;
use serde::{Deserialize, Serialize};

/// A single issue surfaced by a heuristic rule.
///
/// `id` is the stable identifier a user can pass to `--silence` (once
/// the CLI grows that flag) — keep it in `snake_case`, matching the
/// function name of the rule that produced it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finding {
    pub id: &'static str,
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    pub task_id: Option<TaskId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remediation: Option<RemediationHint>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warn,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Warn => "warn",
            Severity::Error => "error",
        }
    }
}

impl std::fmt::Display for Severity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for Severity {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "info" => Ok(Severity::Info),
            "warn" | "warning" => Ok(Severity::Warn),
            "error" | "err" => Ok(Severity::Error),
            other => Err(format!("unknown severity '{other}'")),
        }
    }
}

/// Typed hint describing the automated corrective action a downstream
/// orchestrator can take to address a [`Finding`]. Rules populate this
/// when they recognise a failure mode; consumers (Phase 3+) decide
/// whether to act on it. `NoAutoFix` is explicit so the absence of a
/// hint can be distinguished from "no known fix".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RemediationHint {
    SplitWriteIntoSkeletonPlusAppends {
        path: String,
        suggested_chunk_bytes: usize,
    },
    ReshapeSearchQuery {
        reason: String,
        canonical_query_hint: Option<String>,
    },
    ForceToolCallNextTurn,
    RetryWithSmallerScope {
        reason: String,
    },
    NoAutoFix,
}
