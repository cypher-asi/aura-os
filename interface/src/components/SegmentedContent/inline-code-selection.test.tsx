import { fireEvent, render } from "@testing-library/react";
import { SegmentedContent } from "./SegmentedContent";

afterEach(() => document.getSelection()?.removeAllRanges());

it.each(["src/my-file.test.ts", "--dry-run", "https://example.test/a-b", "日本語/🦋.txt", String.raw`C:\Users\me\.cache`])(
  "selects the full inline value without surrounding prose: %s", (value) => {
    const { container } = render(<SegmentedContent content={`Before \`${value}\` after.`} />);
    fireEvent.doubleClick(container.querySelector("code")!);
    expect(document.getSelection()?.toString()).toBe(value);
    expect(container.textContent).toBe(`Before ${value} after.`);
  },
);

it("keeps single clicks and code fences from replacing an existing selection", () => {
  const { container } = render(<SegmentedContent content={'Select `whole-value` first.\n\n```ts\nconst value = 42;\n```'} />);
  const [inline, fenced] = container.querySelectorAll("code");
  fireEvent.doubleClick(inline);
  fireEvent.click(fenced);
  expect(document.getSelection()?.toString()).toBe("whole-value");
  fireEvent.doubleClick(fenced);
  expect(document.getSelection()?.toString()).toBe("whole-value");
  expect(fenced.querySelector(".hljs-keyword")).not.toBeNull();
});
