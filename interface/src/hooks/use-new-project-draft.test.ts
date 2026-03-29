import { renderHook, act } from "@testing-library/react";
import { useNewProjectDraft } from "./use-new-project-draft";

describe("useNewProjectDraft", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns null storedDraft when no draft is saved", () => {
    const { result } = renderHook(() => useNewProjectDraft(false));
    expect(result.current.storedDraft).toBeNull();
  });

  it("saves a draft to sessionStorage when open", () => {
    const formValues = {
      name: "My Project",
      folderPath: "p/my-project",
      environment: "remote" as const,
    };

    renderHook(() => useNewProjectDraft(true, formValues));

    const raw = sessionStorage.getItem("aura:new-project-draft");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.name).toBe("My Project");
    expect(parsed.folderPath).toBe("p/my-project");
    expect(parsed.environment).toBe("remote");
  });

  it("does not save when not open", () => {
    const formValues = {
      name: "My Project",
      folderPath: "p/my-project",
      environment: "remote" as const,
    };

    renderHook(() => useNewProjectDraft(false, formValues));

    expect(sessionStorage.getItem("aura:new-project-draft")).toBeNull();
  });

  it("reads existing draft on initial render", () => {
    sessionStorage.setItem(
      "aura:new-project-draft",
      JSON.stringify({
        name: "Saved",
        folderPath: "/saved",
        environment: "local",
      }),
    );

    const { result } = renderHook(() => useNewProjectDraft(false));

    expect(result.current.storedDraft).toEqual({
      name: "Saved",
      folderPath: "/saved",
      environment: "local",
    });
  });

  it("clearDraft removes from sessionStorage", () => {
    sessionStorage.setItem(
      "aura:new-project-draft",
      JSON.stringify({ name: "", folderPath: "", environment: "remote" }),
    );

    const { result } = renderHook(() => useNewProjectDraft(false));

    act(() => {
      result.current.clearDraft();
    });

    expect(sessionStorage.getItem("aura:new-project-draft")).toBeNull();
  });

  it("handles invalid JSON in sessionStorage", () => {
    sessionStorage.setItem("aura:new-project-draft", "not-json");

    const { result } = renderHook(() => useNewProjectDraft(false));
    expect(result.current.storedDraft).toBeNull();
  });

  it("defaults environment to remote for invalid values", () => {
    sessionStorage.setItem(
      "aura:new-project-draft",
      JSON.stringify({ name: "x", folderPath: "", environment: "invalid" }),
    );

    const { result } = renderHook(() => useNewProjectDraft(false));
    expect(result.current.storedDraft!.environment).toBe("remote");
  });
});
