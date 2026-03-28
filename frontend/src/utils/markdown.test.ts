import { getStreamSafeContent } from "../hooks/use-stream-safe-content";

describe("getStreamSafeContent", () => {
  it("returns full content when not streaming", () => {
    expect(getStreamSafeContent("***bold***", false)).toBe("***bold***");
  });

  it("returns empty string unchanged", () => {
    expect(getStreamSafeContent("", true)).toBe("");
  });

  it("returns complete markdown unchanged during streaming", () => {
    expect(getStreamSafeContent("**bold** text", true)).toBe("**bold** text");
  });

  it("trims unclosed fenced code block during streaming", () => {
    const input = "Hello\n\n```typescript\nconst x = 1;";
    expect(getStreamSafeContent(input, true)).toBe("Hello");
  });

  it("keeps closed fenced code block during streaming", () => {
    const input = "Hello\n\n```typescript\nconst x = 1;\n```\n\nAfter";
    expect(getStreamSafeContent(input, true)).toBe(input);
  });

  it("trims trailing backticks that look like unclosed inline code", () => {
    const input = "some text `";
    expect(getStreamSafeContent(input, true)).toBe("some text ");
  });

  it("keeps closed inline code", () => {
    const input = "some `code` here";
    expect(getStreamSafeContent(input, true)).toBe("some `code` here");
  });

  it("trims incomplete heading at end of stream", () => {
    const input = "paragraph text\n## ";
    expect(getStreamSafeContent(input, true)).toBe("paragraph text");
  });

  it("keeps complete heading", () => {
    const input = "paragraph\n\n## Title";
    expect(getStreamSafeContent(input, true)).toBe("paragraph\n\n## Title");
  });

  it("handles plain text without any markdown", () => {
    const input = "Just some plain text.";
    expect(getStreamSafeContent(input, true)).toBe("Just some plain text.");
  });
});
