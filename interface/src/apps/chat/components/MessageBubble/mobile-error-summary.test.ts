import { describe, expect, it } from "vitest";
import { mobileErrorSummary } from "./mobile-error-summary";

describe("mobileErrorSummary", () => {
  it("does not confuse provider billing with the user's credit balance", () => {
    expect(mobileErrorSummary('API error: provider_account_unavailable')).toContain("model is temporarily unavailable");
    expect(mobileErrorSummary("no credits", "insufficientCreditsError")).toContain("Add credits");
  });
  it.each([
    ["harnessCapacityExhaustedError", "AURA is busy"],
    ["agentBusyError", "agent is busy"],
    ["streamDropped", "connection was interrupted"],
  ])("summarizes %s without leaking diagnostics", (variant, copy) => {
    const summary = mobileErrorSummary("private-host 10.0.0.1", variant);
    expect(summary).toContain(copy);
    expect(summary).not.toContain("private-host");
  });
  it("keeps unknown technical errors out of the main transcript", () => {
    expect(mobileErrorSummary("HTTP 500: internal-host /private/path")).not.toContain("internal-host");
  });
});
