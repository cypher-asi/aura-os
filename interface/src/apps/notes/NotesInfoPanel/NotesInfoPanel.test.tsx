import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));

import { NotesInfoPanel } from "./NotesInfoPanel";
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
        frontmatter: {
          created_at: "2025-04-10T12:00:00.000Z",
          created_by: "Ada",
        },
        updatedAt: "2025-04-11T09:00:00.000Z",
        wordCount: 42,
        dirty: false,
      },
    },
  });
}

describe("NotesInfoPanel", () => {
  beforeEach(() => {
    useNotesStore.setState({
      activeProjectId: null,
      activeRelPath: null,
      contentCache: {},
    });
  });

  it("renders a quiet placeholder when no note is active", () => {
    const { container } = render(<NotesInfoPanel />);
    expect(container.querySelector("button")).toBeNull();
    expect(screen.queryByText(/Word count/)).not.toBeInTheDocument();
  });

  it("renders title, location, word count and TOC headings", () => {
    seedActiveNote(
      [
        "---",
        "title: Ignore this frontmatter heading",
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

    render(<NotesInfoPanel />);

    expect(screen.getByText("Big Ideas")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "C:/projects/proj-1/Notes/Idea.md" }),
    ).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();

    const headings = ["Top", "Middle", "Inner"];
    for (const heading of headings) {
      expect(
        screen.getByRole("button", { name: heading }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: "heading in code fence" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No headings yet")).not.toBeInTheDocument();
  });

  it("shows a 'No headings yet' placeholder when the note has no markdown headings", () => {
    seedActiveNote("Just a body paragraph with no headings.");
    render(<NotesInfoPanel />);
    expect(screen.getByText("No headings yet")).toBeInTheDocument();
  });

  it("fires revealInFolder when the Location path is clicked", () => {
    const revealInFolder = vi.fn();
    seedActiveNote("# Top");
    useNotesStore.setState({ revealInFolder });
    render(<NotesInfoPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "C:/projects/proj-1/Notes/Idea.md" }),
    );
    expect(revealInFolder).toHaveBeenCalledWith(
      "C:/projects/proj-1/Notes/Idea.md",
    );
  });
});
