import { render } from "@testing-library/react";
import type { ToolCallEntry } from "../../types/stream";

vi.mock("./ToolCallBlock.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../FilePreviewCard/FilePreviewCard.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../hooks/use-highlighted-html", () => ({
  useHighlightedHtml: (src: string) => src,
}));

import { SpecPreviewCard } from "./SpecPreviewCard";

function makeEntry(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "tc-1",
    name: "create_spec",
    input: {},
    pending: true,
    started: true,
    ...overrides,
  };
}

describe("SpecPreviewCard", () => {
  it("pins the code area to the bottom when markdown grows while pending", () => {
    const entry = makeEntry({
      input: { title: "Demo", markdown_contents: "# Line 1" },
    });
    const { container, rerender } = render(<SpecPreviewCard entry={entry} />);

    const codeArea = container.querySelector(".codeArea") as HTMLElement;
    expect(codeArea).not.toBeNull();
    Object.defineProperty(codeArea, "scrollHeight", { value: 500, configurable: true });
    codeArea.scrollTop = 0;

    rerender(
      <SpecPreviewCard
        entry={{
          ...entry,
          input: { title: "Demo", markdown_contents: "# Line 1\n\n# Line 2\n\n# Line 3\n\n# Line 4" },
        }}
      />,
    );

    expect(codeArea.scrollTop).toBe(500);
  });

  it("does not auto-scroll after the tool call has completed", () => {
    const entry = makeEntry({
      pending: false,
      started: false,
      input: { title: "Done", markdown_contents: "# Short" },
    });
    const { container, rerender } = render(<SpecPreviewCard entry={entry} />);

    const codeArea = container.querySelector(".codeArea") as HTMLElement;
    expect(codeArea).not.toBeNull();
    Object.defineProperty(codeArea, "scrollHeight", { value: 800, configurable: true });
    codeArea.scrollTop = 120;

    rerender(
      <SpecPreviewCard
        entry={{
          ...entry,
          input: {
            title: "Done",
            markdown_contents: "# Short\n\n# Extra content that should not force a scroll",
          },
        }}
      />,
    );

    expect(codeArea.scrollTop).toBe(120);
  });

  it("renders the spinner while pending and empty", () => {
    const { container } = render(<SpecPreviewCard entry={makeEntry({ input: {} })} />);
    expect(container.querySelector(".spinner")).not.toBeNull();
  });
});
