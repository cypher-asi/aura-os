use aura_os_core::TaskId;
use serde::Serialize;

/// A single issue surfaced by a heuristic rule.
///
/// `id` is the stable identifier a user can pass to `--silence` (once
/// the CLI grows that flag) — keep it in `snake_case`, matching the
/// function name of the rule that produced it.
#[derive(Clone, Debug, Serialize)]
pub struct Finding {
    pub id: &'static str,
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    pub task_id: Option<TaskId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
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
