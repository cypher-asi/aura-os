import {
  formatTime,
  toBullets,
  formatTokens,
  formatTokensCompact,
  formatCompact,
  formatCurrency,
  formatCost,
  formatDuration,
  summarizeInput,
  formatResult,
  decodeCapturedOutput,
  summarizeError,
  formatRelativeTime,
  formatChatTime,
  slugifyTitle,
  specFilename,
} from "./format";

describe("slugifyTitle", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugifyTitle("Hello World Website")).toBe("hello-world-website");
  });

  it("collapses consecutive non-alphanumeric characters into a single dash", () => {
    expect(slugifyTitle("Spec!!  with   weird___chars")).toBe("spec-with-weird-chars");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugifyTitle("  --Trim me--  ")).toBe("trim-me");
  });

  it("strips diacritics from accented characters", () => {
    expect(slugifyTitle("Café résumé naïveté")).toBe("cafe-resume-naivete");
  });

  it("falls back to 'spec' for empty or slug-less input", () => {
    expect(slugifyTitle("")).toBe("spec");
    expect(slugifyTitle("???")).toBe("spec");
    expect(slugifyTitle("   ")).toBe("spec");
  });
});

describe("specFilename", () => {
  it("appends .md to the slugified title", () => {
    expect(specFilename("Hello World Website")).toBe("hello-world-website.md");
  });

  it("uses the spec fallback for empty titles", () => {
    expect(specFilename("")).toBe("spec.md");
  });
});

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

describe("formatTokensCompact", () => {
  it("formats millions with one decimal", () => {
    expect(formatTokensCompact(1_500_000)).toBe("1.5M");
    expect(formatTokensCompact(1_000_000)).toBe("1.0M");
  });

  it("formats thousands (>= 1,000) with lowercase k", () => {
    expect(formatTokensCompact(1_000)).toBe("1.0k");
    expect(formatTokensCompact(50_000)).toBe("50.0k");
    expect(formatTokensCompact(999_999)).toBe("1000.0k");
  });

  it("returns plain number string below 1,000", () => {
    expect(formatTokensCompact(999)).toBe("999");
    expect(formatTokensCompact(0)).toBe("0");
    expect(formatTokensCompact(1)).toBe("1");
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

  it("respects explicit decimals parameter for values >= 0.01", () => {
    expect(formatCost(1.5, 3)).toBe("$1.500");
    expect(formatCost(0.5, 0)).toBe("$1");
    expect(formatCost(25, 1)).toBe("$25.0");
  });

  it("ignores decimals parameter for values < 0.01 (always 4 decimals)", () => {
    expect(formatCost(0.005, 2)).toBe("$0.0050");
    expect(formatCost(0.0001, 0)).toBe("$0.0001");
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

  it("decodes base64 stdout/stderr emitted by the server", () => {
    const payload = JSON.stringify({
      tool: "run_command",
      ok: true,
      stdout: btoa("hello world\n"),
      stderr: btoa(""),
    });
    const out = formatResult(payload);
    expect(out).toContain('"stdout": "hello world\\n"');
  });

  it("decodes base64 output that contains ANSI color escapes (cargo, rustc, ...)", () => {
    // Simulate a colored `cargo check` error line: ESC[31m...ESC[0m
    const colored = "\x1B[31merror[E0433]\x1B[0m: cannot find crate `foo`\n";
    const payload = JSON.stringify({
      tool: "run_command",
      ok: false,
      stderr: btoa(colored),
    });
    const out = formatResult(payload);
    expect(out).toContain("error[E0433]");
    expect(out).toContain("cannot find crate `foo`");
    expect(out).not.toMatch(/\x1B\[/);
    expect(out).not.toContain(btoa(colored));
  });

  it("decodes base64 values under non-stdout output keys (output/text/content/log)", () => {
    const payload = JSON.stringify({
      output: btoa("compiled OK\n"),
      log: btoa("line 1\nline 2\n"),
    });
    const out = formatResult(payload);
    expect(out).toContain('"output": "compiled OK\\n"');
    expect(out).toContain('"log": "line 1\\nline 2\\n"');
  });

  it("does not mangle non-base64 strings that happen to match the charset", () => {
    const payload = JSON.stringify({ stdout: "ThisIsNotBase64" });
    const out = formatResult(payload);
    expect(out).toContain('"stdout": "ThisIsNotBase64"');
  });
});

describe("decodeCapturedOutput", () => {
  it("decodes base64 stdout/stderr and returns exit_code", () => {
    const payload = JSON.stringify({
      tool: "run_command",
      ok: true,
      stdout: btoa("Hello, World!\n"),
      stderr: btoa(""),
      exit_code: 0,
    });
    const out = decodeCapturedOutput(payload);
    expect(out.stdout).toBe("Hello, World!\n");
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
    expect(out.ok).toBe(true);
  });

  it("strips ANSI escapes from decoded output", () => {
    const colored = "\x1B[31merror\x1B[0m: boom\n";
    const payload = JSON.stringify({ ok: false, stderr: btoa(colored) });
    const out = decodeCapturedOutput(payload);
    expect(out.stderr).toBe("error: boom\n");
    expect(out.ok).toBe(false);
  });

  it("returns metadata when present", () => {
    const payload = JSON.stringify({
      tool: "read_file",
      ok: true,
      stdout: btoa("fn main() {}\n"),
      stderr: "",
      metadata: { size: 13 },
    });
    const out = decodeCapturedOutput(payload);
    expect(out.stdout).toBe("fn main() {}\n");
    expect(out.metadata).toEqual({ size: 13 });
  });

  it("treats non-JSON input as a single captured-output string", () => {
    const out = decodeCapturedOutput(btoa("plain text\n"));
    expect(out.stdout).toBe("plain text\n");
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBeNull();
    expect(out.ok).toBeNull();
  });

  it("returns empty fields for undefined input", () => {
    const out = decodeCapturedOutput(undefined);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBeNull();
    expect(out.ok).toBeNull();
    expect(out.metadata).toBeNull();
  });

  it("passes non-base64 strings through untouched", () => {
    const payload = JSON.stringify({ stdout: "ThisIsNotBase64", stderr: "" });
    const out = decodeCapturedOutput(payload);
    expect(out.stdout).toBe("ThisIsNotBase64");
  });
});

describe("summarizeError", () => {
  it("strips ANSI escapes from a base64-encoded stderr first line", () => {
    const colored = "\x1B[31merror\x1B[0m: something broke\nmore detail\n";
    const payload = JSON.stringify({
      tool: "run_command",
      ok: false,
      stderr: btoa(colored),
    });
    const summary = summarizeError(payload);
    expect(summary).toBe("error: something broke");
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
