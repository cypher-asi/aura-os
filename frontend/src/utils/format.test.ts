import {
  formatTime,
  toBullets,
  formatTokens,
  formatCompact,
  formatCurrency,
  formatCost,
  formatDuration,
  summarizeInput,
  formatResult,
  formatRelativeTime,
  formatChatTime,
} from "./format";

describe("formatTime", () => {
  it("formats a date as HH:MM:SS", () => {
    const d = new Date("2024-01-15T14:05:09Z");
    const result = formatTime(d);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("toBullets", () => {
  it("converts plain text to bullets, splitting by sentence", () => {
    const text = "First sentence. Second sentence.";
    const result = toBullets(text);
    expect(result).toBe("- First sentence.\n- Second sentence.");
  });

  it("promotes standalone bold labels to headings", () => {
    const text = "**Overview:**";
    expect(toBullets(text)).toBe("### Overview:");
  });

  it("preserves existing markdown structure", () => {
    const text = "- Already a bullet\n## Already a heading";
    const result = toBullets(text);
    expect(result).toContain("- Already a bullet");
    expect(result).toContain("## Already a heading");
  });

  it("wraps lines with inline code as single bullet", () => {
    const text = "Use the `formatTime` function. It accepts a Date.";
    const result = toBullets(text);
    expect(result).toBe("- Use the `formatTime` function. It accepts a Date.");
  });

  it("skips empty lines", () => {
    const text = "Line one.\n\nLine two.";
    const result = toBullets(text);
    expect(result).toBe("- Line one.\n- Line two.");
  });

  it("preserves numbered lists", () => {
    const text = "1. First\n2. Second";
    const result = toBullets(text);
    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });
});

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(1_000_000)).toBe("1M");
  });

  it("formats tens of thousands", () => {
    expect(formatTokens(50_000)).toBe("50K");
    expect(formatTokens(10_000)).toBe("10K");
  });

  it("formats small numbers with locale string", () => {
    const result = formatTokens(999);
    expect(result).toBe("999");
  });
});

describe("formatCompact", () => {
  it("formats billions", () => {
    expect(formatCompact(1_500_000_000)).toBe("1.5B");
    expect(formatCompact(10_000_000_000)).toBe("10B");
  });

  it("formats millions", () => {
    expect(formatCompact(5_500_000)).toBe("5.5M");
    expect(formatCompact(10_000_000)).toBe("10M");
  });

  it("formats thousands", () => {
    expect(formatCompact(50_000)).toBe("50K");
    expect(formatCompact(100_000)).toBe("100K");
  });

  it("formats small numbers", () => {
    expect(formatCompact(42)).toBe("42");
  });
});

describe("formatCurrency", () => {
  it("formats millions", () => {
    expect(formatCurrency(2_500_000)).toBe("$2.5M");
  });

  it("formats thousands", () => {
    expect(formatCurrency(1_500)).toBe("$1.5K");
  });

  it("formats dollars", () => {
    expect(formatCurrency(9.99)).toBe("$9.99");
  });

  it("formats small cents", () => {
    expect(formatCurrency(0.05)).toBe("$0.05");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });
});

describe("formatCost", () => {
  it("formats small costs with 4 decimals", () => {
    expect(formatCost(0.005)).toBe("$0.0050");
    expect(formatCost(0.0001)).toBe("$0.0001");
  });

  it("formats larger costs with 2 decimals", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.50)).toBe("$1.50");
    expect(formatCost(30.0)).toBe("$30.00");
  });

  it("formats zero", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(59000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_660_000)).toBe("61m 0s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("rounds to nearest second", () => {
    expect(formatDuration(1499)).toBe("1s");
    expect(formatDuration(1500)).toBe("2s");
  });
});

describe("summarizeInput", () => {
  it("returns path for file operations", () => {
    expect(summarizeInput("read_file", { path: "src/main.ts" })).toBe("src/main.ts");
    expect(summarizeInput("write_file", { path: "out.txt" })).toBe("out.txt");
    expect(summarizeInput("delete_file", { path: "tmp.log" })).toBe("tmp.log");
  });

  it("returns path for list_files (or empty for root)", () => {
    expect(summarizeInput("list_files", { path: "src" })).toBe("src");
    expect(summarizeInput("list_files", { path: "." })).toBe("");
  });

  it("returns title for create_spec and create_task", () => {
    expect(summarizeInput("create_spec", { title: "My Spec" })).toBe("My Spec");
    expect(summarizeInput("create_task", { title: "My Task" })).toBe("My Task");
  });

  it("returns truncated spec_id for get_spec", () => {
    expect(summarizeInput("get_spec", { spec_id: "abcdefghij" })).toBe("abcdefgh");
  });

  it("returns task_id and status for transition_task", () => {
    const result = summarizeInput("transition_task", {
      task_id: "12345678xx",
      status: "done",
    });
    expect(result).toBe("12345678 → done");
  });

  it("returns empty string for unknown tools", () => {
    expect(summarizeInput("unknown_tool", {})).toBe("");
  });

  it("returns empty string when input fields are missing", () => {
    expect(summarizeInput("read_file", {})).toBe("");
  });
});

describe("formatResult", () => {
  it("pretty-prints valid JSON", () => {
    const result = formatResult('{"key":"value"}');
    expect(result).toBe('{\n  "key": "value"\n}');
  });

  it("returns raw string for invalid JSON", () => {
    const result = formatResult("not json");
    expect(result).toBe("not json");
  });

  it("handles empty string", () => {
    expect(formatResult("")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for <60s ago", () => {
    const now = new Date("2024-06-15T12:00:30Z");
    vi.setSystemTime(now);
    expect(formatRelativeTime("2024-06-15T12:00:00Z")).toBe("just now");
  });

  it("returns minutes ago", () => {
    const now = new Date("2024-06-15T12:05:00Z");
    vi.setSystemTime(now);
    expect(formatRelativeTime("2024-06-15T12:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const now = new Date("2024-06-15T15:00:00Z");
    vi.setSystemTime(now);
    expect(formatRelativeTime("2024-06-15T12:00:00Z")).toBe("3h ago");
  });

  it("returns days ago", () => {
    const now = new Date("2024-06-18T12:00:00Z");
    vi.setSystemTime(now);
    expect(formatRelativeTime("2024-06-15T12:00:00Z")).toBe("3d ago");
  });

  it("returns formatted date for >7 days", () => {
    const now = new Date("2024-07-01T12:00:00Z");
    vi.setSystemTime(now);
    const result = formatRelativeTime("2024-06-15T12:00:00Z");
    expect(result).toMatch(/Jun/);
  });
});

describe("formatChatTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns time for today", () => {
    const now = new Date("2024-06-15T18:00:00Z");
    vi.setSystemTime(now);
    const result = formatChatTime("2024-06-15T14:30:00Z");
    expect(result).toMatch(/\d{1,2}:\d{2}\s?(am|pm)/i);
  });

  it("returns 'yesterday' for yesterday", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    vi.setSystemTime(now);
    expect(formatChatTime("2024-06-14T10:00:00Z")).toBe("yesterday");
  });

  it("returns weekday name for <7 days ago", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    vi.setSystemTime(now);
    const result = formatChatTime("2024-06-12T10:00:00Z");
    expect(result).toMatch(/Wed/i);
  });

  it("returns month/day for >7 days ago", () => {
    const now = new Date("2024-07-01T12:00:00Z");
    vi.setSystemTime(now);
    const result = formatChatTime("2024-06-10T10:00:00Z");
    expect(result).toMatch(/Jun/);
  });
});
