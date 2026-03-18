use std::sync::Arc;

use aura_core::FeeScheduleEntry;
use aura_store::RocksStore;

const FEE_SCHEDULE_KEY: &str = "fee_schedule";

fn default_fee_schedule() -> Vec<FeeScheduleEntry> {
    vec![
        FeeScheduleEntry {
            model: "claude-opus-4-6".into(),
            input_cost_per_million: 5.0,
            output_cost_per_million: 25.0,
            effective_date: "2026-02-01".into(),
        },
        FeeScheduleEntry {
            model: "claude-sonnet-4-5".into(),
            input_cost_per_million: 3.0,
            output_cost_per_million: 15.0,
            effective_date: "2025-10-01".into(),
        },
        FeeScheduleEntry {
            model: "claude-haiku-4-5".into(),
            input_cost_per_million: 0.80,
            output_cost_per_million: 4.00,
            effective_date: "2025-10-01".into(),
        },
    ]
}

pub struct PricingService {
    store: Arc<RocksStore>,
}

impl PricingService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn get_fee_schedule(&self) -> Vec<FeeScheduleEntry> {
        match self.store.get_setting(FEE_SCHEDULE_KEY) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                let defaults = default_fee_schedule();
                self.save_fee_schedule_bytes(&defaults);
                defaults
            }),
            Err(_) => {
                let defaults = default_fee_schedule();
                self.save_fee_schedule_bytes(&defaults);
                defaults
            }
        }
    }

    pub fn set_fee_schedule(
        &self,
        entries: Vec<FeeScheduleEntry>,
    ) -> Result<Vec<FeeScheduleEntry>, String> {
        for entry in &entries {
            if entry.input_cost_per_million < 0.0 || entry.output_cost_per_million < 0.0 {
                return Err("costs must be non-negative".into());
            }
            if entry.model.is_empty() {
                return Err("model name must not be empty".into());
            }
        }
        self.save_fee_schedule_bytes(&entries);
        Ok(entries)
    }

    /// Look up the rate for a model, returning (input_cost_per_million, output_cost_per_million).
    /// Falls back to the first entry if no exact model match is found, or to
    /// hardcoded opus-4-6 defaults if the schedule is empty.
    pub fn lookup_rate(&self, model: &str) -> (f64, f64) {
        lookup_rate_in(&self.get_fee_schedule(), model)
    }

    pub fn compute_cost(&self, model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
        let (inp_rate, out_rate) = self.lookup_rate(model);
        compute_cost_with_rates(input_tokens, output_tokens, inp_rate, out_rate)
    }

    fn save_fee_schedule_bytes(&self, entries: &[FeeScheduleEntry]) {
        if let Ok(bytes) = serde_json::to_vec(entries) {
            let _ = self.store.put_setting(FEE_SCHEDULE_KEY, &bytes);
        }
    }
}

/// Pure function: look up rate for a model in a schedule.
/// Picks the entry with the latest effective_date for the given model.
/// Falls back to substring matching, then first entry, then hardcoded defaults.
pub fn lookup_rate_in(schedule: &[FeeScheduleEntry], model: &str) -> (f64, f64) {
    let exact: Vec<&FeeScheduleEntry> = schedule
        .iter()
        .filter(|e| e.model == model)
        .collect();

    if let Some(entry) = exact.iter().max_by(|a, b| a.effective_date.cmp(&b.effective_date)) {
        return (entry.input_cost_per_million, entry.output_cost_per_million);
    }

    let partial: Vec<&FeeScheduleEntry> = schedule
        .iter()
        .filter(|e| model.starts_with(&e.model) || e.model.starts_with(model))
        .collect();

    if let Some(entry) = partial.iter().max_by(|a, b| a.effective_date.cmp(&b.effective_date)) {
        return (entry.input_cost_per_million, entry.output_cost_per_million);
    }

    if let Some(first) = schedule.first() {
        return (first.input_cost_per_million, first.output_cost_per_million);
    }

    (5.0, 25.0)
}

pub fn compute_cost_with_rates(
    input_tokens: u64,
    output_tokens: u64,
    input_cost_per_million: f64,
    output_cost_per_million: f64,
) -> f64 {
    input_tokens as f64 * input_cost_per_million / 1_000_000.0
        + output_tokens as f64 * output_cost_per_million / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_schedule() -> Vec<FeeScheduleEntry> {
        vec![
            FeeScheduleEntry {
                model: "claude-opus-4-6".into(),
                input_cost_per_million: 5.0,
                output_cost_per_million: 25.0,
                effective_date: "2026-02-01".into(),
            },
            FeeScheduleEntry {
                model: "claude-sonnet-4-5".into(),
                input_cost_per_million: 3.0,
                output_cost_per_million: 15.0,
                effective_date: "2025-10-01".into(),
            },
        ]
    }

    #[test]
    fn exact_match() {
        let sched = test_schedule();
        let (inp, out) = lookup_rate_in(&sched, "claude-opus-4-6");
        assert!((inp - 5.0).abs() < f64::EPSILON);
        assert!((out - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn fast_model_matches_haiku_entry() {
        let sched = default_fee_schedule();
        let (inp, out) = lookup_rate_in(&sched, aura_claude::FAST_MODEL);
        assert!((inp - 0.80).abs() < f64::EPSILON, "FAST_MODEL input rate should be haiku, got {inp}");
        assert!((out - 4.00).abs() < f64::EPSILON, "FAST_MODEL output rate should be haiku, got {out}");
    }

    #[test]
    fn fallback_to_first_entry() {
        let sched = test_schedule();
        let (inp, out) = lookup_rate_in(&sched, "unknown-model");
        assert!((inp - 5.0).abs() < f64::EPSILON);
        assert!((out - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn empty_schedule_returns_defaults() {
        let (inp, out) = lookup_rate_in(&[], "claude-opus-4-6");
        assert!((inp - 5.0).abs() < f64::EPSILON);
        assert!((out - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn cost_calculation() {
        let cost = compute_cost_with_rates(1_000_000, 1_000_000, 5.0, 25.0);
        assert!((cost - 30.0).abs() < f64::EPSILON);
    }
}
