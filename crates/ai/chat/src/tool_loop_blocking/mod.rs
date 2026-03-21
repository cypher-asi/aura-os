mod detection;
mod results;
mod stall;
mod tool_results;

use std::collections::HashMap;
use crate::tool_loop_budget::ExplorationState;
use crate::tool_loop_read_guard::ReadGuardState;

pub(crate) struct WriteTrackingState {
    pub(crate) consecutive_write_tracker: HashMap<String, usize>,
    pub(crate) file_write_failures: HashMap<String, usize>,
    pub(crate) cooldowns: HashMap<String, usize>,
    pub(crate) last_target_signature: Option<String>,
    pub(crate) no_progress_streak: usize,
}

pub(crate) struct BlockedSets {
    pub(crate) duplicate_write: Vec<usize>,
    pub(crate) write_fail: Vec<usize>,
    pub(crate) cooldown: Vec<usize>,
    pub(crate) cmd: Vec<usize>,
    pub(crate) read: Vec<usize>,
    pub(crate) shell_read: Vec<usize>,
    pub(crate) exploration: Vec<usize>,
}

/// Combined blocking state needed by `detect_all_blocked`.
pub(crate) struct BlockingContext<'a> {
    pub(crate) consecutive_write_tracker: &'a mut HashMap<String, usize>,
    pub(crate) cooldowns: &'a mut HashMap<String, usize>,
    pub(crate) file_write_failures: &'a HashMap<String, usize>,
    pub(crate) consecutive_cmd_failures: usize,
    pub(crate) read_guard: &'a mut ReadGuardState,
    pub(crate) exploration: &'a ExplorationState,
}

// Re-export all public items for backward compatibility
pub(crate) use detection::{
    collect_duplicate_write_paths, decrement_write_file_cooldowns, detect_all_blocked,
    detect_blocked_commands, detect_blocked_exploration, detect_blocked_write_failures,
    detect_blocked_writes, detect_write_file_cooldowns,
};
pub(crate) use results::{BlockedResultContext, build_blocked_result, execute_with_blocked};
pub(crate) use stall::{
    apply_cmd_failure_tracking, detect_same_target_stall, detect_stall_fail_fast,
    track_write_failures,
};
pub(crate) use tool_results::{
    build_tool_result_blocks, looks_truncated, summarize_write_file_input,
};
