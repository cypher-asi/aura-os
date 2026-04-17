import { displaySessionStatus } from "./displaySessionStatus";

describe("displaySessionStatus", () => {
  it("keeps 'active' for the newest session in a group", () => {
    expect(displaySessionStatus("active", true)).toBe("active");
  });

  it("collapses 'active' to 'completed' for older sessions", () => {
    expect(displaySessionStatus("active", false)).toBe("completed");
  });

  it("passes through non-active statuses regardless of position", () => {
    expect(displaySessionStatus("completed", true)).toBe("completed");
    expect(displaySessionStatus("completed", false)).toBe("completed");
    expect(displaySessionStatus("failed", true)).toBe("failed");
    expect(displaySessionStatus("failed", false)).toBe("failed");
    expect(displaySessionStatus("rolled_over", true)).toBe("rolled_over");
    expect(displaySessionStatus("rolled_over", false)).toBe("rolled_over");
  });
});
