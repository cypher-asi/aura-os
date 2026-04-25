import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useTaskStatus } from "./use-task-status";
import { useTaskStatusStore } from "../stores/task-status-store";

/* ------------------------------------------------------------------ */
/*  Tests for the thin selector hook.                                  */
/*                                                                     */
/*  These tests deliberately drive the store directly rather than      */
/*  dispatching WS events: the WS-to-store wiring is covered in        */
/*  `task-stream-bootstrap.test.ts`. Here we only assert the           */
/*  hook's projection (selector + derived failReason +                 */
/*  reconciliation against the canonical status).                      */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  useTaskStatusStore.getState().reset();
});

describe("useTaskStatus", () => {
  it("returns null initial state", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    expect(result.current.liveStatus).toBeNull();
    expect(result.current.liveSessionId).toBeNull();
    expect(result.current.failReason).toBeNull();
  });

  it("reflects in_progress and session id from the store", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      const s = useTaskStatusStore.getState();
      s.setLiveStatus("task-1", "in_progress");
      s.setLiveSessionId("task-1", "sess-1");
    });

    expect(result.current.liveStatus).toBe("in_progress");
    expect(result.current.liveSessionId).toBe("sess-1");
  });

  it("reflects done from the store", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      useTaskStatusStore.getState().setLiveStatus("task-1", "done");
    });

    expect(result.current.liveStatus).toBe("done");
  });

  it("reflects failed status and reason from the store", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      const s = useTaskStatusStore.getState();
      s.setLiveStatus("task-1", "failed");
      s.setLiveFailReason("task-1", "timeout");
    });

    expect(result.current.liveStatus).toBe("failed");
    expect(result.current.failReason).toBe("timeout");
  });

  it("ignores updates targeted at other tasks", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      useTaskStatusStore.getState().setLiveStatus("task-other", "in_progress");
    });

    expect(result.current.liveStatus).toBeNull();
  });

  it("returns the slice for the new id when taskId changes", () => {
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => useTaskStatus(taskId),
      { initialProps: { taskId: "task-1" } },
    );

    act(() => {
      const s = useTaskStatusStore.getState();
      s.setLiveStatus("task-1", "in_progress");
      s.setLiveSessionId("task-1", "sess-1");
    });

    expect(result.current.liveStatus).toBe("in_progress");

    // task-2 has no entry in the store, so its slice is the empty
    // singleton — the consumer sees null across the board even
    // though task-1's live state is still in the store.
    rerender({ taskId: "task-2" });

    expect(result.current.liveStatus).toBeNull();
    expect(result.current.liveSessionId).toBeNull();
    expect(result.current.failReason).toBeNull();
  });

  it("exposes setLiveStatus and setFailReason that write to the store", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      result.current.setLiveStatus("custom");
    });
    expect(result.current.liveStatus).toBe("custom");
    expect(useTaskStatusStore.getState().byTaskId["task-1"]?.liveStatus).toBe(
      "custom",
    );

    act(() => {
      result.current.setFailReason("manual");
    });
    expect(result.current.failReason).toBe("manual");
    expect(
      useTaskStatusStore.getState().byTaskId["task-1"]?.liveFailReason,
    ).toBe("manual");
  });

  it("derives a terminal canonical status when live is still in_progress", () => {
    const { result, rerender } = renderHook(
      ({ canonicalStatus }: { canonicalStatus?: string }) =>
        useTaskStatus("task-1", canonicalStatus),
      { initialProps: { canonicalStatus: "in_progress" } },
    );

    act(() => {
      useTaskStatusStore.getState().setLiveStatus("task-1", "in_progress");
    });

    expect(result.current.liveStatus).toBe("in_progress");

    // Canonical row moved to done while the WS handler missed the
    // event. The derived value reconciles to the canonical status
    // without mutating the store.
    rerender({ canonicalStatus: "done" });

    expect(result.current.liveStatus).toBe("done");
    expect(useTaskStatusStore.getState().byTaskId["task-1"]?.liveStatus).toBe(
      "in_progress",
    );
  });

  // Reload-safe seeding: emulates the "user refreshed the page after a
  // task already failed" path. No live `task_failed` event will ever
  // fire, so without this fallback the "Copy All Output" markdown
  // would have no fail reason (see TaskOutputSection.formatDebugOutput).
  it("derives failReason from canonicalExecutionNotes on failed + no live reason", () => {
    const { result } = renderHook(() =>
      useTaskStatus(
        "task-1",
        "failed",
        "completion contract: task_done called with no file changes",
      ),
    );

    expect(result.current.failReason).toBe(
      "completion contract: task_done called with no file changes",
    );
  });

  it("does not derive failReason when canonical status is not failed", () => {
    const { result } = renderHook(() =>
      useTaskStatus("task-1", "done", "irrelevant notes"),
    );

    expect(result.current.failReason).toBeNull();
  });

  it("prefers a live fail reason over persisted execution_notes", () => {
    const { result } = renderHook(() =>
      useTaskStatus("task-1", "failed", "stale db reason"),
    );

    expect(result.current.failReason).toBe("stale db reason");

    act(() => {
      useTaskStatusStore
        .getState()
        .setLiveFailReason("task-1", "fresh live reason");
    });

    expect(result.current.failReason).toBe("fresh live reason");
  });

  it("trims whitespace and ignores empty execution_notes", () => {
    const { result: blank } = renderHook(() =>
      useTaskStatus("task-1", "failed", "   "),
    );
    expect(blank.current.failReason).toBeNull();

    const { result: padded } = renderHook(() =>
      useTaskStatus("task-2", "failed", "  real reason  "),
    );
    expect(padded.current.failReason).toBe("real reason");
  });

  // Regression guard for the original "Maximum update depth exceeded"
  // crash: a `failed` canonical status with execution_notes was
  // previously mirrored into local state via a `useEffect`, which
  // re-fired whenever `failReason` was reset to null by `handleRetry`,
  // creating an infinite update loop. The derived computation must
  // not call setState during render, so re-renders triggered by an
  // imperative `setFailReason(null)` must not loop.
  //
  // We exercise the loop-prone interaction explicitly: seed a live
  // reason so the store actually has a populated entry, then clear it
  // repeatedly while the canonical notes prop stays present. The
  // derived value must continue to fall back to the notes, the store
  // entry must stay null, and re-renders must complete without
  // exceeding React's update-depth limit (which would otherwise
  // surface as a thrown error here).
  it("does not loop when setFailReason(null) is called repeatedly under a failed canonical status with notes", () => {
    const { result, rerender } = renderHook(() =>
      useTaskStatus("task-1", "failed", "persisted reason"),
    );

    act(() => {
      result.current.setFailReason("live reason");
    });
    expect(result.current.failReason).toBe("live reason");

    for (let i = 0; i < 5; i++) {
      act(() => {
        result.current.setFailReason(null);
      });
      expect(
        useTaskStatusStore.getState().byTaskId["task-1"]?.liveFailReason,
      ).toBeNull();
      expect(result.current.failReason).toBe("persisted reason");
      rerender();
      expect(result.current.failReason).toBe("persisted reason");
    }
  });
});
