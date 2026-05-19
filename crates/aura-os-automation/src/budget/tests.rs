//! Unit tests for [`super::exploration`].

use super::exploration::{
    ExplorationBudget, ExplorationStatus, EXPLORATION_HARD_FLOOR, EXPLORATION_SOFT_CEILING,
    EXPLORATION_SOFT_FLOOR,
};

#[test]
fn empty_task_falls_back_to_floor() {
    let budget = ExplorationBudget::for_task(0, 0);
    assert_eq!(
        budget.soft, EXPLORATION_SOFT_FLOOR,
        "an empty task must still receive the soft floor",
    );
    assert_eq!(
        budget.hard, EXPLORATION_HARD_FLOOR,
        "an empty task's hard ceiling must equal the published hard floor",
    );
}

#[test]
fn description_length_inflates_soft_budget_linearly() {
    let small = ExplorationBudget::for_task(0, 0);
    let larger = ExplorationBudget::for_task(600, 0);
    assert!(
        larger.soft > small.soft,
        "longer descriptions must earn extra soft budget; got soft={} vs {}",
        larger.soft,
        small.soft,
    );
    assert_eq!(
        larger.soft,
        EXPLORATION_SOFT_FLOOR + 3,
        "600 chars / 200 = 3 bonus calls",
    );
    assert_eq!(
        larger.hard,
        larger.soft * 3,
        "hard must remain `soft * 3` after scaling",
    );
}

#[test]
fn dependencies_inflate_soft_budget_with_constant_bonus() {
    let no_deps = ExplorationBudget::for_task(0, 0);
    let with_deps = ExplorationBudget::for_task(0, 4);
    assert_eq!(
        with_deps.soft,
        no_deps.soft + 4 * 2,
        "each dependency must earn EXPLORATION_DEPENDENCY_BONUS extra calls",
    );
}

#[test]
fn huge_inputs_clamp_at_soft_ceiling() {
    let budget = ExplorationBudget::for_task(1_000_000, 1_000);
    assert_eq!(
        budget.soft, EXPLORATION_SOFT_CEILING,
        "absurd inputs must clamp at EXPLORATION_SOFT_CEILING",
    );
    assert_eq!(
        budget.hard,
        EXPLORATION_SOFT_CEILING * 3,
        "hard must follow the clamped soft value",
    );
}

#[test]
fn classify_returns_each_variant() {
    let budget = ExplorationBudget::for_task(0, 0);
    assert_eq!(budget.classify(0), ExplorationStatus::WithinBudget);
    assert_eq!(
        budget.classify(budget.soft - 1),
        ExplorationStatus::WithinBudget,
        "one below soft is still WithinBudget",
    );
    assert_eq!(
        budget.classify(budget.soft),
        ExplorationStatus::WithinSoftAdvisory,
        "exact soft hit must trigger the advisory band",
    );
    assert_eq!(
        budget.classify(budget.hard),
        ExplorationStatus::WithinSoftAdvisory,
        "exact hard hit is still inside the advisory band; OverHard is `> hard`",
    );
    assert_eq!(
        budget.classify(budget.hard + 1),
        ExplorationStatus::OverHard,
    );
    assert_eq!(budget.classify(u32::MAX), ExplorationStatus::OverHard);
}

#[test]
fn advisory_text_is_silent_within_budget() {
    let budget = ExplorationBudget::for_task(0, 0);
    assert!(budget.advisory_text(0).is_none());
    assert!(budget
        .advisory_text(budget.soft.saturating_sub(1))
        .is_none());
}

#[test]
fn advisory_text_uses_soft_framing_inside_advisory_band() {
    let budget = ExplorationBudget::for_task(0, 0);
    let text = budget
        .advisory_text(budget.soft)
        .expect("soft band must produce advisory text");
    assert!(
        text.starts_with("Heads up:"),
        "soft advisory must start with the heads-up framing, got: {text}",
    );
    assert!(
        text.contains(&format!("~{}", budget.soft)),
        "advisory must name the soft ceiling so the agent knows the threshold: {text}",
    );
    assert!(
        !text.contains("STRONG WARNING"),
        "soft advisory must not use the deprecated STRONG WARNING framing: {text}",
    );
}

#[test]
fn advisory_text_uses_escalation_framing_over_hard() {
    let budget = ExplorationBudget::for_task(0, 0);
    let text = budget
        .advisory_text(budget.hard + 1)
        .expect("over-hard band must produce advisory text");
    assert!(
        text.starts_with("Exploration budget exceeded"),
        "over-hard advisory must lead with the budget-exceeded framing: {text}",
    );
    assert!(
        text.contains(&format!("hard ceiling of {}", budget.hard)),
        "advisory must name the hard ceiling: {text}",
    );
    assert!(
        !text.contains("STRONG WARNING"),
        "over-hard advisory must not use the deprecated STRONG WARNING framing: {text}",
    );
    assert!(
        !text.to_lowercase().contains("blocked"),
        "advisory must not threaten to block the agent's reads: {text}",
    );
}

#[test]
fn default_matches_floor_pair() {
    let default_budget = ExplorationBudget::default();
    assert_eq!(default_budget.soft, EXPLORATION_SOFT_FLOOR);
    assert_eq!(default_budget.hard, EXPLORATION_HARD_FLOOR);
}
