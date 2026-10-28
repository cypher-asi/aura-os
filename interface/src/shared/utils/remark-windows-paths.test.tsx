import { render } from "@testing-library/react";
import { SegmentedContent } from "../../components/SegmentedContent/SegmentedContent";
import { markdownToHtml } from "./markdown-to-html";

function richCopyText(source: string) {
  const node = document.createElement("div");
  node.innerHTML = markdownToHtml(source);
  return node.textContent;
}

it.each([
  String.raw`Saved to C:\Users\me\.cache\_build\[draft]\file.txt`,
  String.raw`Read D:\work\!notes\#heading\(copy)\file.md`,
  String.raw`Use (c:\.scratch) or C:/work\.config.`,
  String.raw`Already escaped C:\\Users\\me`,
  String.raw`日本語 🦋 at Z:\資料\_保存\file.txt`,
])("preserves Windows separators in rendered prose and rich clipboard HTML: %s", (source) => {
  const { container } = render(<SegmentedContent content={source} />);
  expect(container.textContent).toBe(source);
  expect(richCopyText(source)).toBe(source);
});

it("keeps ordinary escapes, emphasis, inline code and links working", () => {
  const source = String.raw`C:\x and \*literal\* plus **bold** and [link](https://example.test/a\(b\)).`;
  const { container } = render(<SegmentedContent content={source} />);
  expect(container.textContent).toBe(String.raw`C:\x and *literal* plus bold and link.`);
  expect(container.querySelector("strong")).toHaveTextContent("bold");
  expect(container.querySelector("a")).toHaveAttribute("href", "https://example.test/a(b)");
  expect(richCopyText(source)).toBe(container.textContent);
});

it("leaves fenced and inline code exact and renders growing paths consistently", () => {
  const source = String.raw`C:\me\.cache\_build`;
  const { container, rerender } = render(<SegmentedContent content={source.slice(0, -3)} />);
  rerender(<SegmentedContent content={source} />);
  expect(container.textContent).toBe(source);
  rerender(<SegmentedContent content={`\`${source}\`\n\n\`\`\`txt\n${source}\n\`\`\``} />);
  expect(container.querySelectorAll("code")[0].textContent).toBe(source);
  expect(container.querySelectorAll("code")[1].textContent).toBe(`${source}\n`);
});
