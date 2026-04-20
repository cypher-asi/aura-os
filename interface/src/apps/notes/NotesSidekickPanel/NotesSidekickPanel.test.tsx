import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesSidekickPanel } from "./NotesSidekickPanel";
import { useNotesStore } from "../../../stores/notes-store";

vi.mock("../NotesInfoPanel", () => ({
  NotesInfoPanel: () => <div data-testid="info-panel">INFO</div>,
}));
vi.mock("../NotesCommentsPanel", () => ({
  NotesCommentsPanel: () => <div data-testid="comments-panel">COMMENTS</div>,
}));
vi.mock("../NotesTocPanel", () => ({
  NotesTocPanel: () => <div data-testid="toc-panel">TOC</div>,
}));

describe("NotesSidekickPanel", () => {
  beforeEach(() => {
    useNotesStore.setState({ sidekickTab: "toc" });
  });

  it("routes to the TOC panel by default ('toc' tab)", () => {
    render(<NotesSidekickPanel />);
    expect(screen.getByTestId("toc-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("info-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("comments-panel")).not.toBeInTheDocument();
  });

  it("routes to the info panel when sidekickTab is 'info'", () => {
    useNotesStore.setState({ sidekickTab: "info" });
    render(<NotesSidekickPanel />);
    expect(screen.getByTestId("info-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("toc-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("comments-panel")).not.toBeInTheDocument();
  });

  it("routes to the comments panel when sidekickTab is 'comments'", () => {
    useNotesStore.setState({ sidekickTab: "comments" });
    render(<NotesSidekickPanel />);
    expect(screen.getByTestId("comments-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("toc-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("info-panel")).not.toBeInTheDocument();
  });
});
