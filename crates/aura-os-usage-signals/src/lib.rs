//! Privacy-safe usage signal classification.
//!
//! This crate intentionally has no server, storage, Mixpanel, or harness
//! dependencies. Aura OS passes in behavioural facts about a completed turn;
//! the classifier returns scores and reasons that downstream sinks can chart
//! or persist. Keeping this pure makes the rules easy to test and tune.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnRouteKind {
    BareAgent,
    ProjectAgent,
    PublicDemo,
    PublicX402,
    Other,
}

impl TurnRouteKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BareAgent => "bare_agent",
            Self::ProjectAgent => "project_agent",
            Self::PublicDemo => "public_demo",
            Self::PublicX402 => "public_x402",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentBindingSource {
    Ui,
    AutoHome,
    AutoProjectDefault,
    Sdk,
    System,
    Unknown,
    None,
}

impl AgentBindingSource {
    #[must_use]
    pub fn from_wire(value: Option<&str>) -> Self {
        match value.map(str::trim).filter(|v| !v.is_empty()) {
            Some("ui") => Self::Ui,
            Some("auto_home") => Self::AutoHome,
            Some("auto_project_default") => Self::AutoProjectDefault,
            Some("sdk") => Self::Sdk,
            Some("system") => Self::System,
            Some(_) => Self::Unknown,
            None => Self::None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ui => "ui",
            Self::AutoHome => "auto_home",
            Self::AutoProjectDefault => "auto_project_default",
            Self::Sdk => "sdk",
            Self::System => "system",
            Self::Unknown => "unknown",
            Self::None => "none",
        }
    }

