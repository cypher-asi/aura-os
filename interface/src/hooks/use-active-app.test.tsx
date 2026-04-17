import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../apps/registry", () => ({
  apps: [
    { id: "agents", basePath: "/agents", label: "Agents" },
    { id: "projects", basePath: "/projects", label: "Projects" },
    { id: "tasks", basePath: "/tasks", label: "Tasks" },
    { id: "feed", basePath: "/feed", label: "Feed" },
    { id: "feedback", basePath: "/feedback", label: "Feedback" },
    { id: "notes", basePath: "/notes", label: "Notes" },
  ],
}));

vi.mock("../utils/storage", () => ({
  getTaskbarAppOrder: () => [],
  setTaskbarAppOrder: vi.fn(),
}));

import { useActiveApp, useActiveAppId } from "./use-active-app";

function wrapperAt(pathname: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>
  );
}

describe("useActiveApp", () => {
  it("derives the app that owns the current pathname", () => {
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/projects/abc"),
    });
    expect(result.current.id).toBe("projects");
  });

  it("distinguishes /feed from /feedback (strict basePath match)", () => {
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/feedback/ideas"),
    });
    expect(result.current.id).toBe("feedback");
  });

  it("falls back to the first app for unknown pathnames", () => {
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/nonsense"),
    });
    expect(result.current.id).toBe("agents");
  });

  it("useActiveAppId returns the id only", () => {
    const { result } = renderHook(() => useActiveAppId(), {
      wrapper: wrapperAt("/notes"),
    });
    expect(result.current).toBe("notes");
  });
});
