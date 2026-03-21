use tokio::sync::mpsc;
use tracing::{info, warn};

use aura_billing::MeteredLlm;
use aura_claude::RichMessage;

use crate::channel_ext::send_or_log;
use crate::tool_loop_types::{ToolLoopEvent, ToolLoopResult};

pub(crate) struct ExplorationState {
    pub(crate) total_calls: usize,
    pub(crate) allowance: usize,
    pub(crate) warning_mild_sent: bool,
    pub(crate) warning_strong_sent: bool,
}

pub(crate) struct BudgetState {
    pub(crate) cumulative_credits: u64,
    pub(crate) warning_30_sent: bool,
    pub(crate) warning_60_sent: bool,
    pub(crate) warning_no_write_sent: bool,
}

pub(crate) fn inject_exploration_warnings(
    exploration: &mut ExplorationState,
    api_messages: &mut Vec<RichMessage>,
) {
    let strong_threshold = exploration.allowance.saturating_sub(2);
    let mild_threshold = exploration.allowance.saturating_sub(4);

    if exploration.total_calls >= strong_threshold && !exploration.warning_strong_sent {
        exploration.warning_strong_sent = true;
        let warning = format!(
            "[EXPLORATION WARNING] {} of ~{} exploration calls used. Further reads will be limited. \
             Begin writing immediately.",
            exploration.total_calls, exploration.allowance,
        );
        info!(total_exploration = exploration.total_calls, allowance = exploration.allowance, "Injecting strong exploration warning");
        api_messages.push(RichMessage::user(&warning));
    } else if exploration.total_calls >= mild_threshold && !exploration.warning_mild_sent {
        exploration.warning_mild_sent = true;
        let warning = format!(
            "[EXPLORATION WARNING] You have done {} of ~{} exploration calls. \
             Start implementing now.",
            exploration.total_calls, exploration.allowance,
        );
        info!(total_exploration = exploration.total_calls, allowance = exploration.allowance, "Injecting exploration warning");
        api_messages.push(RichMessage::user(&warning));
    }
}

/// Check credit budget utilization and inject warnings or stop the loop.
/// Returns `None` to continue, `Some(None)` to stop with insufficient_credits,
/// or `Some(Some(result))` to return a specific result.
pub(crate) fn check_budget_warnings(
    budget_state: &mut BudgetState,
    budget: u64,
    billing_model: &str,
    iter_input_tokens: u64,
    llm: &MeteredLlm,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    api_messages: &mut Vec<RichMessage>,
) -> Option<Option<ToolLoopResult>> {
    let utilization = if budget > 0 {
        budget_state.cumulative_credits as f64 / budget as f64
    } else {
        0.0
    };

    if utilization >= 0.60 && !budget_state.warning_60_sent {
        budget_state.warning_60_sent = true;
        let warning = format!(
            "[BUDGET WARNING] You have used ~{:.0}% of your credit budget. \
             Wrap up immediately: finish the current edit, verify it compiles, \
             and call task_done. Do NOT start new explorations.",
            utilization * 100.0,
        );
        info!(utilization_pct = (utilization * 100.0) as u32, "Injecting 60% budget warning");
        api_messages.push(RichMessage::user(&warning));
    } else if utilization >= 0.30 && !budget_state.warning_30_sent {
        budget_state.warning_30_sent = true;
        let warning = format!(
            "[BUDGET WARNING] You have used ~{:.0}% of your credit budget. \
             Prioritize completing the implementation over further exploration. \
             Focus on writing and verifying code.",
            utilization * 100.0,
        );
        info!(utilization_pct = (utilization * 100.0) as u32, "Injecting 30% budget warning");
        api_messages.push(RichMessage::user(&warning));
    }

    let next_estimate = llm.estimate_credits(billing_model, iter_input_tokens, 0);
    if budget_state.cumulative_credits + next_estimate > budget {
        warn!(
            budget_state.cumulative_credits, next_estimate, budget,
            "Credit budget would be exceeded, stopping tool loop"
        );
        send_or_log(&event_tx, ToolLoopEvent::Error(
            "Stopping: credit budget for this session would be exceeded.".to_string(),
        ));
        return Some(None);
    }

    None
}

/// Inject a strong warning when 40%+ of the credit budget has been spent
/// without any write/edit calls succeeding. This catches death spirals
/// where the agent endlessly explores without producing output.
pub(crate) fn check_no_write_budget_warning(
    budget_state: &mut BudgetState,
    budget: u64,
    had_any_write: bool,
    api_messages: &mut Vec<RichMessage>,
) {
    if had_any_write || budget == 0 || budget_state.warning_no_write_sent {
        return;
    }
    let utilization = budget_state.cumulative_credits as f64 / budget as f64;
    if utilization >= 0.40 {
        budget_state.warning_no_write_sent = true;
        let warning = format!(
            "[CRITICAL WARNING] You have used ~{:.0}% of the credit budget without making any \
             writes. STOP exploring and START implementing immediately. Use the information you \
             already have. If you are stuck on reading a file, try search_code instead, or \
             write a skeleton and iterate with edit_file.",
            utilization * 100.0,
        );
        info!(utilization_pct = (utilization * 100.0) as u32, "Injecting no-write budget warning");
        api_messages.push(RichMessage::user(&warning));
    }
}

pub(crate) fn update_exploration_counts(
    tool_calls: &[aura_claude::ToolCall],
    all_blocked: &[usize],
    exploration: &mut ExplorationState,
) {
    let count = tool_calls
        .iter()
        .enumerate()
        .filter(|(i, tc)| {
            !all_blocked.contains(i)
                && matches!(tc.name.as_str(), "read_file" | "search_code" | "find_files" | "list_files")
        })
        .count();
    exploration.total_calls += count;
}
