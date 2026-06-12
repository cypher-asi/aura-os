import { blockStatusForSeverity, deriveToolSeverity } from "./tool-severity";
import type { ToolCallEntry } from "../shared/types/stream";

function entry(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "tc-1",
    name: "run_command",
    input: {},
    pending: false,
    started: false,
    ...overrides,
  };
}

describe("deriveToolSeverity", () => {
  it("is pending while the tool is in flight", () => {
    expect(deriveToolSeverity(entry({ pending: true }))).toBe("pending");
  });

  it("is ok for a clean result", () => {
    expect(deriveToolSeverity(entry())).toBe("ok");
    expect(deriveToolSeverity(entry(), 0)).toBe("ok");
  });

  it("is attention (not error) for a soft tool failure the agent absorbed", () => {
    expect(deriveToolSeverity(entry({ isError: true }))).toBe("attention");
  });

  it("is attention (not error) for a non-zero exit code", () => {
    expect(deriveToolSeverity(entry(), 128)).toBe("attention");
    expect(deriveToolSeverity(entry(), 1)).toBe("attention");
  });

  it("is error only when the retry budget is exhausted", () => {
    expect(
      deriveToolSeverity(entry({ isError: true, retryExhausted: true })),
    ).toBe("error");
  });

  it("treats a null exit code as no signal", () => {
    expect(deriveToolSeverity(entry(), null)).toBe("ok");
  });
});

describe("blockStatusForSeverity", () => {
  it("maps each severity onto the Block status vocabulary", () => {
    expect(blockStatusForSeverity("pending")).toBe("pending");
    expect(blockStatusForSeverity("ok")).toBe("done");
    expect(blockStatusForSeverity("attention")).toBe("attention");
    expect(blockStatusForSeverity("error")).toBe("error");
  });
});
