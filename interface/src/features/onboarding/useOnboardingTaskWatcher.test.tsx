import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplaySessionEvent } from "../../shared/types/stream";
import {
  createSetters,
  ensureEntry,
  streamMetaMap,
  useStreamStore,
} from "../../hooks/stream/store";
import { useOnboardingStore } from "./onboarding-store";
import { useOnboardingTaskWatcher } from "./useOnboardingTaskWatcher";

const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("../../lib/analytics", () => ({
  track: mockTrack,
}));

const EMPTY_TASKS = {
  send_message: false,
  create_project: false,
  create_agent: false,
  try_3d: false,
  view_billing: false,
};

describe("useOnboardingTaskWatcher", () => {
  beforeEach(() => {
    mockTrack.mockClear();
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    useOnboardingStore.setState({
      userId: "user-1",
      welcomeCompleted: true,
      welcomeSkipped: false,
      welcomeStep: 0,
      selectedIntent: "chat",
      checklistDismissed: false,
      checklistTasks: { ...EMPTY_TASKS },
      checklistCollapsed: false,
    });
  });

  it("completes send_message when live chat appends a user stream event", () => {
    renderHook(() => useOnboardingTaskWatcher());

    act(() => {
      ensureEntry("agent-1:session-1");
      createSetters("agent-1:session-1").setEvents([
        { id: "message-1", role: "user", content: "Hello Aura" } as DisplaySessionEvent,
      ]);
    });

    expect(useOnboardingStore.getState().checklistTasks.send_message).toBe(true);
    expect(mockTrack).toHaveBeenCalledWith("onboarding_task_completed", {
      task_id: "send_message",
      progress: "1/5",
    });
  });

  it("ignores assistant-only stream events", () => {
    renderHook(() => useOnboardingTaskWatcher());

    act(() => {
      ensureEntry("agent-1:session-1");
      createSetters("agent-1:session-1").setEvents([
        { id: "message-1", role: "assistant", content: "Hi" } as DisplaySessionEvent,
      ]);
    });

    expect(useOnboardingStore.getState().checklistTasks.send_message).toBe(false);
    expect(mockTrack).not.toHaveBeenCalledWith(
      "onboarding_task_completed",
      expect.objectContaining({ task_id: "send_message" }),
    );
  });
});
