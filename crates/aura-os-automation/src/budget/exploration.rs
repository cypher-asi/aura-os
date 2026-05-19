//! Soft / hard exploration budget scaled to task complexity.
//!
//! Phase G4a / Section F5. The harness today exposes a fixed
//! "STRONG WARNING" block after a handful of read-only tool calls
//! regardless of how big the task is — small bug-fixes and large
//! refactors share the same ~18-call ceiling, which calibrates the
//! agent toward rushing implementation on the genuinely large
//! tasks. This module owns the pure scaling policy: a soft ceiling
//! the agent should treat as advisory, and a hard ceiling beyond
//! which the warning escalates to "make progress now or hand back
//! to the loop".
//!
//! ## Heuristic
//!
//! Soft ceiling scales linearly with the task's complexity:
//!
//! ```text
//! soft = clamp(
//!     EXPLORATION_SOFT_FLOOR
//!         + (description_len / 200)
//!         + (dependency_count * 2),
//!     EXPLORATION_SOFT_FLOOR,
//!     EXPLORATION_SOFT_CEILING,
//! );
//! hard = soft * 3;
//! ```
//!
//! The constants are deliberate:
//!
//! * `EXPLORATION_SOFT_FLOOR = 8` lines up with the harness's
//!   minimum useful read-budget (a task always needs at least
//!   `get_task_context` + `read_file` × ~5 to orient).
//! * `EXPLORATION_SOFT_CEILING = 32` keeps the soft cap from
//!   blowing past the harness's per-turn token budget on absurd
//!   inputs (a 10 KiB description with 50 dependencies would
//!   otherwise mint a 200-call soft cap that the model's context
//!   window cannot satisfy anyway).
//! * `hard = soft * 3` matches the empirical 3:1 ratio on healthy
//!   dev-loop runs (cheap discovery + actual implementation +
//!   verification reads).
//! * `EXPLORATION_HARD_FLOOR = 24` (== floor × 3) is the published
//!   minimum hard ceiling. We do not surface a separate
//!   `for_task` clamp on `hard` because `soft` is already
//!   clamped, so `hard = soft * 3` is automatically bounded by
//!   `[EXPLORATION_HARD_FLOOR, EXPLORATION_SOFT_CEILING * 3]`.

/// Minimum soft ceiling. A task with no description and no
/// dependencies still gets this many "free" exploration calls
/// before the soft advisory triggers. Sized so the agent can
/// read the task spec, list the relevant directory, and skim a
/// few files before being nudged.
pub const EXPLORATION_SOFT_FLOOR: u32 = 8;

/// Maximum soft ceiling. Caps the heuristic so a pathologically
/// large description / dependency list does not produce a soft
/// budget that exceeds the harness's per-turn capacity.
pub const EXPLORATION_SOFT_CEILING: u32 = 32;

/// Minimum hard ceiling. Equals [`EXPLORATION_SOFT_FLOOR`] × 3 so
/// the smallest possible soft budget still has a non-trivial
/// `hard` band beyond it for genuine multi-file investigations.
pub const EXPLORATION_HARD_FLOOR: u32 = EXPLORATION_SOFT_FLOOR * 3;

/// Per-`description_len` characters of "extra" soft budget. Tuned
/// so a 200-character spec line earns one additional call, a 1 KB
/// description earns five, etc. Chosen by inspection of a handful
/// of healthy dev-loop traces — the model rarely benefits from
/// more than ~30 read-only calls before its hand needs to be on
/// the implementation.
pub const EXPLORATION_DESCRIPTION_DIVISOR: usize = 200;

/// Per-dependency soft-budget bonus. Each parent / child task in
/// the resolved [`super::super::task_context::TaskContext`] earns
/// the agent two extra exploration calls — typically one
/// `get_task_context` and one targeted `read_file` per neighbour
/// to load relevant prior work.
pub const EXPLORATION_DEPENDENCY_BONUS: u32 = 2;

/// Soft / hard exploration ceilings for a single task.
///
/// `Copy` so the value can be embedded in per-turn prompt build
/// context without lifetime ceremony. Both fields are public so
/// the server-side prompt-template wiring can format them into a
/// header without going through accessors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExplorationBudget {
    /// Soft advisory threshold. Once `used >= soft` the agent is
    /// nudged to consider proposing an edit / running a
    /// verification command, but reads are not blocked.
    pub soft: u32,
    /// Hard escalation threshold. Once `used > hard` the agent is
    /// told to make progress now or hand back to the loop with a
    /// status update. Still advisory, never a structural block —
    /// the harness keeps any tool call the model issues, but the
    /// per-turn header escalates the framing.
    pub hard: u32,
}

