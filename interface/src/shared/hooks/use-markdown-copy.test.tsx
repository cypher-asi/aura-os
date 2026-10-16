import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentedContent } from "../../components/SegmentedContent";
import { useMarkdownCopy } from "./use-markdown-copy";

const markdown = "```ts\nconst value = 1;\n```";
function MarkdownCopyFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useMarkdownCopy(ref, () => markdown);
  return <div ref={ref} data-testid="markdown"><SegmentedContent content={markdown} /></div>;
}

afterEach(() => vi.restoreAllMocks());

it("copies the original Markdown when the full source selection excludes wrap controls", () => {
  render(<MarkdownCopyFixture />);
  const node = screen.getByTestId("markdown");
  const range = document.createRange();
  range.selectNodeContents(node);
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1, isCollapsed: false, toString: () => "const value = 1;\n",
    getRangeAt: () => range,
  } as unknown as Selection);
  const data = { setData: vi.fn() };
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  fireEvent(node, event);
  expect(event.defaultPrevented).toBe(true);
  expect(data.setData).toHaveBeenCalledWith("text/plain", markdown);
  expect(data.setData).toHaveBeenCalledWith("text/html", expect.stringContaining("<pre><code"));
  expect(screen.getByRole("button", { name: "Wrap code" })).toBeInTheDocument();
});

it("leaves partial selections to the browser even when controls are present", () => {
  render(<MarkdownCopyFixture />);
  const node = screen.getByTestId("markdown");
  const range = document.createRange();
  range.selectNodeContents(node);
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1, isCollapsed: false, toString: () => "value", getRangeAt: () => range,
  } as unknown as Selection);
  const data = { setData: vi.fn() };
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  fireEvent(node, event);
  expect(event.defaultPrevented).toBe(false);
  expect(data.setData).not.toHaveBeenCalled();
});
