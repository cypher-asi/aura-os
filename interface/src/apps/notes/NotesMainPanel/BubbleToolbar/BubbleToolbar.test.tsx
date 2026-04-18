import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { BubbleToolbar } from "./BubbleToolbar";

vi.mock("./BubbleToolbar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

function makeFakeEditor(overrides: Partial<Record<string, boolean>> = {}): Editor {
  const runs: string[] = [];
  const chain = {
    focus: () => chain,
    toggleBold: () => {
      runs.push("bold");
      return chain;
    },
    toggleItalic: () => {
      runs.push("italic");
      return chain;
    },
    toggleStrike: () => {
      runs.push("strike");
      return chain;
    },
    toggleCode: () => {
      runs.push("code");
      return chain;
    },
    toggleHeading: (opts: { level: number }) => {
      runs.push(`heading-${opts.level}`);
      return chain;
    },
    toggleBulletList: () => {
      runs.push("bulletList");
      return chain;
    },
    toggleOrderedList: () => {
      runs.push("orderedList");
      return chain;
    },
    toggleBlockquote: () => {
      runs.push("blockquote");
      return chain;
    },
    run: () => true,
  };
  const fake = {
    isActive: (name: string) => overrides[name] === true,
    chain: () => chain,
    __runs: runs,
  } as unknown as Editor & { __runs: string[] };
  return fake;
}

describe("BubbleToolbar", () => {
  it("renders nothing when the editor is null", () => {
    const { container } = render(<BubbleToolbar editor={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one labelled button per action", () => {
    render(<BubbleToolbar editor={makeFakeEditor()} />);
    for (const label of [
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Heading 1",
      "Heading 2",
      "Bullet list",
      "Ordered list",
      "Blockquote",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("runs the editor command on mouseDown so selection is preserved", () => {
    const editor = makeFakeEditor() as Editor & { __runs: string[] };
    render(<BubbleToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Bold" }));
    expect(editor.__runs).toContain("bold");
  });

  it("marks the active action with data-active=\"true\"", () => {
    const editor = makeFakeEditor({ bold: true });
    render(<BubbleToolbar editor={editor} />);
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("button", { name: "Italic" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });
});
