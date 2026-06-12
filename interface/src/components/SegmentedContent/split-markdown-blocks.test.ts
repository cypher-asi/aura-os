import { describe, it, expect } from "vitest";
import { splitMarkdownBlocks } from "./split-markdown-blocks";

describe("splitMarkdownBlocks", () => {
  it("returns no blocks for empty content", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
  });

  it("keeps a single paragraph as one block", () => {
    expect(splitMarkdownBlocks("hello world")).toEqual(["hello world"]);
  });

  it("splits paragraphs at blank lines", () => {
    expect(splitMarkdownBlocks("para one\n\npara two\n\n\npara three")).toEqual([
      "para one",
      "para two",
      "para three",
    ]);
  });

  it("keeps multi-line constructs without blank lines together", () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";
    expect(splitMarkdownBlocks(table)).toEqual([table]);
  });

  it("does not split inside code fences, even across blank lines", () => {
    const content = "intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\noutro";
    expect(splitMarkdownBlocks(content)).toEqual([
      "intro",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```",
      "outro",
    ]);
  });

  it("treats an unclosed fence as running to the end", () => {
    const content = "before\n\n```sh\necho hi\n\necho still inside";
    expect(splitMarkdownBlocks(content)).toEqual([
      "before",
      "```sh\necho hi\n\necho still inside",
    ]);
  });

  it("respects tilde fences and longer closing runs", () => {
    const content = "~~~\ncode\n\nmore\n~~~~\n\nafter";
    expect(splitMarkdownBlocks(content)).toEqual(["~~~\ncode\n\nmore\n~~~~", "after"]);
  });
});
