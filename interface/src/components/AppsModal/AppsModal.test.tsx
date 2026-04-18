import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

function MockIcon({ size = 16 }: { size?: number }) {
  return <svg data-testid={`icon-${size}`} />;
}

const mockApps = [
  { id: "agents", label: "Agents", basePath: "/agents", icon: MockIcon },
  { id: "projects", label: "Projects", basePath: "/projects", icon: MockIcon },
  { id: "tasks", label: "Tasks", basePath: "/tasks", icon: MockIcon },
  { id: "feed", label: "Feed", basePath: "/feed", icon: MockIcon },
  { id: "profile", label: "Profile", basePath: "/profile", icon: MockIcon },
  { id: "desktop", label: "Desktop", basePath: "/desktop", icon: MockIcon },
];

const saveTaskbarAppsLayout = vi.fn();
const state = {
  apps: mockApps,
  taskbarAppOrder: ["agents", "projects", "tasks", "feed"],
  taskbarHiddenAppIds: ["feed"],
  saveTaskbarAppsLayout,
};

vi.mock("../../stores/app-store", () => ({
  useAppStore: (selector: (s: typeof state) => unknown) => selector(state),
  getOrderedTaskbarApps: (apps: typeof mockApps, taskbarAppOrder: string[]) => {
    const rank = new Map(taskbarAppOrder.map((id, index) => [id, index]));
    return [...apps].sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank == null && bRank == null) return 0;
      if (aRank == null) return 1;
      if (bRank == null) return -1;
      return aRank - bRank;
    });
  },
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

vi.mock("./AppsModal.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { AppsModal } from "./AppsModal";

beforeEach(() => {
  vi.clearAllMocks();
  state.taskbarAppOrder = ["agents", "projects", "tasks", "feed"];
  state.taskbarHiddenAppIds = ["feed"];
});

describe("AppsModal", () => {
  it("splits reorderable apps into Visible and Hidden sections and excludes pinned apps", () => {
    render(<AppsModal isOpen onClose={vi.fn()} />);

    const visibleSection = screen.getByRole("region", { name: /Visible in taskbar/i });
    const hiddenSection = screen.getByRole("region", { name: /Hidden/i });

    const visibleLabels = within(visibleSection)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("data-app-id"));
    const hiddenLabels = within(hiddenSection)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("data-app-id"));

    expect(visibleLabels).toEqual(["agents", "projects", "tasks"]);
    expect(hiddenLabels).toEqual(["feed"]);

    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Desktop")).not.toBeInTheDocument();
  });

  it("shows an empty-state row when a section has no apps", () => {
    state.taskbarHiddenAppIds = [];

    render(<AppsModal isOpen onClose={vi.fn()} />);

    const hiddenSection = screen.getByRole("region", { name: /Hidden/i });
    expect(
      within(hiddenSection).getByText(/Drag items here to hide them/i),
    ).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<AppsModal isOpen={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
