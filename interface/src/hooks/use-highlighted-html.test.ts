import { renderHook } from "@testing-library/react";
import { useHighlightedHtml } from "./use-highlighted-html";

describe("useHighlightedHtml", () => {
  it("returns empty string for empty code", () => {
    const { result } = renderHook(() => useHighlightedHtml(""));
    expect(result.current).toBe("");
  });

  it("highlights code with a specified language", () => {
    const code = "const x = 1;";
    const { result } = renderHook(() => useHighlightedHtml(code, "javascript"));
    expect(result.current).toContain("<span");
    expect(result.current).toContain("x");
  });

  it("auto-detects language when none specified", () => {
    const code = "function hello() { return 42; }";
    const { result } = renderHook(() => useHighlightedHtml(code));
    expect(result.current.length).toBeGreaterThan(0);
  });

  it("escapes HTML for code exceeding MAX_HIGHLIGHT_SIZE", () => {
    const code = "<script>alert('xss')</script>" + "a".repeat(100_001);
    const { result } = renderHook(() => useHighlightedHtml(code));
    expect(result.current).toContain("&lt;script&gt;");
    expect(result.current).not.toContain("<script>");
  });

  it("escapes HTML when language is unknown", () => {
    const code = "<b>hi</b>";
    const { result } = renderHook(() =>
      useHighlightedHtml(code, "not_a_real_language_xyz"),
    );
    expect(result.current).not.toContain("<b>");
  });

  it("memoises the result for same inputs", () => {
    const code = "let a = 1;";
    const { result, rerender } = renderHook(() =>
      useHighlightedHtml(code, "javascript"),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
