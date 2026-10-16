import { describe, expect, it } from "vitest";
import { findDiffMatches, MAX_DIFF_SEARCH_MATCHES } from "./diff-search";

describe("findDiffMatches", () => {
  it("finds each case-insensitive occurrence in patch order", () => {
    expect(findDiffMatches(["-Name name", "+NAME", " context"], "name")).toEqual({
      matches: [
        { line: 0, start: 1, end: 5 },
        { line: 0, start: 6, end: 10 },
        { line: 1, start: 1, end: 5 },
      ],
      limited: false,
    });
  });

  it("treats regex characters literally", () => {
    const literal = ".*+?^${}()|[]\\";
    expect(findDiffMatches([`+${literal}`, "+something else"], literal).matches)
      .toEqual([{ line: 0, start: 1, end: literal.length + 1 }]);
  });

  it("preserves whitespace in queries", () => {
    expect(findDiffMatches(["+a  b", "+a b"], "  ").matches)
      .toEqual([{ line: 0, start: 2, end: 4 }]);
  });

  it("keeps offsets in original text after Unicode characters", () => {
    expect(findDiffMatches(["+İ😀NAME"], "name").matches)
      .toEqual([{ line: 0, start: 4, end: 8 }]);
  });

  it("returns no matches for empty or absent text", () => {
    expect(findDiffMatches(["+text"], "")).toEqual({ matches: [], limited: false });
    expect(findDiffMatches(["+text"], "missing")).toEqual({ matches: [], limited: false });
    expect(findDiffMatches([], "text")).toEqual({ matches: [], limited: false });
  });

  it("bounds highlight allocations and discloses omitted matches", () => {
    const result = findDiffMatches(["a".repeat(MAX_DIFF_SEARCH_MATCHES + 1)], "a");
    expect(result.matches).toHaveLength(MAX_DIFF_SEARCH_MATCHES);
    expect(result.limited).toBe(true);
    expect(findDiffMatches(["a".repeat(MAX_DIFF_SEARCH_MATCHES)], "a").limited).toBe(false);
  });
});
