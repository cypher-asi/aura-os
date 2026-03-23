use std::time::Duration;

/// Default timeout for LLM streaming calls.
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
