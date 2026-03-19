import { api } from "../api/client";

export interface FeeScheduleEntry {
  model: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  effective_date: string;
}

const DEFAULT_SCHEDULE: FeeScheduleEntry[] = [
  { model: "claude-opus-4-6", input_cost_per_million: 5, output_cost_per_million: 25, effective_date: "2026-02-01" },
  { model: "claude-sonnet-4-5", input_cost_per_million: 3, output_cost_per_million: 15, effective_date: "2025-10-01" },
  { model: "claude-haiku-4-5", input_cost_per_million: 0.80, output_cost_per_million: 4.00, effective_date: "2025-10-01" },
];

let _cached: FeeScheduleEntry[] | null = null;
let _pending: Promise<FeeScheduleEntry[]> | null = null;

function getSchedule(): FeeScheduleEntry[] {
  if (_cached) return _cached;
  if (!_pending) {
    _pending = api.getFeeSchedule()
      .then((s) => { _cached = s; return s; })
      .catch(() => DEFAULT_SCHEDULE)
      .finally(() => { _pending = null; });
  }
  return DEFAULT_SCHEDULE;
}

/** Force a fresh load (call after PUT to update the schedule). */
export function invalidateFeeSchedule(): void {
  _cached = null;
  _pending = null;
}

/**
 * Short disclaimer for displayed cost. Actual charges use cache-aware pricing
 * (prompt cache read/creation) and may differ from this estimate.
 */
export const COST_ESTIMATE_DISCLAIMER = "Estimated; actual charges may differ with prompt caching.";

export function lookupRate(
  schedule: FeeScheduleEntry[],
  model: string,
): { input: number; output: number } {
  const exact = schedule
    .filter((e) => e.model === model)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  if (exact.length > 0) {
    return { input: exact[0].input_cost_per_million, output: exact[0].output_cost_per_million };
  }

  const partial = schedule
    .filter((e) => model.startsWith(e.model) || e.model.startsWith(model))
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  if (partial.length > 0) {
    return { input: partial[0].input_cost_per_million, output: partial[0].output_cost_per_million };
  }

  if (schedule.length > 0) {
    return { input: schedule[0].input_cost_per_million, output: schedule[0].output_cost_per_million };
  }

  return { input: 5, output: 25 };
}

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  model?: string,
): number {
  const schedule = getSchedule();
  const { input, output } = lookupRate(schedule, model ?? "claude-opus-4-6");
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatCostFromTokens(
  inputTokens: number,
  outputTokens: number,
  model?: string,
): string {
  return formatCost(computeCost(inputTokens, outputTokens, model));
}

/** Same as formatCostFromTokens but returns label for use with a tooltip or title. */
export function getCostEstimateLabel(): string {
  return COST_ESTIMATE_DISCLAIMER;
}

/** Update fee schedule on the server and invalidate local cache so next display uses new rates. */
export async function setFeeSchedule(
  entries: FeeScheduleEntry[],
): Promise<FeeScheduleEntry[]> {
  const result = await api.putFeeSchedule(entries);
  invalidateFeeSchedule();
  return result;
}
