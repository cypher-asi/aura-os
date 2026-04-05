import { renderHook } from "@testing-library/react";
import { getStreamSafeContent, useStreamSafeContent } from "./use-stream-safe-content";

describe("getStreamSafeContent", () => {
  it("returns full text when not streaming", () => {
    expect(getStreamSafeContent("**bold", false)).toBe("**bold");
  });

  it("returns full text when streaming with empty input", () => {
    expect(getStreamSafeContent("", true)).toBe("");
  });

  it("returns full text when all constructs are closed", () => {
    expect(getStreamSafeContent("**bold** text", true)).toBe("**bold** text");
  });

  describe("trailing emphasis", () => {
    it("trims unclosed single asterisk emphasis", () => {
      const result = getStreamSafeContent("hello *world", true);
      expect(result).not.toContain("*world");
    });

    it("trims unclosed double asterisk emphasis", () => {
      const result = getStreamSafeContent("hello **bold text", true);
      expect(result).not.toContain("**bold");
    });

    it("keeps closed emphasis intact", () => {
      expect(getStreamSafeContent("hello *world* end", true)).toBe("hello *world* end");
    });
  });

  describe("unclosed code fences", () => {
    it("trims unclosed backtick code fence", () => {
      const result = getStreamSafeContent("before\n```\ncode here", true);
      expect(result).toBe("before");
    });

    it("trims unclosed tilde code fence", () => {
      const result = getStreamSafeContent("before\n~~~\ncode here", true);
      expect(result).toBe("before");
    });

    it("keeps closed code fence", () => {
      const input = "before\n```\ncode\n```\nafter";
      expect(getStreamSafeContent(input, true)).toBe(input);
    });
  });

  describe("unclosed inline code", () => {
    it("trims trailing backtick without opening match", () => {
      const result = getStreamSafeContent("hello world`", true);
      expect(result).toBe("hello world");
    });

    it("keeps matched inline code", () => {
      expect(getStreamSafeContent("use `code` here", true)).toBe("use `code` here");
    });
  });

  describe("incomplete links", () => {
    it("trims unclosed link bracket", () => {
      const result = getStreamSafeContent("text [link text", true);
      expect(result.includes("[link text")).toBe(false);
    });

    it("keeps completed links", () => {
      const input = "text [link](url) end";
      expect(getStreamSafeContent(input, true)).toBe(input);
    });
  });

  describe("incomplete headings", () => {
    it("trims standalone heading marker at end", () => {
      const result = getStreamSafeContent("text\n## ", true);
      expect(result).toBe("text");
    });

    it("keeps heading with content", () => {
      const input = "text\n## Title";
      expect(getStreamSafeContent(input, true)).toBe(input);
    });
  });
});

describe("useStreamSafeContent", () => {
  it("returns safe content via the hook wrapper", () => {
    const { result } = renderHook(() =>
      useStreamSafeContent("hello *world", true),
    );
    expect(result.current).not.toContain("*world");
  });

  it("returns full content when not streaming", () => {
    const { result } = renderHook(() =>
      useStreamSafeContent("hello *world", false),
    );
    expect(result.current).toBe("hello *world");
  });
});
