import { renderHook } from "@testing-library/react";

const mockSaveProjectOrder = vi.fn();

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (
    selector: (state: { saveProjectOrder: typeof mockSaveProjectOrder }) => unknown,
  ) => selector({ saveProjectOrder: mockSaveProjectOrder }),
}));

vi.mock("../../components/ProjectList/project-list-explorer-node", () => ({
  ARCHIVED_ROOT_NODE_ID: "_archived",
}));

import { useLeftMenuProjectReorder } from "./use-left-menu-project-reorder";
import type { LeftMenuEntry, LeftMenuGroupEntry } from "./types";

function makeGroup(
  id: string,
  overrides: Partial<LeftMenuGroupEntry> = {},
): LeftMenuGroupEntry {
  return {
    kind: "group",
    id,
    label: id,
    expanded: false,
    children: [],
    onActivate: vi.fn(),
    ...overrides,
  };
}

function makeLeaf(id: string): LeftMenuEntry {
  return {
    kind: "item",
    id,
    label: id,
    onSelect: vi.fn(),
  };
}

beforeEach(() => {
  mockSaveProjectOrder.mockClear();
});

describe("useLeftMenuProjectReorder", () => {
  it("exposes draggable group ids and persists via saveProjectOrder", () => {
    const entries: LeftMenuEntry[] = [makeGroup("p1"), makeGroup("p2")];
    const { result } = renderHook(() => useLeftMenuProjectReorder(entries));

    expect(result.current?.draggableEntryIds).toEqual(["p1", "p2"]);

    result.current?.onReorder(["p2", "p1"]);
    expect(mockSaveProjectOrder).toHaveBeenCalledWith(["p2", "p1"]);
  });

  it("returns undefined when search is active", () => {
    const entries: LeftMenuEntry[] = [makeGroup("p1"), makeGroup("p2")];
    const { result } = renderHook(() =>
      useLeftMenuProjectReorder(entries, { searchActive: true }),
    );
    expect(result.current).toBeUndefined();
  });

  it("returns undefined when fewer than two draggable groups remain", () => {
    const entries: LeftMenuEntry[] = [makeGroup("p1"), makeLeaf("leaf")];
    const { result } = renderHook(() => useLeftMenuProjectReorder(entries));
    expect(result.current).toBeUndefined();
  });

  it("excludes archived root and section variants", () => {
    const entries: LeftMenuEntry[] = [
      makeGroup("p1"),
      makeGroup("p2"),
      makeGroup("_archived"),
      makeGroup("recent", { variant: "section" }),
    ];
    const { result } = renderHook(() => useLeftMenuProjectReorder(entries));

    expect(result.current?.draggableEntryIds).toEqual(["p1", "p2"]);
  });

  it("honors extraExcludedIds", () => {
    const entries: LeftMenuEntry[] = [
      makeGroup("p1"),
      makeGroup("p2"),
      makeGroup("synthetic-root"),
    ];
    const { result } = renderHook(() =>
      useLeftMenuProjectReorder(entries, {
        extraExcludedIds: new Set(["synthetic-root"]),
      }),
    );
    expect(result.current?.draggableEntryIds).toEqual(["p1", "p2"]);
  });

  it("maps entry ids back to project ids via resolveProjectId", () => {
    const entries: LeftMenuEntry[] = [
      makeGroup("project::p1"),
      makeGroup("project::p2"),
      makeGroup("project::p3"),
    ];
    const resolveProjectId = (id: string) =>
      id.startsWith("project::") ? id.slice("project::".length) : null;
    const { result } = renderHook(() =>
      useLeftMenuProjectReorder(entries, { resolveProjectId }),
    );

    expect(result.current?.draggableEntryIds).toEqual([
      "project::p1",
      "project::p2",
      "project::p3",
    ]);

    result.current?.onReorder(["project::p3", "project::p1", "project::p2"]);
    expect(mockSaveProjectOrder).toHaveBeenCalledWith(["p3", "p1", "p2"]);
  });

  it("drops entries whose resolveProjectId returns null", () => {
    const entries: LeftMenuEntry[] = [
      makeGroup("project::p1"),
      makeGroup("project::p2"),
      makeGroup("not-a-project"),
    ];
    const resolveProjectId = (id: string) =>
      id.startsWith("project::") ? id.slice("project::".length) : null;
    const { result } = renderHook(() =>
      useLeftMenuProjectReorder(entries, { resolveProjectId }),
    );

    expect(result.current?.draggableEntryIds).toEqual([
      "project::p1",
      "project::p2",
    ]);

    result.current?.onReorder([
      "project::p2",
      "not-a-project",
      "project::p1",
    ]);
    expect(mockSaveProjectOrder).toHaveBeenCalledWith(["p2", "p1"]);
  });
});
