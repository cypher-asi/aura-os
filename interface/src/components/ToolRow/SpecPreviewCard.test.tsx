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
  it("renders draft_preview while real markdown_contents is still empty", () => {
    const { container, getByText } = render(
      <SpecPreviewCard
        entry={makeEntry({
          input: { draft_preview: "# Draft from assistant stream" },
        })}
      />,
    );

    expect(getByText("spec.md")).toBeInTheDocument();
    expect(container.querySelector(".spinner")).toBeNull();
    expect(container.textContent).toContain("Draft from assistant stream");
  });

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

  it("switches from draft_preview to real markdown_contents once it arrives", () => {
    const entry = makeEntry({
      input: { draft_preview: "# Draft preview" },
    });
    const { container, rerender } = render(<SpecPreviewCard entry={entry} />);

    expect(container.textContent).toContain("Draft preview");

    rerender(
      <SpecPreviewCard
        entry={{
          ...entry,
          input: {
            draft_preview: "# Draft preview",
            markdown_contents: "# Final markdown",
          },
        }}
      />,
    );

    expect(container.textContent).toContain("Final markdown");
    expect(container.textContent).not.toContain("Draft preview");
  });

  it("renders an empty code area (no spinner) while pending and empty", () => {
    const { container } = render(<SpecPreviewCard entry={makeEntry({ input: {} })} />);
    expect(container.querySelector(".spinner")).toBeNull();
    expect(container.querySelector(".codeArea")).not.toBeNull();
    expect(container.querySelector(".streamCaret")).not.toBeNull();
  });

  it("does not render a blinking caret once the tool call has completed", () => {
    const { container } = render(
      <SpecPreviewCard
        entry={makeEntry({
          pending: false,
          started: false,
          input: { markdown_contents: "# Done" },
        })}
      />,
    );
    expect(container.querySelector(".streamCaret")).toBeNull();
  });
});