    #[must_use]
    pub const fn is_user_visible(self) -> bool {
        matches!(self, Self::Ui | Self::None)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskBucket {
    Low,
    Medium,
    High,
}

impl RiskBucket {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageShape {
    AgenticWork,
    GenericAgentChat,
    Mixed,
    LowSignal,
}

impl UsageShape {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AgenticWork => "agentic_work",
            Self::GenericAgentChat => "generic_agent_chat",
            Self::Mixed => "mixed",
            Self::LowSignal => "low_signal",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IpClusterBucket {
    Unknown,
    One,
    TwoToFive,
    SixToTwenty,
    TwentyOnePlus,
}

impl IpClusterBucket {
    #[must_use]
    pub fn from_distinct_users(count: Option<usize>) -> Self {
        match count {
            None | Some(0) => Self::Unknown,
            Some(1) => Self::One,
            Some(2..=5) => Self::TwoToFive,
            Some(6..=20) => Self::SixToTwenty,
            Some(_) => Self::TwentyOnePlus,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::One => "1",
            Self::TwoToFive => "2_5",
            Self::SixToTwenty => "6_20",
            Self::TwentyOnePlus => "21_plus",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnSignalInput {
    pub route_kind: TurnRouteKind,
    pub binding_source: AgentBindingSource,
    pub account_age_days: Option<u32>,
    pub is_zero_pro: Option<bool>,
    pub is_access_granted: Option<bool>,
    pub has_project_context: bool,
    pub has_user_project_instance: bool,
    pub is_auto_home_only: bool,
    pub is_plan_mode: bool,
    pub is_cross_agent: bool,
    pub is_council: bool,
    pub is_new_session: bool,
    pub attachment_count: u32,
    pub installed_tool_count: u32,
    pub installed_integration_count: u32,
    pub tool_use_count: u32,
    pub files_changed_count: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub ip_cluster_bucket: IpClusterBucket,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnSignalClassification {
    pub agentic_score: u8,
    pub generic_chat_score: u8,
    pub usage_shape: UsageShape,
    pub risk_bucket: RiskBucket,
    pub quota_review_candidate: bool,
    pub reasons: Vec<String>,
}

#[must_use]
pub fn classify_turn(input: &TurnSignalInput) -> TurnSignalClassification {
    let mut agentic = 0u16;
    let mut generic = 0u16;
    let mut reasons = Vec::new();

    if input.route_kind == TurnRouteKind::ProjectAgent {
        add(&mut agentic, &mut reasons, 20, "project_agent_route");
    }
    if input.has_user_project_instance {
        add(&mut agentic, &mut reasons, 20, "user_project_instance");
    }
    if input.has_project_context && !input.is_auto_home_only {
        add(&mut agentic, &mut reasons, 12, "project_context");
    }
    if input.tool_use_count > 0 {
        add(&mut agentic, &mut reasons, 25, "tool_use");
        if input.tool_use_count >= 3 {
            add(&mut agentic, &mut reasons, 8, "multi_tool_turn");
        }
    }
    if input.files_changed_count > 0 {
        add(&mut agentic, &mut reasons, 25, "files_changed");
    }
    if input.is_plan_mode {
        add(&mut agentic, &mut reasons, 12, "plan_mode");
    }
    if input.is_cross_agent {
        add(&mut agentic, &mut reasons, 10, "cross_agent");
    }
    if input.is_council {
        add(&mut agentic, &mut reasons, 8, "council");
    }
    if input.attachment_count > 0 {
        add(&mut agentic, &mut reasons, 6, "attachments");
    }
    if input.installed_tool_count > 0 || input.installed_integration_count > 0 {
        add(
            &mut agentic,
            &mut reasons,
            5,
            "agent_capabilities_available",
        );
    }

    let no_side_effects = input.tool_use_count == 0 && input.files_changed_count == 0;
    if input.route_kind == TurnRouteKind::BareAgent && input.is_auto_home_only {
        add(&mut generic, &mut reasons, 28, "bare_agent_auto_home_only");
    }
    if !input.has_user_project_instance {
        add(&mut generic, &mut reasons, 14, "no_user_project_instance");
    }
    if no_side_effects {
        add(&mut generic, &mut reasons, 22, "zero_tools_zero_files");
    }
    if no_side_effects && input.input_tokens.saturating_add(input.output_tokens) >= 4_000 {
        add(&mut generic, &mut reasons, 15, "high_token_text_only_turn");
    }
    if no_side_effects && input.output_tokens >= 1_000 {
        add(
            &mut generic,
            &mut reasons,
            8,
            "long_text_response_without_actions",
        );
    }
    if input.is_new_session && no_side_effects {
        add(&mut generic, &mut reasons, 6, "new_text_only_session");
    }
    if no_side_effects
        && !input.has_user_project_instance
        && matches!(input.account_age_days, Some(0..=1))
    {
        add(
            &mut generic,
            &mut reasons,
            10,
            "new_account_text_only_no_project",
        );
    }
    match input.ip_cluster_bucket {
        IpClusterBucket::SixToTwenty => add(&mut generic, &mut reasons, 8, "shared_ip_cluster"),
        IpClusterBucket::TwentyOnePlus => {
            add(&mut generic, &mut reasons, 14, "large_shared_ip_cluster");
        }
        IpClusterBucket::Unknown | IpClusterBucket::One | IpClusterBucket::TwoToFive => {}
    }

    // Public paid/gated surfaces are allowed to be generic chat. We still
    // classify their behaviour, but they should not trigger quota review by
    // themselves.
    if matches!(
        input.route_kind,
        TurnRouteKind::PublicDemo | TurnRouteKind::PublicX402
    ) {
        generic = generic.min(30);
    }

    let agentic_score = clamp_score(agentic);
    let generic_chat_score = clamp_score(generic);
    let usage_shape = usage_shape(agentic_score, generic_chat_score);
    let risk_bucket = if generic_chat_score >= 70 && agentic_score <= 25 {
        RiskBucket::High
    } else if generic_chat_score >= 45 && agentic_score <= 45 {
        RiskBucket::Medium
    } else {
        RiskBucket::Low
    };

    TurnSignalClassification {
        agentic_score,
        generic_chat_score,
        usage_shape,
        risk_bucket,
        quota_review_candidate: matches!(risk_bucket, RiskBucket::Medium | RiskBucket::High),
        reasons,
    }
}

fn usage_shape(agentic_score: u8, generic_chat_score: u8) -> UsageShape {
    if generic_chat_score >= 70 && agentic_score <= 25 {
        UsageShape::GenericAgentChat
    } else if agentic_score >= 60 && generic_chat_score <= 45 {
        UsageShape::AgenticWork
    } else if agentic_score >= 45 && generic_chat_score >= 45 {
        UsageShape::Mixed
    } else {
        UsageShape::LowSignal
    }
}

fn add(score: &mut u16, reasons: &mut Vec<String>, points: u16, reason: &str) {
    *score = score.saturating_add(points);
    reasons.push(reason.to_string());
}

fn clamp_score(score: u16) -> u8 {
    score.min(100) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> TurnSignalInput {
        TurnSignalInput {
            route_kind: TurnRouteKind::ProjectAgent,
            binding_source: AgentBindingSource::Ui,
            account_age_days: Some(30),
            is_zero_pro: Some(true),
            is_access_granted: Some(false),
            has_project_context: true,
            has_user_project_instance: true,
            is_auto_home_only: false,
            is_plan_mode: false,
            is_cross_agent: false,
            is_council: false,
            is_new_session: false,
            attachment_count: 0,
            installed_tool_count: 4,
            installed_integration_count: 0,
            tool_use_count: 0,
            files_changed_count: 0,
            input_tokens: 500,
            output_tokens: 200,
            ip_cluster_bucket: IpClusterBucket::One,
        }
    }

    #[test]
    fn project_agent_with_actions_is_low_risk_and_agentic() {
        let input = TurnSignalInput {
            tool_use_count: 2,
            files_changed_count: 1,
            ..base()
        };

        let classification = classify_turn(&input);

        assert_eq!(classification.risk_bucket, RiskBucket::Low);
        assert_eq!(classification.usage_shape, UsageShape::AgenticWork);
        assert!(classification.agentic_score >= 80);
        assert!(classification.generic_chat_score < 40);
        assert!(!classification.quota_review_candidate);
    }

    #[test]
    fn auto_home_bare_agent_text_only_is_high_risk_candidate() {
        let input = TurnSignalInput {
            route_kind: TurnRouteKind::BareAgent,
            binding_source: AgentBindingSource::AutoHome,
            has_project_context: true,
            has_user_project_instance: false,
            is_auto_home_only: true,
            installed_tool_count: 0,
            input_tokens: 3_500,
            output_tokens: 1_200,
            ip_cluster_bucket: IpClusterBucket::One,
            ..base()
        };

        let classification = classify_turn(&input);

        assert_eq!(classification.risk_bucket, RiskBucket::High);
        assert_eq!(classification.usage_shape, UsageShape::GenericAgentChat);
        assert!(classification.quota_review_candidate);
        assert!(classification
            .reasons
            .iter()
            .any(|r| r == "bare_agent_auto_home_only"));
    }

    #[test]
    fn shared_ip_cluster_can_lift_borderline_generic_usage() {
        let input = TurnSignalInput {
            route_kind: TurnRouteKind::BareAgent,
            binding_source: AgentBindingSource::AutoHome,
            has_project_context: true,
            has_user_project_instance: false,
            is_auto_home_only: true,
            input_tokens: 1_000,
            output_tokens: 300,
            ip_cluster_bucket: IpClusterBucket::SixToTwenty,
            ..base()
        };

        let classification = classify_turn(&input);

        assert!(classification.generic_chat_score >= 70);
        assert_eq!(classification.risk_bucket, RiskBucket::High);
    }

    #[test]
    fn public_x402_generic_chat_is_not_quota_review() {
        let input = TurnSignalInput {
            route_kind: TurnRouteKind::PublicX402,
            binding_source: AgentBindingSource::None,
            has_project_context: false,
            has_user_project_instance: false,
            is_auto_home_only: false,
            installed_tool_count: 0,
            input_tokens: 10_000,
            output_tokens: 2_000,
            ip_cluster_bucket: IpClusterBucket::TwentyOnePlus,
            ..base()
        };

        let classification = classify_turn(&input);

        assert_eq!(classification.risk_bucket, RiskBucket::Low);
        assert!(!classification.quota_review_candidate);
    }
}
