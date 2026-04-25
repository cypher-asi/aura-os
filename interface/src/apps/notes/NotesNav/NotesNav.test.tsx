import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Quiet the projects-list-store persist layer so cascading subscriptions
// don't emit unhandled promise rejections when we mutate the store below.
vi.mock("../../../shared/lib/browser-db", () => ({
  BROWSER_DB_STORES: new Proxy({}, { get: (_t, prop) => String(prop) }),
  browserDbGet: vi.fn().mockResolvedValue(null),
  browserDbSet: vi.fn().mockResolvedValue(undefined),
  browserDbDelete: vi.fn().mockResolvedValue(undefined),
}));

interface StubTreeProps {
  ariaLabel: string;
  entries: readonly unknown[];
}

const mockUseLeftMenuProjectReorder = vi.fn(() => undefined);

vi.mock("../../../features/left-menu", () => ({
  buildLeftMenuEntries: () => [],
  LeftMenuTree: ({ ariaLabel, entries }: StubTreeProps) => (
    <nav aria-label={ariaLabel} data-entry-count={entries.length} />
  ),
  useLeftMenuExpandedGroups: () => ({
    expandedIds: [],
    toggleGroup: vi.fn(),
  }),
  useLeftMenuProjectReorder: (
    ...args: Parameters<typeof mockUseLeftMenuProjectReorder>
  ) => mockUseLeftMenuProjectReorder(...args),
}));

vi.mock("../../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({ query: "", setAction: () => {} }),
}));

vi.mock("../../../components/ProjectsPlusButton/ProjectsPlusButton", () => ({
  ProjectsPlusButton: ({ title }: { title: string }) => (
    <button type="button" aria-label={title} />
  ),
}));

vi.mock("../../../components/ProjectList/ExplorerContextMenu", () => ({
  ExplorerContextMenu: () => null,
}));
vi.mock("../../../components/ProjectList/ProjectListModals", () => ({
  ProjectListModals: () => null,
}));
vi.mock("../NotesEntryContextMenu", () => ({
  NotesEntryContextMenu: () => null,
}));
vi.mock("../NotesEntryModals", () => ({
  NotesEntryModals: () => null,
}));

vi.mock("../../../hooks/use-project-list-actions", () => ({
  useProjectListActions: () => ({}),
}));

vi.mock("./useNotesContextMenu", () => ({
  useNotesContextMenu: () => ({
    handleContextMenu: vi.fn(),
    handleKeyDown: vi.fn(),
  }),
}));

import { NotesNav } from "./NotesNav";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useNotesStore } from "../../../stores/notes-store";

function withRouter(node: ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

describe("NotesNav", () => {
  beforeEach(() => {
    mockUseLeftMenuProjectReorder.mockClear();
    useProjectsListStore.setState({
      projects: [],
      loadingProjects: false,
      refreshProjects: vi.fn().mockResolvedValue(undefined),
    });
    useNotesStore.setState({
      trees: {},
      loadTree: vi.fn().mockResolvedValue(undefined),
      selectNote: vi.fn(),
      createNote: vi.fn().mockResolvedValue(null),
    });
  });

  it("shows an onboarding hint when there are no projects and we're not loading", () => {
    render(withRouter(<NotesNav />));
    expect(
      screen.getByText(/Create a project first to start adding notes/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Notes navigation" }),
    ).not.toBeInTheDocument();
  });

  it("suppresses the onboarding hint while projects are loading", () => {
    useProjectsListStore.setState({ loadingProjects: true });
    render(withRouter(<NotesNav />));
    expect(
      screen.queryByText(/Create a project first to start adding notes/),
    ).not.toBeInTheDocument();
  });

  it("renders the nav tree once projects are present", () => {
    useProjectsListStore.setState({
      projects: [
        {
          project_id: "p1",
          name: "First",
          created_at: new Date().toISOString(),
        },
      ],
    });
    render(withRouter(<NotesNav />));
    expect(
      screen.getByRole("navigation", { name: "Notes navigation" }),
    ).toBeInTheDocument();
  });

  it("wires the shared project-reorder hook with a resolver that unwraps project entry ids", () => {
    useProjectsListStore.setState({
      projects: [
        {
          project_id: "p1",
          name: "First",
          created_at: new Date().toISOString(),
        },
      ],
    });

    render(withRouter(<NotesNav />));

    expect(mockUseLeftMenuProjectReorder).toHaveBeenCalled();
    const lastCall = mockUseLeftMenuProjectReorder.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const [, options] = lastCall as [unknown, { searchActive: boolean; resolveProjectId: (id: string) => string | null }];
    expect(options.searchActive).toBe(false);
    expect(options.resolveProjectId("project::p1")).toBe("p1");
    expect(options.resolveProjectId("folder::p1::foo")).toBeNull();
    expect(options.resolveProjectId("note::p1::foo.md")).toBeNull();
  });
});
