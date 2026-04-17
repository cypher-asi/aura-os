import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const mockActiveKey = { value: null as { projectId: string; relPath: string } | null };
const mockTrees: Record<
  string,
  {
    loading: boolean;
    nodes: Array<{ kind: "note"; relPath: string } | { kind: "folder"; relPath: string; children: never[] }>;
  }
> = {};
const mockProjects: Array<{ project_id: string }> = [];
const mockStoredNote = { value: null as { projectId: string; relPath: string } | null };

vi.mock("../../../stores/notes-store", () => ({
  useActiveNoteKey: () => mockActiveKey.value,
  useNotesStore: <T,>(sel: (s: { trees: typeof mockTrees }) => T) => sel({ trees: mockTrees }),
}));
vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: <T,>(sel: (s: { projects: typeof mockProjects }) => T) =>
    sel({ projects: mockProjects }),
}));
vi.mock("../../../utils/storage", () => ({
  getLastNote: () => mockStoredNote.value,
}));

import { NotesIndexRedirect } from "./NotesIndexRedirect";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notes" element={<><NotesIndexRedirect /><LocationProbe /></>} />
        <Route
          path="/notes/:projectId"
          element={<><NotesIndexRedirect /><LocationProbe /></>}
        />
        <Route
          path="/notes/:projectId/:notePath"
          element={<LocationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NotesIndexRedirect", () => {
  beforeEach(() => {
    mockActiveKey.value = null;
    mockStoredNote.value = null;
    mockProjects.length = 0;
    for (const key of Object.keys(mockTrees)) delete mockTrees[key];
  });

  it("navigates to the active note's canonical URL when available", () => {
    mockActiveKey.value = { projectId: "p1", relPath: "folder/note.md" };

    const { getByTestId } = renderAt("/notes");

    expect(getByTestId("pathname").textContent).toBe("/notes/p1/folder%2Fnote.md");
  });

  it("falls back to the first project note when no active or stored note exists", () => {
    mockProjects.push({ project_id: "p2" });
    mockTrees.p2 = {
      loading: false,
      nodes: [{ kind: "note", relPath: "todo.md" }],
    };

    const { getByTestId } = renderAt("/notes");

    expect(getByTestId("pathname").textContent).toBe("/notes/p2/todo.md");
  });

  it("stays on /notes when trees are still loading", () => {
    mockProjects.push({ project_id: "p3" });
    mockTrees.p3 = { loading: true, nodes: [] };
    mockStoredNote.value = { projectId: "p3", relPath: "draft.md" };

    const { getByTestId } = renderAt("/notes");

    expect(getByTestId("pathname").textContent).toBe("/notes");
  });
});
