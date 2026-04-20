import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));

import { NotesTocPanel } from "./NotesTocPanel";
import { useNotesStore, makeNoteKey } from "../../../stores/notes-store";

function seedActiveNote(content: string) {
  const projectId = "proj-1";
  const relPath = "Notes/Idea.md";
  const key = makeNoteKey(projectId, relPath);
  useNotesStore.setState({
    activeProjectId: projectId,
    activeRelPath: relPath,
    contentCache: {
      [key]: {
        content,
        title: "Big Ideas",
        absPath: "C:/projects/proj-1/Notes/Idea.md",
        frontmatter: {},
        updatedAt: undefined,
        wordCount: 0,
        dirty: false,
      },
    },
  });
}

describe("NotesTocPanel", () => {
  beforeEach(() => {
    useNotesStore.setState({
      activeProjectId: null,
      activeRelPath: null,
      contentCache: {},
    });
    document.body.innerHTML = "";
  });

  it("renders TOC items for markdown headings, skipping frontmatter and code fences", () => {
    seedActiveNote(
      [
        "---",
        "title: Ignore this",
        "# not-a-heading",
        "---",
        "# Top",
        "## Middle",
        "```",
        "# heading in code fence",
        "```",
        "### Inner",
      ].join("\n"),
    );

    render(<NotesTocPanel />);

    for (const heading of ["Top", "Middle", "Inner"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(heading) }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /heading in code fence/ }),
    ).not.toBeInTheDocument();
  });

  it("shows 'No headings yet' when the note has no markdown headings", () => {
    seedActiveNote("Just a body paragraph with no headings.");
    render(<NotesTocPanel />);
    expect(screen.getByText("No headings yet")).toBeInTheDocument();
  });

  it("scrolls the N-th editor heading into view on click", () => {
    seedActiveNote("# One\n## Two\n### Three\n");

    const editorRoot = document.createElement("div");
    editorRoot.setAttribute("data-notes-editor-root", "");
    const spies: Record<string, ReturnType<typeof vi.fn>> = {};
    const headings: Array<[string, string]> = [
      ["h1", "One"],
      ["h2", "Two"],
      ["h3", "Three"],
    ];
    for (const [tag, text] of headings) {
      const el = document.createElement(tag);
      el.textContent = text;
      const spy = vi.fn();
      (el as unknown as { scrollIntoView: typeof spy }).scrollIntoView = spy;
      spies[text] = spy;
      editorRoot.appendChild(el);
    }
    document.body.appendChild(editorRoot);

    render(<NotesTocPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Two/ }));
    expect(spies.Two).toHaveBeenCalledTimes(1);
    expect(spies.Two).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(spies.One).not.toHaveBeenCalled();
    expect(spies.Three).not.toHaveBeenCalled();
  });
});
