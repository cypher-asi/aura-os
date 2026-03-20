use std::time::Duration;

/// Default maximum exploration-type tool calls (read_file, search_code, etc.)
/// before the loop starts nudging toward implementation.
pub(crate) const DEFAULT_EXPLORATION_ALLOWANCE: usize = 12;

/// Maximum accumulated write/edit failures for a single file before those
/// tools are blocked for that path.
pub(crate) const MAX_WRITE_FAILURES_PER_FILE: usize = 3;

/// Maximum times the same file can be read before further reads are blocked,
/// preventing infinite re-read loops.
pub(crate) const MAX_READS_PER_FILE: usize = 3;

/// Hard limit on consecutive `run_command` failures before the tool is blocked
/// entirely for the remainder of the loop.
pub(crate) const MAX_CONSECUTIVE_CMD_FAILURES: usize = 5;

/// After this many consecutive `run_command` failures, warning hints are
/// appended to results suggesting built-in tools instead.
pub(crate) const CMD_FAILURE_WARNING_THRESHOLD: usize = 3;

/// Default timeout for LLM streaming calls in the tool loop.
pub(crate) const DEFAULT_STREAM_TIMEOUT: Duration = Duration::from_secs(300);

/// Default timeout (seconds) for shell commands when none is specified.
pub(crate) const DEFAULT_CMD_TIMEOUT_SECS: u64 = 60;

/// Maximum timeout (seconds) allowed for shell commands.
pub(crate) const MAX_CMD_TIMEOUT_SECS: u64 = 300;

/// Maximum characters of stdout returned from shell commands.
pub(crate) const CMD_STDOUT_TRUNCATE_CHARS: usize = 8000;

/// Maximum characters of stderr returned from shell commands.
pub(crate) const CMD_STDERR_TRUNCATE_CHARS: usize = 4000;

/// Compiled regex size limit (bytes) to prevent ReDoS on `search_code`.
pub(crate) const SEARCH_REGEX_SIZE_LIMIT: usize = 1_000_000;

/// Maximum number of matches returned by `search_code` / `find_files`.
pub(crate) const MAX_SEARCH_RESULTS: usize = 200;

/// Hard cap on the number of tool-loop iterations in a single chat turn.
pub(crate) const MAX_TOOL_ITERATIONS: usize = 25;
