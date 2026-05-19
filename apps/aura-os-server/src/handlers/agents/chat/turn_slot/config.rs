//! Env-driven knobs for the turn slot: first-event / sliding-idle
//! watchdog timeouts, tool-heartbeat cadence, and per-partition
//! queue cap. Constants here define the defaults; the public
//! accessors (`max_pending_turns`, `tool_heartbeat_interval`) cache
//! their env reads in a `OnceLock` for cheap repeat lookups.

use std::sync::OnceLock;
use std::time::Duration;

/// Default first-event timeout when `AURA_TURN_FIRST_EVENT_TIMEOUT_SECS`
/// is unset or invalid.
///
/// Phase 3 of the agent-stuck-and-reset plan tightened this from
/// `120s` -> `90s` so the server-side cold-start window matches the
/// client SSE idle timeout (`IDLE_TIMEOUT_MS = 90_000` in
/// `interface/src/shared/api/sse.ts`). Past 90s the browser was going
/// to disconnect the SSE stream anyway; holding the server watchdog
/// for an extra 30s past that just left the user staring at a frozen
/// "cooking" indicator with no actionable error. Opus router
/// cold-start + first thinking delta normally completes well inside
/// this window; the rare run that doesn't surfaces a `stream_stalled`
/// the client can act on instead of timing out silently.
pub const DEFAULT_FIRST_EVENT_TIMEOUT_SECS: u64 = 90;

/// Default sliding-idle timeout when `AURA_TURN_MAX_TIMEOUT_SECS`
/// is unset or invalid.
///
/// Interpreted as the maximum quiet window between non-terminal
/// events on the harness broadcast (NOT an absolute wall-clock cap
/// on the whole turn) — so a long turn that keeps emitting
/// text-deltas, thinking, tool calls, or progress heartbeats never
/// trips this watchdog mid-stream.
///
/// Phase 3 dropped this from `1800s` (30 min) -> `180s` (3 min) so a
/// genuinely hung turn surfaces in minutes instead of half an hour.
/// Long-running tool calls — the previous justification for the 30
/// min ceiling — are kept under this idle window by the harness-side
/// tool heartbeat (Phase 6: `progress { stage: "tool_running", … }`
/// every [`DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS`]). Power users with
/// pathological tool latency can still raise the ceiling via
/// `AURA_TURN_MAX_TIMEOUT_SECS`.
pub const DEFAULT_MAX_IDLE_TIMEOUT_SECS: u64 = 180;

/// Default tool-heartbeat cadence when
/// `AURA_TURN_TOOL_HEARTBEAT_INTERVAL_SECS` is unset or invalid.
///
/// During a long-running tool call the harness is expected to emit
/// a `progress { stage: "tool_running", elapsed_ms, … }` event at
/// least this often so the server-side sliding-idle watchdog (driven
/// by [`DEFAULT_MAX_IDLE_TIMEOUT_SECS`]) keeps resetting and a real
/// hang is the only thing that can trip `turn_timeout`.
///
/// Phase 3 reserves this knob as a passive observability hook only:
/// the watchdog does NOT consume it yet — Phase 6 will wire harness
/// emission against it. Exposing the env override here lets ops tune
/// the cadence ahead of the harness change without a server rebuild.
pub const DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS: u64 = 20;

// Phase 3 exposes the tool-heartbeat knob ahead of the consumer in
// Phase 6 (harness-side emission). The constants and accessor below
// are deliberately unused at the call-site level until that phase
// lands; the `#[allow(dead_code)]` attributes keep `cargo clippy
// -D warnings` clean without losing the documented type signatures
// the harness will plug into.

/// Env var that overrides [`DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS`].
/// Clamped to `[1, 600]`s on read; out-of-range or unparsable values
/// fall back to the default.
#[allow(dead_code)]
const TOOL_HEARTBEAT_INTERVAL_ENV: &str = "AURA_TURN_TOOL_HEARTBEAT_INTERVAL_SECS";

