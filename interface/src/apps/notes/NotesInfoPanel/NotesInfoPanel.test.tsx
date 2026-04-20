import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));

import { NotesInfoPanel } from "./NotesInfoPanel";
import { useNotesStore, makeNoteKey } from "../../../stores/notes-store";
import { useAuthStore } from "../../../stores/auth-store";

function seedActiveNote(content: string, createdBy: string = "Ada") {
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
          created_by: createdBy,
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

  it("renders title, location, created-at/by, and word count rows", () => {
    seedActiveNote("# Top\n\nbody");

    render(<NotesInfoPanel />);

    expect(screen.getByText("Big Ideas")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "C:/projects/proj-1/Notes/Idea.md" }),
    ).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();

    expect(screen.getByText("Created at")).toBeInTheDocument();
    expect(screen.getByText("Created by")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    // TOC moved to its own panel; nothing TOC-related should render here.
    expect(screen.queryByText("Table of contents")).not.toBeInTheDocument();
    expect(screen.queryByText("No headings yet")).not.toBeInTheDocument();
  });

  it("resolves a UUID created_by to the current user's display name", () => {
    const selfId = "11111111-2222-3333-4444-555555555555";
    useAuthStore.setState({
      user: {
        user_id: selfId,
        display_name: "Rainer",
        profile_image: "",
        primary_zid: "",
        zero_wallet: "",
        wallets: [],
        is_zero_pro: false,
        is_access_granted: false,
      },
    });
    seedActiveNote("# Top", selfId);
    render(<NotesInfoPanel />);
    expect(screen.getByText("Rainer")).toBeInTheDocument();
    expect(screen.queryByText(selfId)).not.toBeInTheDocument();
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