/// Three-way classification of an in-flight exploration call
/// count. The server's prompt builder picks the matching advisory
/// header from this verdict.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum ExplorationStatus {
    /// `used` is strictly below `soft`. No advisory; the default
    /// "you have plenty of budget left" framing applies.
    WithinBudget,
    /// `used` is in `[soft, hard]`. The advisory tone applies:
    /// "you've used N of your soft budget; continue if you need
    /// to".
    WithinSoftAdvisory,
    /// `used` is strictly above `hard`. The escalated tone
    /// applies: "exceeded the hard ceiling; make progress or
    /// hand back".
    OverHard,
}

impl ExplorationBudget {
    /// Scale a soft / hard pair from the task's
    /// `description_len` (characters) and `dependency_count`
    /// (parent + children). See the module doc for the formula.
    ///
    /// Returns ceilings clamped into
    /// `[EXPLORATION_SOFT_FLOOR, EXPLORATION_SOFT_CEILING]` for
    /// `soft`. `hard` is computed as `soft * 3` — automatically
    /// bounded by the soft clamp so it never grows without
    /// bound.
    #[must_use]
    pub fn for_task(description_len: usize, dependency_count: usize) -> Self {
        let description_bonus = u32::try_from(
            description_len
                .checked_div(EXPLORATION_DESCRIPTION_DIVISOR)
                .unwrap_or(0),
        )
        .unwrap_or(u32::MAX);
        let dependency_bonus = u32::try_from(dependency_count)
            .unwrap_or(u32::MAX)
            .saturating_mul(EXPLORATION_DEPENDENCY_BONUS);
        let raw_soft = EXPLORATION_SOFT_FLOOR
            .saturating_add(description_bonus)
            .saturating_add(dependency_bonus);
        let soft = raw_soft.clamp(EXPLORATION_SOFT_FLOOR, EXPLORATION_SOFT_CEILING);
        Self {
            soft,
            hard: soft.saturating_mul(3),
        }
    }

    /// Classify a `used` exploration count against this budget.
    /// `used == soft` is treated as the start of the soft
    /// advisory band so the agent gets the heads-up exactly when
    /// it crosses the threshold.
    #[must_use]
    pub fn classify(self, used: u32) -> ExplorationStatus {
        if used > self.hard {
            ExplorationStatus::OverHard
        } else if used >= self.soft {
            ExplorationStatus::WithinSoftAdvisory
        } else {
            ExplorationStatus::WithinBudget
        }
    }

    /// Render the per-turn advisory header text for `used`. The
    /// caller embeds the returned string into the dev-loop's
    /// system prompt so the harness forwards it on every turn.
    /// Returns `None` for [`ExplorationStatus::WithinBudget`] so
    /// the caller can omit the header entirely until the agent
    /// crosses the soft threshold.
    ///
    /// The strings are deliberately advisory: no `STRONG WARNING:`
    /// prefix, no language that asserts the agent will be blocked.
    #[must_use]
    pub fn advisory_text(self, used: u32) -> Option<String> {
        match self.classify(used) {
            ExplorationStatus::WithinBudget => None,
            ExplorationStatus::WithinSoftAdvisory => Some(format!(
                "Heads up: you've used {used} of your ~{soft} soft exploration \
                 budget for this task. Continue if you genuinely need more \
                 reads/searches; otherwise consider proposing an edit or \
                 running a verification command.",
                soft = self.soft,
            )),
            ExplorationStatus::OverHard => Some(format!(
                "Exploration budget exceeded ({used} reads/searches against a \
                 hard ceiling of {hard}). Make progress toward an edit, or \
                 hand back to the loop with a status update.",
                hard = self.hard,
            )),
        }
    }
}

impl Default for ExplorationBudget {
    /// Default budget is the floor pair — useful for tests and
    /// for the "no task scoped" path where the caller has no
    /// description / dependency signal.
    fn default() -> Self {
        Self {
            soft: EXPLORATION_SOFT_FLOOR,
            hard: EXPLORATION_HARD_FLOOR,
        }
    }
}