/// Lower bound on the tool-heartbeat cadence. A cadence of zero would
/// degenerate into a hot loop and a cadence of milliseconds would
/// drown the broadcast in heartbeat noise; one second is the smallest
/// operationally useful value.
#[allow(dead_code)]
const MIN_TOOL_HEARTBEAT_INTERVAL_SECS: u64 = 1;

/// Upper bound on the tool-heartbeat cadence. Ten minutes between
/// heartbeats already exceeds the default `turn_timeout` ceiling
/// ([`DEFAULT_MAX_IDLE_TIMEOUT_SECS`]) and would defeat the purpose
/// of the heartbeat. Values past this are clamped down so a typo can't
/// silently disable the heartbeat.
#[allow(dead_code)]
const MAX_TOOL_HEARTBEAT_INTERVAL_SECS: u64 = 600;

#[allow(dead_code)]
fn read_tool_heartbeat_interval_from_env() -> Duration {
    let secs = match std::env::var(TOOL_HEARTBEAT_INTERVAL_ENV) {
        Ok(raw) => match raw.trim().parse::<u64>() {
            Ok(parsed) => parsed.clamp(
                MIN_TOOL_HEARTBEAT_INTERVAL_SECS,
                MAX_TOOL_HEARTBEAT_INTERVAL_SECS,
            ),
            Err(_) => DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS,
        },
        Err(_) => DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS,
    };
    Duration::from_secs(secs)
}

/// Tool-heartbeat cadence resolved from
/// `AURA_TURN_TOOL_HEARTBEAT_INTERVAL_SECS` (default
/// [`DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS`]). Clamped to
/// `[1, 600]`s; out-of-range or unparsable values fall back to the
/// default. Phase 3 only exposes this knob; Phase 6 will wire harness
/// emission against it.
#[allow(dead_code)] // wired up by Phase 6 (harness-side heartbeat emission)
pub fn tool_heartbeat_interval() -> Duration {
    static CACHED: OnceLock<Duration> = OnceLock::new();
    *CACHED.get_or_init(read_tool_heartbeat_interval_from_env)
}

/// Default partition turn queue size when `AURA_PARTITION_TURN_QUEUE`
/// is unset or out of range. One actively holding the lock plus at
/// most three queued waiters; the fifth concurrent acquirer is
/// rejected up front. Raised from the original `2` (1 + 1) so two
/// users on the same agent partition (or a tab + a CEO `send_to_agent`
/// fan-out) no longer collide on the queue cap.
pub const DEFAULT_MAX_PENDING_TURNS: usize = 4;

/// Hard floor on the turn-queue cap. We refuse to drop below 2 because
/// that would forbid any queueing at all (every back-to-back send
/// would surface `agent_busy{queue_full}` even if the prior turn is
/// about to complete).
const MIN_MAX_PENDING_TURNS: usize = 2;

/// Hard ceiling on the turn-queue cap. Caps the worst-case lock-pile
/// per partition so a misconfigured env var can't blow process memory
/// with parked acquirers.
const MAX_MAX_PENDING_TURNS: usize = 1024;

fn read_max_pending_turns_from_env() -> usize {
    match std::env::var("AURA_PARTITION_TURN_QUEUE") {
        Ok(raw) => match raw.trim().parse::<usize>() {
            Ok(parsed) => parsed.clamp(MIN_MAX_PENDING_TURNS, MAX_MAX_PENDING_TURNS),
            Err(_) => DEFAULT_MAX_PENDING_TURNS,
        },
        Err(_) => DEFAULT_MAX_PENDING_TURNS,
    }
}

/// Process-wide cap on simultaneous "in-flight + queued" turns per
/// partition. Read once on first acquire from `AURA_PARTITION_TURN_QUEUE`
/// (default [`DEFAULT_MAX_PENDING_TURNS`]); subsequent calls hit the
/// `OnceLock` cache. Out-of-range or unparsable values fall back to
/// the default.
pub fn max_pending_turns() -> usize {
    static CACHED: OnceLock<usize> = OnceLock::new();
    *CACHED.get_or_init(read_max_pending_turns_from_env)
}
