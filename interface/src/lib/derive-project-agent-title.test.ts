import { describe, expect, it } from "vitest";
import { deriveProjectAgentTitle } from "./derive-project-agent-title";

describe("deriveProjectAgentTitle", () => {
  it("returns the default title for blank prompts", () => {
    expect(deriveProjectAgentTitle("   ")).toBe("New Agent");
  });

  it("strips conversational lead-ins and produces a short title", () => {
    expect(
      deriveProjectAgentTitle("Can you fix the navbar spacing on mobile and add tests?"),
    ).toBe("Fix Navbar Spacing Mobile Tests");
  });

  it("uses the first non-empty line of a prompt", () => {
    expect(
      deriveProjectAgentTitle("\n\nBuild a checkout polling hook for billing.\nThen add tests."),
    ).toBe("Build Checkout Polling Hook Billing");
  });

  it("removes slash commands and urls", () => {
    expect(
      deriveProjectAgentTitle("/plan update the docs for https://example.com/api first"),
    ).toBe("Update Docs First");
  });
});
