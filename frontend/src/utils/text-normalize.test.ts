import {
  splitByCodeFences,
  stripEmojis,
  normalizeMidSentenceBreaks,
} from "./text-normalize";

describe("splitByCodeFences", () => {
  it("returns single prose segment for text without fences", () => {
    const result = splitByCodeFences("hello world");
    expect(result).toEqual([{ content: "hello world", isCode: false }]);
  });

  it("splits a fenced code block from surrounding prose", () => {
    const text = "before\n```\ncode\n```\nafter";
    const result = splitByCodeFences(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ content: "before\n", isCode: false });
    expect(result[1].isCode).toBe(true);
    expect(result[1].content).toContain("code");
    expect(result[2]).toEqual({ content: "after", isCode: false });
  });

  it("handles tilde fences", () => {
    const text = "before\n~~~\ncode\n~~~\nafter";
    const result = splitByCodeFences(text);
    const codeSegment = result.find((s) => s.isCode);
    expect(codeSegment).toBeDefined();
    expect(codeSegment!.content).toContain("code");
  });

  it("handles unclosed fence as code", () => {
    const text = "before\n```\nunclosed code";
    const result = splitByCodeFences(text);
    const codeSegment = result.find((s) => s.isCode);
    expect(codeSegment).toBeDefined();
  });

  it("handles multiple code blocks", () => {
    const text = "a\n```\nb\n```\nc\n```\nd\n```\ne";
    const result = splitByCodeFences(text);
    const codeSegments = result.filter((s) => s.isCode);
    expect(codeSegments).toHaveLength(2);
  });

  it("returns empty array content for empty string", () => {
    expect(splitByCodeFences("")).toEqual([]);
  });

  it("handles fence with language tag", () => {
    const text = "```typescript\nconst x = 1;\n```";
    const result = splitByCodeFences(text);
    expect(result).toHaveLength(1);
    expect(result[0].isCode).toBe(true);
  });

  it("requires matching fence char to close", () => {
    const text = "```\ncode\n~~~\nstill code\n```\nafter";
    const result = splitByCodeFences(text);
    const codeSegment = result.find((s) => s.isCode);
    expect(codeSegment!.content).toContain("still code");
  });
});

describe("stripEmojis", () => {
  it("removes emojis from prose and collapses double spaces", () => {
    const result = stripEmojis("Hello 🌍 World");
    expect(result).toBe("Hello World");
  });

  it("preserves emojis inside code fences", () => {
    const text = "before 🎉\n```\n🎉 code\n```\nafter 🎉";
    const result = stripEmojis(text);
    expect(result).toContain("🎉 code");
    expect(result).not.toMatch(/before.*🎉/);
  });

  it("collapses multi-spaces left by removed emojis", () => {
    const result = stripEmojis("a 🎉 b");
    expect(result).toBe("a b");
  });

  it("handles text without emojis", () => {
    expect(stripEmojis("plain text")).toBe("plain text");
  });

  it("handles empty string", () => {
    expect(stripEmojis("")).toBe("");
  });
});

describe("normalizeMidSentenceBreaks", () => {
  it("preserves paragraph breaks after sentences", () => {
    const text = "End of sentence.\n\nNew paragraph.";
    const result = normalizeMidSentenceBreaks(text);
    expect(result).toBe(text);
  });

  it("preserves paragraph breaks even in wrapped-looking sentences", () => {
    const text = "this is a long sentence that continues,\n\non the next line";
    const result = normalizeMidSentenceBreaks(text);
    expect(result).toBe(text);
  });

  it("preserves breaks around markdown blocks", () => {
    const text = "- item one\n\n- item two";
    const result = normalizeMidSentenceBreaks(text);
    expect(result).toBe(text);
  });

  it("preserves breaks around headings", () => {
    const text = "## Heading\n\nContent";
    const result = normalizeMidSentenceBreaks(text);
    expect(result).toBe(text);
  });

  it("does not modify code blocks", () => {
    const text = "```\nline1\n\n\nline2\n```";
    const result = normalizeMidSentenceBreaks(text);
    expect(result).toBe(text);
  });

  it("collapses table row gaps", () => {
    const text = "| A | B |\n\n| 1 | 2 |";
    const result = normalizeMidSentenceBreaks(text);
    expect(result).toBe("| A | B |\n| 1 | 2 |");
  });

  it("handles empty string", () => {
    expect(normalizeMidSentenceBreaks("")).toBe("");
  });

  it("preserves breaks after exclamation and question marks", () => {
    const text = "What?\n\nYes!";
    const result = normalizeMidSentenceBreaks(text);
    expect(result).toBe(text);
  });
});
