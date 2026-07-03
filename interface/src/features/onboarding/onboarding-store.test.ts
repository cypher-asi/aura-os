import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ONBOARDING_STORAGE_PREFIX } from "./onboarding-constants";
import { useOnboardingStore } from "./onboarding-store";

function key(userId: string): string {
  return `${ONBOARDING_STORAGE_PREFIX}:${userId}`;
}

describe("useOnboardingStore onboarding intent persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useOnboardingStore.setState({
      userId: null,
      welcomeCompleted: false,
      welcomeSkipped: false,
      welcomeStep: 0,
      selectedIntent: null,
      checklistDismissed: false,
      checklistTasks: {
        send_message: false,
        create_project: false,
        create_agent: false,
        try_3d: false,
        view_billing: false,
      },
      checklistCollapsed: false,
    });
  });

  it("hydrates old persisted state without forcing an intent", () => {
    localStorage.setItem(
      key("user-1"),
      JSON.stringify({
        welcomeCompleted: true,
        welcomeSkipped: false,
        checklistDismissed: false,
        checklistTasks: { send_message: true },
      }),
    );

    const { result } = renderHook(() => useOnboardingStore());

    act(() => result.current.hydrateForUser("user-1"));

    expect(result.current.welcomeCompleted).toBe(true);
    expect(result.current.selectedIntent).toBeNull();
    expect(result.current.checklistTasks.send_message).toBe(true);
  });

  it("ignores malformed persisted intent values", () => {
    localStorage.setItem(
      key("user-1"),
      JSON.stringify({
        selectedIntent: "agents",
        checklistTasks: {},
      }),
    );

    const { result } = renderHook(() => useOnboardingStore());

    act(() => result.current.hydrateForUser("user-1"));

    expect(result.current.selectedIntent).toBeNull();
  });

  it("ignores malformed persisted checklist task payloads", () => {
    localStorage.setItem(
      key("user-1"),
      JSON.stringify({
        checklistTasks: "bad-payload",
      }),
    );

    const { result } = renderHook(() => useOnboardingStore());

    act(() => result.current.hydrateForUser("user-1"));

    expect(result.current.checklistTasks).toMatchObject({
      send_message: false,
      create_project: false,
      create_agent: false,
      try_3d: false,
      view_billing: false,
    });
  });

  it("persists the selected intent when welcome completes", () => {
    const { result } = renderHook(() => useOnboardingStore());

    act(() => result.current.hydrateForUser("user-1"));
    act(() => result.current.completeWelcome("build"));

    expect(result.current.welcomeCompleted).toBe(true);
    expect(result.current.selectedIntent).toBe("build");
    expect(JSON.parse(localStorage.getItem(key("user-1")) ?? "{}")).toMatchObject({
      welcomeCompleted: true,
      selectedIntent: "build",
    });
  });

  it("resets the selected intent with onboarding reset", () => {
    const { result } = renderHook(() => useOnboardingStore());

    act(() => result.current.hydrateForUser("user-1"));
    act(() => result.current.completeWelcome("chat"));
    act(() => result.current.resetOnboarding());

    expect(result.current.selectedIntent).toBeNull();
    expect(JSON.parse(localStorage.getItem(key("user-1")) ?? "{}")).toMatchObject({
      welcomeCompleted: false,
      selectedIntent: null,
    });
  });
});
