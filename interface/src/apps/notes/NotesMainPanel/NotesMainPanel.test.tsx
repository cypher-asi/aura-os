import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Keep the persist layer in the projects/notes stores from emitting
// unhandled-rejection noise in the test console.
vi.mock("../../../shared/lib/browser-db", () => ({
  BROWSER_DB_STORES: new Proxy({}, { get: (_t, prop) => String(prop) }),
  browserDbGet: vi.fn().mockResolvedValue(null),
  browserDbSet: vi.fn().mockResolvedValue(undefined),
  browserDbDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../components/Lane", () => ({
  Lane: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));

// The real BubbleToolbar mounts the ZUI-backed editor menu; for this test
// we only care that NotesMainPanel renders the toolbar when the editor is
// available, not what the toolbar draws internally.
vi.mock("./BubbleToolbar", () => ({
  BubbleToolbar: () => <div data-testid="bubble-toolbar" />,
}));

// TipTap's real editor pulls in ProseMirror + its own React copy, which
// breaks under Vitest. Swap it for a minimal stub that exposes just
// enough surface area for the panel under test.
vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor-content" />,
  useEditor: () => ({
    commands: { setContent: vi.fn() },
    storage: { markdown: { getMarkdown: () => "" } },
  }),
  // NotesMainPanel now defines a custom keybindings extension via
  // `Extension.create({ ... })`; the stub returns a no-op object so the
  // module can evaluate without booting real ProseMirror.
  Extension: { create: () => ({}) },
}));
vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@tiptap/starter-kit", () => ({
  default: { configure: () => ({}) },
}));
vi.mock("@tiptap/extension-placeholder", () => ({
  default: { configure: () => ({}) },
}));
vi.mock("tiptap-markdown", () => ({
  Markdown: { configure: () => ({}) },
}));

import { NotesMainPanel } from "./NotesMainPanel";
import { useNotesStore, makeNoteKey } from "../../../stores/notes-store";

const projectId = "proj-1";
const relPath = "note.md";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/notes/:projectId/:notePath"
          element={<NotesMainPanel />}
        />
        <Route
          path="/notes"
          element={<NotesMainPanel>empty-fallback</NotesMainPanel>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function seedNote(content: string) {
  const key = makeNoteKey(projectId, relPath);
  useNotesStore.setState({
    activeProjectId: projectId,
    activeRelPath: relPath,
    contentCache: {
      [key]: {
        content,
        title: "",
        absPath: "/root/note.md",
        frontmatter: {},
        updatedAt: undefined,
        wordCount: 0,
        dirty: false,
      },
    },
  });
}

describe("NotesMainPanel", () => {
  beforeEach(() => {
    useNotesStore.setState({
      activeProjectId: null,
      activeRelPath: null,
      contentCache: {},
      selectNote: vi.fn(),
      updateContent: vi.fn(),
    });
  });

  it("renders the fallback children when no note is in the URL", () => {
    renderAt("/notes");
    expect(screen.getByText("empty-fallback")).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Editor mode" }),
    ).not.toBeInTheDocument();
  });

  it("renders Rich/Markdown mode tabs when a note is selected", () => {
    seedNote("# Hi");
    renderAt(`/notes/${projectId}/${encodeURIComponent(relPath)}`);
    const tablist = screen.getByRole("tablist", { name: "Editor mode" });
    expect(tablist).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Rich" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Markdown" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("swaps to a plain textarea when the user flips to Markdown mode", () => {
    seedNote("Line 1\nLine 2");
    renderAt(`/notes/${projectId}/${encodeURIComponent(relPath)}`);
    fireEvent.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(
      screen.getByRole("textbox", { name: "Note body (markdown)" }),
    ).toBeInTheDocument();
  });

  it("forwards markdown edits to the store via updateContent", () => {
    const updateContent = vi.fn();
    useNotesStore.setState({ updateContent });
    seedNote("start");
    renderAt(`/notes/${projectId}/${encodeURIComponent(relPath)}`);
    fireEvent.click(screen.getByRole("tab", { name: "Markdown" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Note body (markdown)" }),
      { target: { value: "edited" } },
    );
    expect(updateContent).toHaveBeenCalledWith(projectId, relPath, "edited");
  });
});
