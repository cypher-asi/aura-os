import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));
vi.mock("../../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => (
    <span data-testid="avatar" aria-hidden="true">
      {name.charAt(0)}
    </span>
  ),
}));
vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));

import { NotesCommentsPanel } from "./NotesCommentsPanel";
import { useNotesStore, makeNoteKey } from "../../../stores/notes-store";

const projectId = "proj-1";
const relPath = "ideas/brain.md";

function activate() {
  useNotesStore.setState({
    activeProjectId: projectId,
    activeRelPath: relPath,
  });
}

describe("NotesCommentsPanel", () => {
  beforeEach(() => {
    useNotesStore.setState({
      activeProjectId: null,
      activeRelPath: null,
      commentsByNote: {},
    });
  });

  it("renders nothing but the shell when no note is active", () => {
    const { container } = render(<NotesCommentsPanel />);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("shows the empty state when the active note has no comments", () => {
    activate();
    render(<NotesCommentsPanel />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("renders existing comments with author and body", () => {
    activate();
    useNotesStore.setState({
      commentsByNote: {
        [makeNoteKey(projectId, relPath)]: [
          {
            id: "c-1",
            authorName: "Ada",
            body: "Looking great",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    render(<NotesCommentsPanel />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Looking great")).toBeInTheDocument();
  });

  it("submits a new comment through the store on Enter and clears the draft", () => {
    activate();
    const addComment = vi.fn().mockResolvedValue(undefined);
    useNotesStore.setState({ addComment });

    render(<NotesCommentsPanel />);
    const textarea = screen.getByLabelText("Add a comment") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Shipping soon" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(addComment).toHaveBeenCalledWith(projectId, relPath, "Shipping soon");
    expect(textarea.value).toBe("");
  });

  it("does not submit an empty/whitespace-only comment", () => {
    activate();
    const addComment = vi.fn();
    useNotesStore.setState({ addComment });

    render(<NotesCommentsPanel />);
    fireEvent.click(screen.getByLabelText("Send comment"));
    expect(addComment).not.toHaveBeenCalled();
  });
});
