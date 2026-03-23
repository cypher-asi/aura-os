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

impl aura_core::CostCalculator for PricingService {
    fn compute_task_cost(&self, model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
        self.compute_cost(model, input_tokens, output_tokens)
    }
}

/// Pure function: look up rate for a model in a schedule.
/// Picks the entry with the latest effective_date for the given model.
/// Falls back to substring matching, then first entry, then hardcoded defaults.
pub fn lookup_rate_in(schedule: &[FeeScheduleEntry], model: &str) -> (f64, f64) {
    let exact: Vec<&FeeScheduleEntry> = schedule.iter().filter(|e| e.model == model).collect();

    if let Some(entry) = exact
        .iter()
        .max_by(|a, b| a.effective_date.cmp(&b.effective_date))
    {
        return (entry.input_cost_per_million, entry.output_cost_per_million);
    }

    let partial: Vec<&FeeScheduleEntry> = schedule
        .iter()
        .filter(|e| model.starts_with(&e.model) || e.model.starts_with(model))
        .collect();

    if let Some(entry) = partial
        .iter()
        .max_by(|a, b| a.effective_date.cmp(&b.effective_date))
    {
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
        let (inp, out) = lookup_rate_in(&sched, "claude-haiku-4-5-20251001");
        assert!(
            (inp - 0.80).abs() < f64::EPSILON,
            "FAST_MODEL input rate should be haiku, got {inp}"
        );
        assert!(
            (out - 4.00).abs() < f64::EPSILON,
            "FAST_MODEL output rate should be haiku, got {out}"
        );
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

    // --- new tests ---

    #[test]
    fn substring_matching_dated_model() {
        let sched = default_fee_schedule();
        let (inp, out) = lookup_rate_in(&sched, "claude-opus-4-6-20260301");
        assert!((inp - 5.0).abs() < f64::EPSILON);
        assert!((out - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn multiple_effective_dates_latest_wins() {
        let sched = vec![
            FeeScheduleEntry {
                model: "claude-opus-4-6".into(),
                input_cost_per_million: 5.0,
                output_cost_per_million: 25.0,
                effective_date: "2026-01-01".into(),
            },
            FeeScheduleEntry {
                model: "claude-opus-4-6".into(),
                input_cost_per_million: 4.0,
                output_cost_per_million: 20.0,
                effective_date: "2026-06-01".into(),
            },
        ];
        let (inp, out) = lookup_rate_in(&sched, "claude-opus-4-6");
        assert!((inp - 4.0).abs() < f64::EPSILON);
        assert!((out - 20.0).abs() < f64::EPSILON);
    }

    #[test]
    fn set_fee_schedule_rejects_negative_costs() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = PricingService::new(store);
        let result = svc.set_fee_schedule(vec![FeeScheduleEntry {
            model: "test".into(),
            input_cost_per_million: -1.0,
            output_cost_per_million: 10.0,
            effective_date: "2026-01-01".into(),
        }]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("non-negative"));
    }

    #[test]
    fn set_fee_schedule_rejects_empty_model() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = PricingService::new(store);
        let result = svc.set_fee_schedule(vec![FeeScheduleEntry {
            model: String::new(),
            input_cost_per_million: 5.0,
            output_cost_per_million: 25.0,
            effective_date: "2026-01-01".into(),
        }]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn schedule_persistence_round_trip() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = PricingService::new(store);
        let entries = vec![FeeScheduleEntry {
            model: "custom-model".into(),
            input_cost_per_million: 7.0,
            output_cost_per_million: 35.0,
            effective_date: "2026-03-01".into(),
        }];
        svc.set_fee_schedule(entries.clone()).unwrap();
        let loaded = svc.get_fee_schedule();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].model, "custom-model");
        assert!((loaded[0].input_cost_per_million - 7.0).abs() < f64::EPSILON);
        assert!((loaded[0].output_cost_per_million - 35.0).abs() < f64::EPSILON);
    }

    #[test]
    fn cost_zero_tokens() {
        let cost = compute_cost_with_rates(0, 0, 5.0, 25.0);
        assert!((cost - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn cost_input_only() {
        let cost = compute_cost_with_rates(1_000_000, 0, 5.0, 25.0);
        assert!((cost - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn cost_output_only() {
        let cost = compute_cost_with_rates(0, 1_000_000, 5.0, 25.0);
        assert!((cost - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn cost_large_token_counts() {
        let cost = compute_cost_with_rates(1_000_000_000, 1_000_000_000, 5.0, 25.0);
        assert!((cost - 30_000.0).abs() < 0.01);
    }

    #[test]
    fn compute_cost_with_rates_known_opus_values() {
        let cost = compute_cost_with_rates(1_000_000, 0, 5.0, 25.0);
        assert!(
            (cost - 5.0).abs() < f64::EPSILON,
            "1M opus input tokens should cost $5.00"
        );

        let cost = compute_cost_with_rates(0, 1_000_000, 5.0, 25.0);
        assert!(
            (cost - 25.0).abs() < f64::EPSILON,
            "1M opus output tokens should cost $25.00"
        );

        let cost_haiku = compute_cost_with_rates(1_000_000, 1_000_000, 0.80, 4.0);
        assert!(
            (cost_haiku - 4.80).abs() < f64::EPSILON,
            "1M haiku in+out should cost $4.80"
        );
    }
}
