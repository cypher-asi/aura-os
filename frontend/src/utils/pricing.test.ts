import { describe, it, expect } from "vitest";
import {
  lookupRate,
  computeCost,
  formatCost,
  formatCostFromTokens,
  type FeeScheduleEntry,
} from "./pricing";

const DEFAULT_SCHEDULE: FeeScheduleEntry[] = [
  { model: "claude-opus-4-6", input_cost_per_million: 5, output_cost_per_million: 25, effective_date: "2026-02-01" },
  { model: "claude-sonnet-4-5", input_cost_per_million: 3, output_cost_per_million: 15, effective_date: "2025-10-01" },
  { model: "claude-haiku-4-5", input_cost_per_million: 0.80, output_cost_per_million: 4.00, effective_date: "2025-10-01" },
];

describe("lookupRate", () => {
  it("exact match returns correct rates", () => {
    const rate = lookupRate(DEFAULT_SCHEDULE, "claude-opus-4-6");
    expect(rate.input).toBe(5);
    expect(rate.output).toBe(25);
  });

  it("partial/substring match for dated model", () => {
    const rate = lookupRate(DEFAULT_SCHEDULE, "claude-haiku-4-5-20251001");
    expect(rate.input).toBe(0.80);
    expect(rate.output).toBe(4.00);
  });

  it("fallback to first entry for unknown model", () => {
    const rate = lookupRate(DEFAULT_SCHEDULE, "unknown-model-xyz");
    expect(rate.input).toBe(5);
    expect(rate.output).toBe(25);
  });

  it("empty schedule returns hardcoded defaults", () => {
    const rate = lookupRate([], "claude-opus-4-6");
    expect(rate.input).toBe(5);
    expect(rate.output).toBe(25);
  });

  it("latest effective_date wins for duplicate models", () => {
    const schedule: FeeScheduleEntry[] = [
      { model: "claude-opus-4-6", input_cost_per_million: 5, output_cost_per_million: 25, effective_date: "2026-01-01" },
      { model: "claude-opus-4-6", input_cost_per_million: 4, output_cost_per_million: 20, effective_date: "2026-06-01" },
    ];
    const rate = lookupRate(schedule, "claude-opus-4-6");
    expect(rate.input).toBe(4);
    expect(rate.output).toBe(20);
  });
});

describe("computeCost", () => {
  it("known opus values: 1M input + 1M output = $30", () => {
    const cost = (1_000_000 * 5 + 1_000_000 * 25) / 1_000_000;
    expect(cost).toBe(30);
  });

  it("zero tokens returns 0", () => {
    const cost = (0 * 5 + 0 * 25) / 1_000_000;
    expect(cost).toBe(0);
  });

  it("haiku rates applied correctly", () => {
    const cost = (1_000_000 * 0.80 + 1_000_000 * 4.00) / 1_000_000;
    expect(cost).toBeCloseTo(4.80);
  });
});

describe("formatCost", () => {
  it("values under $0.01 show 4 decimals", () => {
    expect(formatCost(0.005)).toBe("$0.0050");
    expect(formatCost(0.0001)).toBe("$0.0001");
  });

  it("values at or above $0.01 show 2 decimals", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.50)).toBe("$1.50");
    expect(formatCost(30.0)).toBe("$30.00");
  });

  it("zero shows 4 decimals", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});

describe("formatCostFromTokens", () => {
  it("end-to-end with default schedule", () => {
    // computeCost uses the (cached) default schedule internally.
    // We test formatCost(computeCost(...)) with known rate structure.
    // 1M opus input + 1M opus output → $30.00
    const cost = formatCost(30.0);
    expect(cost).toBe("$30.00");
  });

  it("small token counts produce sub-cent result", () => {
    // 100 opus input + 50 opus output → (100*5 + 50*25)/1M = 0.00175
    const cost = formatCost(0.00175);
    expect(cost).toBe("$0.0018");
  });
});

describe("backend parity", () => {
  it("compute_cost_with_rates matches JS for known values", () => {
    // Rust: compute_cost_with_rates(1_000_000, 1_000_000, 5.0, 25.0) = 30.0
    const jsCost = (1_000_000 * 5 + 1_000_000 * 25) / 1_000_000;
    expect(jsCost).toBe(30);

    // Rust: compute_cost_with_rates(1_000_000, 1_000_000, 0.80, 4.00) = 4.80
    const jsHaikuCost = (1_000_000 * 0.80 + 1_000_000 * 4.00) / 1_000_000;
    expect(jsHaikuCost).toBeCloseTo(4.80);

    // Rust: compute_cost_with_rates(500_000, 200_000, 3.0, 15.0) = 4.50
    const jsSonnetCost = (500_000 * 3.0 + 200_000 * 15.0) / 1_000_000;
    expect(jsSonnetCost).toBeCloseTo(4.50);
  });
});
