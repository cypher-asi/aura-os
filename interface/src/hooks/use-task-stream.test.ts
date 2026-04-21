import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("../stores/task-stream-bootstrap", () => ({
  taskStreamKey: (id: string) => `task:${id}`,
}));

vi.mock("./stream/store", () => {
  const ensureEntry = vi.fn();
  let state: { entries: Record<string, { isStreaming: boolean }> } = { entries: {} };
  const setState = vi.fn((updater: (s: typeof state) => typeof state) => {
    state = updater(state);
  });
  return {
    ensureEntry,
    useStreamStore: {
      setState,
      getState: () => state,
      _setInitial: (s: typeof state) => {
        state = s;
      },
      _reset: () => {
        state = { entries: {} };
      },
    },
  };
});

import { useTaskStream } from "./use-task-stream";
import { ensureEntry, useStreamStore } from "./stream/store";

// Cast to the augmented test shape from the mock above.
const storeMock = useStreamStore as typeof useStreamStore & {
  _setInitial: (s: { entries: Record<string, { isStreaming: boolean }> }) => void;
  _reset: () => void;
};

beforeEach(() => {
  (ensureEntry as unknown as { mockClear: () => void }).mockClear();
  (useStreamStore.setState as unknown as { mockClear: () => void }).mockClear();
  storeMock._reset();
});

describe("useTaskStream", () => {
  it("returns the canonical streamKey for a task id", () => {
    const { result } = renderHook(() => useTaskStream("abc"));
    expect(result.current.streamKey).toBe("task:abc");
  });

  it("returns a key even when taskId is undefined, without mutating the store", () => {
    const { result } = renderHook(() => useTaskStream(undefined));
    expect(result.current.streamKey).toBe("task:");
    expect(ensureEntry).not.toHaveBeenCalled();
    expect(useStreamStore.setState).not.toHaveBeenCalled();
  });

  it("does not touch the store when isActive is false (bootstrap owns subs)", () => {
    renderHook(() => useTaskStream("abc", false));
    expect(ensureEntry).not.toHaveBeenCalled();
    expect(useStreamStore.setState).not.toHaveBeenCalled();
  });

  it("eagerly primes the stream entry when isActive is true", () => {
    storeMock._setInitial({ entries: { "task:abc": { isStreaming: false } } });
    renderHook(() => useTaskStream("abc", true));
    expect(ensureEntry).toHaveBeenCalledWith("task:abc");
    expect(useStreamStore.setState).toHaveBeenCalled();
    expect(storeMock.getState().entries["task:abc"].isStreaming).toBe(true);
  });

  it("leaves an already-streaming entry alone", () => {
    storeMock._setInitial({ entries: { "task:abc": { isStreaming: true } } });
    renderHook(() => useTaskStream("abc", true));
    expect(storeMock.getState().entries["task:abc"].isStreaming).toBe(true);
  });
});
